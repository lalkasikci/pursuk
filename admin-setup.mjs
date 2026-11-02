import { hashPassword } from './admin-auth.mjs';
import { writeFile } from 'node:fs/promises';
try {
  let password = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    password += chunk.toString('utf8');
    if (password.length > 1024) throw new Error('Invalid');
  }
  password = password.replace(/\r?\n$/, '');
  if (password.length < 12 || password.length > 200 || /[\r\n\x00]/.test(password)) {
    console.error('Sifre 12-200 karakter olmali. Tekrar deneyin.');
    process.exitCode = 1;
  } else {
    const credentials = await hashPassword(password);
    password = '';
    await writeFile(new URL('./.admin-auth.json', import.meta.url), JSON.stringify(credentials), { mode: 0o600 });
    console.log('Yonetim sifresi kaydedildi. Tarayicida /admin sayfasindan giris yapabilirsiniz.');
  }
} catch { console.error('Sifre kaydedilemedi. Tekrar deneyin.'); process.exitCode = 1; }
