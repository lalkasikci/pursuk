import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readEvents } from './sse.mjs';
import { randomUUID } from 'node:crypto';
import { measureUsage } from './usage.mjs';
import { findFaq } from './faq.mjs';
import { createTelemetry } from './telemetry.mjs';
import { createAdmin } from './admin-auth.mjs';
import { limits, validMessages } from './conversation.mjs';
export { validMessages } from './conversation.mjs';

const root = new URL('./', import.meta.url);
const staticFiles = { '/': ['demo.html', 'text/html'], '/chat': ['index.html', 'text/html'], '/admin': ['admin.html', 'text/html'], '/admin.js': ['admin.js', 'text/javascript'], '/widget.js': ['widget.js', 'text/javascript'], '/widget.css': ['widget.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/sse.mjs': ['sse.mjs', 'text/javascript'], '/porsuk.png': ['porsuk.png', 'image/png'] };
staticFiles['/conversation.mjs'] = ['conversation.mjs', 'text/javascript'];
staticFiles['/usage.mjs'] = ['usage.mjs', 'text/javascript'];
staticFiles['/routing.mjs'] = ['routing.mjs', 'text/javascript'];
const MAX_BODY = limits.requestBytes;

function reply(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

export function createApp({ apiKey = process.env.ANTHROPIC_API_KEY, model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6', fetchImpl = fetch, adminCredentialLoader } = {}) {
  let busy = false;
  let recent = [];
  const telemetry = createTelemetry();
  const handleAdmin = createAdmin({ credentialLoader: adminCredentialLoader, telemetry, model });
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
    try {
      const host = req.headers.host || '';
      if (!/^127\.0\.0\.1:\d+$/.test(host)) return reply(res, 403, { error: 'Bu uygulama yalnızca yerel adresinden kullanılabilir.' });
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) return reply(res, 403, { error: 'İstek kaynağına izin verilmedi.' });
      const path = new URL(req.url, `http://${host}`).pathname;
      if (path.startsWith('/api/admin/')) return await handleAdmin(req, res, path);
      if (req.method === 'GET' && path === '/api/status') return reply(res, 200, { available: true });
      if (req.method === 'GET' && staticFiles[path]) {
        const [file, type] = staticFiles[path];
        const content = await readFile(new URL(file, root));
        res.writeHead(200, { 'Content-Type': type.startsWith('image/') ? type : `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
        return res.end(content);
      }
      if (req.method !== 'POST' || path !== '/api/chat') return reply(res, 404, { error: 'Bulunamadı.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return reply(res, 415, { error: 'JSON biçimi gerekli.' });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) return reply(res, 413, { error: 'Mesaj çok uzun. Yeni sohbet başlatın.' });
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(res, 400, { error: 'Mesaj biçimi geçersiz.' }); }
      if (!validMessages(body?.messages)) return reply(res, 400, { error: 'Bu sohbet için 30 soru-cevap turu veya toplam 120.000 karakter sınırına ulaşıldı; ya da mesaj biçimi geçersiz. Yeni sohbet açabilirsin.' });
      let faq = null;
      try { faq = await findFaq(body.messages.at(-1).content); } catch { /* If the catalogue is unavailable, use Claude. */ }
      if (faq) {
        const route = { source: 'faq', topic: faq.id, method: faq.matchType };
        const measurement = { id: randomUUID(), model: 'hazir-yanit', source: 'faq', complete: true, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, estimatedUsd: 0, priceDate: null };
        telemetry.record(measurement.id, body.messages.at(-1).content, route, measurement, true);
        if (body.stream === true) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' });
          res.write(`data: ${JSON.stringify({ type: 'text', text: faq.answer })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'done', truncated: false })}\n\n`);
          return res.end();
        }
        return reply(res, 200, { answer: faq.answer, truncated: false });
      }
      if (!apiKey) return reply(res, 503, { error: 'Şu anda yanıt veremiyorum. Lütfen biraz sonra tekrar dene.' });
      recent = recent.filter(t => Date.now() - t < 60000);
      if (busy || recent.length >= 20) return reply(res, 429, { error: 'Kısa süre içinde çok fazla istek geldi. Biraz sonra tekrar deneyin.' });
      recent.push(Date.now());
      busy = true;
      const callId = randomUUID();
      const question = body.messages.at(-1).content;
      const disconnected = new AbortController();
      res.on('close', () => { if (!res.writableEnded) disconnected.abort(); });
      try {
        const [instructions, knowledge] = await Promise.all([
          readFile(new URL('bot-talimatlari.txt', root), 'utf8'),
          readFile(new URL('madset-bilgi.md', root), 'utf8')
        ]);
        telemetry.record(callId, question, { source: 'llm' }, null);
        const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: AbortSignal.any([AbortSignal.timeout(limits.responseTimeoutMs), disconnected.signal]),
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 650, stream: body.stream === true, system: `${instructions}\n\n<MADSET_BILGI_KAYNAGI>\n${knowledge}\n</MADSET_BILGI_KAYNAGI>`, messages: body.messages.map(({ role, content }) => ({ role, content })) })
        });
        if (!upstream.ok) {
          return reply(res, 502, { error: 'Şu anda yanıt veremiyorum. Lütfen biraz sonra tekrar dene.' });
        }
        if (body.stream === true) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
          res.flushHeaders();
          const emit = event => { if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
          let receivedText = false;
          let truncated = false;
          let stopped = false;
          const measurementId = callId;
          let usage = {};
          let servingModel = model;
          for await (const event of readEvents(upstream.body)) {
            if (event.type === 'error') throw new Error('Provider stream error');
            if (event.type === 'message_start') {
              servingModel = event.message?.model || model;
              usage = { ...usage, ...event.message?.usage };
            }
            if (event.type === 'message_delta') usage = { ...usage, ...event.usage };
            if (event.type === 'message_start' || event.type === 'message_delta') {
              const measurement = measureUsage(usage, { id: measurementId, model: servingModel });
              if (measurement) telemetry.record(callId, question, { source: 'llm' }, measurement);
            }
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              receivedText = true;
              emit({ type: 'text', text: event.delta.text });
            }
            if (event.type === 'message_delta') truncated = event.delta?.stop_reason === 'max_tokens';
            if (event.type === 'message_stop') { stopped = true; break; }
          }
          if (!stopped || !receivedText) throw new Error('Incomplete response');
          telemetry.record(callId, question, { source: 'llm' }, measureUsage(usage, { id: measurementId, model: servingModel, complete: true }), true);
          emit({ type: 'done', truncated });
          return res.end();
        }
        const data = await upstream.json();
        const answer = data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n');
        if (!answer) return reply(res, 502, { error: 'Claude metin yanıtı döndürmedi. Tekrar deneyin.' });
        telemetry.record(callId, question, { source: 'llm' }, measureUsage(data.usage, { id: callId, model: data.model || model, complete: true }), true);
        return reply(res, 200, { answer, truncated: data.stop_reason === 'max_tokens' });
      } finally { busy = false; }
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Yanıt tamamlanamadı. Tekrar deneyebilirsin.' })}\n\n`);
        return res.end();
      }
      reply(res, 502, { error: ['TimeoutError', 'AbortError'].includes(error.name) ? 'Yanıt süresi doldu. Tekrar deneyin.' : 'Bağlantı kurulamadı. İnternet bağlantısını kontrol edip tekrar deneyin.' });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 4317);
  const app = createApp();
  app.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      console.log(`Bu adres zaten kullaniliyor: http://127.0.0.1:${port}`);
      console.log('Pursuk zaten aciksa tarayicidan devam edebilirsiniz.');
      console.log('Guncellemeleri yuklemek icin once eski sunucu penceresinde Ctrl+C yapin, sonra yeniden baslatin.');
    } else {
      console.error('Pursuk baslatilamadi. Port ayarini ve yerel erisim izinlerini kontrol edin.');
      process.exitCode = 1;
    }
  });
  app.listen(port, '127.0.0.1', () => console.log(`Pursuk: http://127.0.0.1:${port}`));
}
