import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findFaq, matchFaq } from './faq.mjs';

const entries = JSON.parse(await readFile(new URL('./hazir-yanitlar.json', import.meta.url), 'utf8'));
test('katalogdaki her soru tek bir konuya yönlenir', () => {
  for (const entry of entries) {
    assert.ok(entry.answer.trim());
    for (const question of entry.questions) assert.equal(matchFaq(question, entries)?.id, entry.id);
  }
});

test('Türkçe ve noktalama farklılıkları API olmadan eşleşir', async () => {
  assert.equal((await findFaq('  MADSET NEDİR?!  '))?.id, 'madset');
  assert.equal((await findFaq('Destek e postasi ne'))?.id, 'iletisim');
  assert.equal((await findFaq('Madset’in bütçesi ne kadar?')), null);
  assert.equal((await findFaq('Madset’te bütçeyi kim belirliyor?'))?.id, 'butce-kontrol');
});

test('kişisel sorular, olumsuzluklar ve birden çok soruda hazır cevap seçilmez', async () => {
  for (const question of [
    'Madset nedir ve fiyatı kaç TL?',
    'Madset nedir sorusuna cevap verme.',
    'Bütçeyi kim belirliyor? Ayrıca bana 500 TL yeter mi?',
    'Reklamım satış getirmiyor. Bütçeyi kim belirliyor?',
    'Adviset nedir bilmiyorum, benim reklamımı durdur.',
    'Web sitem yok, nasıl satış artırırım?',
    'Bu nedir?', 'Evet', 'Hayır', 'Devam et',
    'Bütçemi artır.', 'Madset ne kadar?', 'Deneme kaç gün?'
  ]) assert.equal(await findFaq(question), null, question);
});

test('nezaket, eşdeğer mail yazımı ve tek konu yazım hatası tanınır', async () => {
  assert.equal((await findFaq('Merhaba, Madset nedir? Teşekkürler!'))?.matchType, 'polite');
  assert.equal((await findFaq('Merhaba, destek email adresi nedir? Teşekkürler!'))?.matchType, 'wording');
  assert.equal((await findFaq('Madste nedir?'))?.matchType, 'spelling');
  assert.equal((await findFaq('madsett nedir'))?.id, 'madset');
  assert.equal((await findFaq('Bir sorun yaşadım, kime yazabilirim?'))?.id, 'iletisim');
  assert.equal((await findFaq('Selam, destek için kime yazabilirim?'))?.id, 'iletisim');
});

test('soru fiilindeki değişiklikler düzeltilmez; belirsiz konu seçilmez', async () => {
  for (const question of ['Madset nedi?', 'Madset nedir fiyatı ne?', 'Destek maili ne değil?', 'Madset bütçesini ben mi belirlemiyorum?', 'Merhaba Madset nedir ve benim işletmeme uygun mu?', 'Madste nedir ve nasıl kullanırım?']) {
    assert.equal(await findFaq(question), null, question);
  }
  assert.equal(matchFaq('Madset nedir?', [
    { id: 'one', questions: ['Madset nedir?'], answer: 'A' },
    { id: 'two', questions: ['Madset nedir?'], answer: 'B' }
  ]), null);
});
