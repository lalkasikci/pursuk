export async function* readEvents(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) yield JSON.parse(data);
      }
      if (done) break;
    }
    if (buffer.trim()) throw new Error('Incomplete stream');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
