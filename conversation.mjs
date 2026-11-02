export const limits = Object.freeze({ messages: 60, perMessage: 6000, totalCharacters: 120000, requestBytes: 750000, responseTimeoutMs: 120000 });
export const storageKey = 'porsuk-conversation-v1';

export function validMessages(messages) {
  return Array.isArray(messages) && messages.length > 0 && messages.length <= limits.messages &&
    messages.at(-1)?.role === 'user' && messages.every((m, i) => m &&
      m.role === (i % 2 === 0 ? 'user' : 'assistant') && typeof m.content === 'string' &&
      m.content.trim().length > 0 && m.content.length <= limits.perMessage) &&
    messages.reduce((n, m) => n + m.content.length, 0) <= limits.totalCharacters;
}

export function restoreConversation(storage) {
  try {
    const saved = JSON.parse(storage.getItem(storageKey));
    if (!Array.isArray(saved) || saved.length % 2 !== 0 || saved.length > 200) return [];
    if (saved.length === 0) return [];
    // Only restore complete pairs with valid roles and bounded text.
    if (!saved.every((m, i) => m && m.role === (i % 2 === 0 ? 'user' : 'assistant') && typeof m.content === 'string' && m.content.trim().length && m.content.length <= limits.perMessage)) return [];
    if (saved.reduce((n, m) => n + m.content.length, 0) > limits.totalCharacters + limits.perMessage) return [];
    return saved.map(({ role, content }) => ({ role, content }));
  } catch { return []; }
}
