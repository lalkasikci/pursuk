import { readFile } from 'node:fs/promises';

export function normalizeQuestion(text) {
  return text.normalize('NFKC').toLocaleLowerCase('tr-TR')
    .replace(/[’'`]/g, '')
    .replace(/[çğıöşü]/g, letter => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[letter])
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function matchFaq(question, entries) {
  const normalized = normalizeQuestion(question);
  if (!normalized || question.length > 240) return null;
  // Whole-question aliases only: no substring or fuzzy match that could hide
  // negation, a second question, personal context, or an action request.
  return entries.find(entry => typeof entry.answer === 'string' && entry.answer.trim() &&
    Array.isArray(entry.questions) && entry.questions.some(alias => normalizeQuestion(alias) === normalized)) || null;
}

export async function findFaq(question) {
  const entries = JSON.parse(await readFile(new URL('./hazir-yanitlar.json', import.meta.url), 'utf8'));
  return matchFaq(question, entries);
}
