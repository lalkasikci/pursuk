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
  const polite = normalized
    .replace(/^(?:(?:merhaba|selam|selamlar|iyi gunler|lutfen) )+/, '')
    .replace(/ (?:tesekkurler|tesekkur ederim|sag ol|sag olun)$/, '').trim();
  const canonical = value => value.replace(/\b(?:e posta|eposta|e mail|email)\b/g, 'mail');
  const typoWords = new Set(['madset', 'pursuk', 'adviset', 'mindset', 'destek', 'reklam', 'butce', 'iletisim', 'instagram', 'platform']);
  function singleTypo(a, b) {
    if (a === b) return true;
    if (!typoWords.has(b) || b.length < 6 || Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  const matches = [];
  for (const entry of entries) {
    if (typeof entry.answer !== 'string' || !entry.answer.trim() || !Array.isArray(entry.questions)) continue;
    let best = null;
    for (const alias of entry.questions) {
      const target = normalizeQuestion(alias);
      if (normalized === target) { best = 'exact'; break; }
      if (polite === target) { best = 'polite'; continue; }
      if (canonical(polite) === canonical(target)) { best ||= 'wording'; continue; }
      const words = canonical(polite).split(' ');
      const targets = canonical(target).split(' ');
      // Tolerate one typo in a known topic word only. All other words,
      // including negation, requests, and question words must match exactly.
      if (!best && words.length === targets.length && words.length >= 2 &&
        words.filter((word, i) => word !== targets[i]).length === 1 &&
        words.every((word, i) => singleTypo(word, targets[i]))) best = 'spelling';
    }
    if (best) matches.push({ ...entry, matchType: best });
  }
  // Ambiguous matches go to Claude instead of guessing a topic.
  return matches.length === 1 ? matches[0] : null;
}

export async function findFaq(question) {
  const entries = JSON.parse(await readFile(new URL('./hazir-yanitlar.json', import.meta.url), 'utf8'));
  return matchFaq(question, entries);
}
