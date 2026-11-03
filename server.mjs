import { createPostgresStore } from './postgres-store.mjs';
import { startLocalPostgres } from './postgres-local.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readEvents } from './sse.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { measureUsage } from './usage.mjs';
import { findFaq, findFaqById } from './faq.mjs';
import { flowActions, choicesForTopic } from './chat-flow.mjs';
import { createTelemetry } from './telemetry.mjs';
import { createAdmin } from './admin-auth.mjs';
import { createHistoryContext, summaryInstructions } from './history-context.mjs';
import { limits, validMessages } from './conversation.mjs';
export { validMessages } from './conversation.mjs';

const root = new URL('./', import.meta.url);
const staticFiles = { '/': ['demo.html', 'text/html'], '/chat': ['index.html', 'text/html'], '/admin': ['admin.html', 'text/html'], '/admin.js': ['admin.js', 'text/javascript'], '/widget.js': ['widget.js', 'text/javascript'], '/widget.css': ['widget.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/sse.mjs': ['sse.mjs', 'text/javascript'], '/porsuk.png': ['porsuk.png', 'image/png'] };
staticFiles['/account.js'] = ['account.js', 'text/javascript'];
staticFiles['/conversation.mjs'] = ['conversation.mjs', 'text/javascript'];
staticFiles['/usage.mjs'] = ['usage.mjs', 'text/javascript'];
staticFiles['/routing.mjs'] = ['routing.mjs', 'text/javascript'];
staticFiles['/chat-flow.mjs'] = ['chat-flow.mjs', 'text/javascript'];
const MAX_BODY = limits.requestBytes;

function reply(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

export function createApp({ apiKey = process.env.ANTHROPIC_API_KEY, model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6', fetchImpl = fetch, adminCredentialLoader, mockAuth = process.env.MOCK_AUTH === 'true', quotaStore, conversationStore, resolveUser, summarizeHistory = process.env.SUMMARIZE_HISTORY !== 'false' } = {}) {
  const quota = quotaStore;
  if (!quota) throw new Error('PostgreSQL deposu gerekli.');
  const identify = resolveUser || (req => quota.authenticate(req));
  let busy = false;
  let recent = [];
  const telemetry = createTelemetry();
  const historyContext = createHistoryContext();
  const handleAdmin = createAdmin({ credentialLoader: adminCredentialLoader, telemetry, model });
  let activeRequests = 0;
  let closing = false;
  let storageClosing = false;
  function closeStorageWhenIdle() {
    if (!closing || activeRequests || storageClosing) return;
    storageClosing = true;
    Promise.resolve(quota.close()).catch(() => console.error('Veritabanı bağlantısı kapatılamadı.'));
  }
  const server = http.createServer(async (req, res) => {
    activeRequests++;
    let ticket;
    let quotaCompleted = false;
    let lease;
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
      if (path === '/api/me' && req.method === 'GET') {
        const user = await identify(req);
        return user ? reply(res, 200, { user, mock: mockAuth, quota: await quota.status(user.id) }) : reply(res, 401, { mock: mockAuth, error: 'Madset hesabına giriş yapmalısın.' });
      }
      if (mockAuth && path === '/api/mock/accounts' && req.method === 'GET') return reply(res, 200, { accounts: await quota.accounts(), mock: true });
      if (mockAuth && path === '/api/mock/logout' && req.method === 'POST') {
        await quota.logout(req);
        res.setHeader('Set-Cookie', 'pursuk_mock=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');
        return reply(res, 200, { ok: true });
      }
      if (conversationStore && req.method === 'GET' && path.startsWith('/api/conversations/')) {
        const user=await identify(req);
        if (!user) return reply(res,401,{error:'Madset hesabına giriş yapmalısın.'});
        const id=path.slice('/api/conversations/'.length);
        if (id!=='latest' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return reply(res,400,{error:'Sohbet kimliği geçersiz.'});
        const conversation=await conversationStore.conversation(user.id,id==='latest'?undefined:id);
        return conversation ? reply(res,200,conversation) : reply(res,404,{error:'Sohbet bulunamadı.'});
      }
      if (req.method === 'GET' && staticFiles[path]) {
        const [file, type] = staticFiles[path];
        const content = await readFile(new URL(file, root));
        res.writeHead(200, { 'Content-Type': type.startsWith('image/') ? type : `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
        return res.end(content);
      }
      const mockLogin = mockAuth && path === '/api/mock/login';
      if (req.method !== 'POST' || (path !== '/api/chat' && !mockLogin)) return reply(res, 404, { error: 'Bulunamadı.' });
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
      if (mockLogin) {
        const login = typeof body?.accountId === 'string' ? await quota.login(body.accountId) : null;
        if (!login) return reply(res, 400, { error: 'Örnek hesap bulunamadı.' });
        res.setHeader('Set-Cookie', 'pursuk_mock=' + login.token + '; HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800');
        return reply(res, 200, { user: login.user, mock: true });
      }
      const user = await identify(req);
      if (!user || typeof user.id !== 'string' || !user.id) return reply(res, 401, { error: 'Pursuk ile konuşmak için Madset hesabına giriş yapmalısın.' });
      if (!validMessages(body?.messages)) return reply(res, 400, { error: 'Sohbet çok uzun veya mesaj biçimi geçersiz. Yeni sohbet açıp tekrar deneyebilirsin; kullanım hakkın hesabına bağlıdır.' });
      if (conversationStore) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.conversationId || '')) return reply(res,400,{error:'Sohbet kimliği geçersiz. Sayfayı yenileyip tekrar dene.'});
        lease = await conversationStore.beginConversation(user.id,body.conversationId);
        if (!lease) return reply(res,409,{error:'Bu sohbette bir yanıt hazırlanıyor. Tamamlandıktan sonra tekrar dene.'});
        body.messages = [...lease.messages,body.messages.at(-1)];
        if (!validMessages(body.messages)) return reply(res,400,{error:'Bu sohbet çok uzadı. Yeni sohbet açarak devam edebilirsin; mesaj hakkın korunur.'});
      }
      async function saveAnswer(answer,choices=[]) {
        if (lease) await conversationStore.completeConversation(lease,[...body.messages,{role:'assistant',content:answer}],choices,ticket);
        else if (quota.commit) await quota.commit(ticket);
        quotaCompleted=true;
      }
      let faq = null;
      if (body.action !== undefined) {
        if (typeof body.action !== 'string' || !Object.hasOwn(flowActions, body.action)) return reply(res, 400, { error: 'Bu seçenek bulunamadı. Lütfen tekrar seç.' });
        try { faq = await findFaqById(flowActions[body.action].topic); } catch { /* Fixed flows must not fall back to paid API calls. */ }
        if (!faq) return reply(res, 503, { error: 'Bu bilgiye şu anda ulaşamıyorum. Lütfen tekrar dene.' });
        faq = { ...faq, matchType: 'guided' };
      } else {
        try { faq = await findFaq(body.messages.at(-1).content); } catch { /* If the catalogue is unavailable, use Claude. */ }
      }
      if (!faq) {
        if (!apiKey) return reply(res, 503, { error: 'Şu anda yanıt veremiyorum. Lütfen biraz sonra tekrar dene.' });
        recent = recent.filter(t => Date.now() - t < 60000);
        if (busy || recent.length >= 20) return reply(res, 429, { error: 'Kısa süre içinde çok fazla istek geldi. Biraz sonra tekrar deneyin.' });
      }
      ticket = await quota.reserve(user.id);
      if (!ticket.allowed) return reply(res, 429, { error: ticket.error, code: 'quota_' + ticket.reason });
      if (faq) {
        const choices = choicesForTopic(faq.id);
        await saveAnswer(faq.answer,choices);
        const route = { source: 'faq', topic: faq.id, method: faq.matchType };
        const measurement = { id: randomUUID(), model: 'hazir-yanit', source: 'faq', complete: true, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, estimatedUsd: 0, priceDate: null };
        telemetry.record(measurement.id, body.messages.at(-1).content, route, measurement, true);
        if (body.stream === true) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' });
          res.write(`data: ${JSON.stringify({ type: 'text', text: faq.answer })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'done', truncated: false, ...(choices.length ? { choices } : {}) })}\n\n`);
          return res.end();
        }
        return reply(res, 200, { answer: faq.answer, truncated: false, ...(choices.length ? { choices } : {}) });
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
        const signal = AbortSignal.any([AbortSignal.timeout(limits.responseTimeoutMs), disconnected.signal]);
        const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
        const context = await historyContext.prepare(body.messages, {
          conversationId: summarizeHistory && typeof body.conversationId === 'string' ? createHash('sha256').update(user.id + ':' + body.conversationId).digest('hex').slice(0, 36) : undefined,
          persistentEntries: lease?.summary_cache,
          generate: async prefix => {
            if (recent.length >= 20) throw new Error('Rate limit');
            recent.push(Date.now());
            const summaryId = randomUUID();
            telemetry.record(summaryId, 'Eski konuşma özeti', { source: 'summary' }, null);
            const result = await fetchImpl('https://api.anthropic.com/v1/messages', {
              method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), headers,
              body: JSON.stringify({ model, max_tokens: 450, stream: false, system: summaryInstructions, messages: [{ role: 'user', content: JSON.stringify(prefix) }] })
            });
            if (!result.ok) throw new Error('Summary unavailable');
            const data = await result.json();
            telemetry.record(summaryId, 'Eski konuşma özeti', { source: 'summary' }, measureUsage(data.usage, { id: summaryId, model: data.model || model, complete: true }), true);
            if (data.stop_reason !== 'end_turn') throw new Error('Summary incomplete');
            return data.content?.filter(block => block.type === 'text').map(block => block.text).join('\n');
          }
        });
        if (lease) await conversationStore.saveSummaryCache(lease,lease.summary_cache);
        const answerRoute = { source: 'llm', context: context.info };
        telemetry.record(callId, question, answerRoute, null);
        const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal, headers,
          body: JSON.stringify({ model, max_tokens: 650, stream: body.stream === true, system: `${instructions}\n\n<MADSET_BILGI_KAYNAGI>\n${knowledge}\n</MADSET_BILGI_KAYNAGI>`, messages: context.messages })
        });
        if (!upstream.ok) {
          return reply(res, 502, { error: 'Şu anda yanıt veremiyorum. Lütfen biraz sonra tekrar dene.' });
        }
        if (body.stream === true) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
          res.flushHeaders();
          const emit = event => { if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
          let receivedText = false;
          let completeAnswer = '';
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
              completeAnswer += event.delta.text;
              emit({ type: 'text', text: event.delta.text });
            }
            if (event.type === 'message_delta') truncated = event.delta?.stop_reason === 'max_tokens';
            if (event.type === 'message_stop') { stopped = true; break; }
          }
          if (!stopped || !receivedText) throw new Error('Incomplete response');
          telemetry.record(callId, question, { source: 'llm' }, measureUsage(usage, { id: measurementId, model: servingModel, complete: true }), true);
          await saveAnswer(completeAnswer);
          emit({ type: 'done', truncated });
          return res.end();
        }
        const data = await upstream.json();
        const answer = data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n');
        if (!answer) return reply(res, 502, { error: 'Claude metin yanıtı döndürmedi. Tekrar deneyin.' });
        telemetry.record(callId, question, { source: 'llm' }, measureUsage(data.usage, { id: callId, model: data.model || model, complete: true }), true);
        await saveAnswer(answer);
        return reply(res, 200, { answer, truncated: data.stop_reason === 'max_tokens' });
      } finally { busy = false; }
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Yanıt tamamlanamadı. Tekrar deneyebilirsin.' })}\n\n`);
        return res.end();
      }
      reply(res, 502, { error: ['TimeoutError', 'AbortError'].includes(error.name) ? 'Yanıt süresi doldu. Tekrar deneyin.' : 'Bağlantı kurulamadı. İnternet bağlantısını kontrol edip tekrar deneyin.' });
    } finally {
      try { if (ticket?.allowed && !quotaCompleted) await quota.release(ticket); }
      catch { console.error('Mesaj hakkı iadesi tamamlanamadı; veritabanı bağlantısını kontrol edin.'); }
      try { if (lease) await conversationStore.endConversation(lease); }
      catch { console.error('Sohbet kilidi bırakılamadı; kısa süre sonra kendiliğinden açılacak.'); }
      activeRequests--;
      closeStorageWhenIdle();
    }
  });
  server.on('close', () => { closing = true; closeStorageWhenIdle(); });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 4317);
  let store;
  try {
    await startLocalPostgres();
    store = await createPostgresStore({mock:process.env.MOCK_AUTH==='true'});
  } catch {
    console.error('PostgreSQL bağlantısı kurulamadı. DATABASE_URL ayarını ve veritabanı hizmetini kontrol edin. Veriler geçici belleğe taşınmadı.');
    if(store) await store.close();
    process.exit(1);
  }
  const app = createApp({quotaStore:store,conversationStore:store});
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
