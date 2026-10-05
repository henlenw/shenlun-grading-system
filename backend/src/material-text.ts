// Shared with the website. Render text and a small set of formatting ranges, never raw HTML.
export type MaterialStyle = 'underline' | 'highlight' | 'strike' | 'circle' | 'bold' | 'italic';
export type MaterialRange = { start: number; end: number; type: MaterialStyle };
export type StudentMark = MaterialRange & { id: string; selectedText: string };
function entities(text: string) {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
  };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, key: string) => {
    if (!key.startsWith('#')) return named[key.toLowerCase()] || all;
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all;
  });
}
export function materialText(raw: string) {
  let text = '';
  const formatting: MaterialRange[] = [];
  const stack: { tag: string; start: number; types: MaterialStyle[] }[] = [];
  const end = (item: (typeof stack)[number]) => {
    if (text.length > item.start)
      for (const type of item.types) formatting.push({ start: item.start, end: text.length, type });
  };
  const newline = () => {
    if (text && !text.endsWith('\n')) text += '\n';
  };
  const parts = (raw || '').split(
    /(<\/?(?:u|b|strong|em|i|s|del|mark|span|p|div|br|li)(?:\s[^<>]*)?\s*\/?>)/gi,
  );
  for (const part of parts) {
    const tag = /^<(\/?)(u|b|strong|em|i|s|del|mark|span|p|div|br|li)(?:\s[^<>]*)?\s*\/?>$/i.exec(
      part,
    );
    if (!tag) {
      text += entities(part);
      continue;
    }
    const name = tag[2].toLowerCase();
    if (name === 'br') {
      text += '\n';
      continue;
    }
    if (tag[1]) {
      const i = stack.map((x) => x.tag).lastIndexOf(name);
      if (i >= 0) for (const item of stack.splice(i)) end(item);
      if (['p', 'div', 'li'].includes(name)) newline();
    } else {
      if (['p', 'div', 'li'].includes(name)) newline();
      const types: MaterialStyle[] = [];
      if (
        name === 'u' ||
        (name === 'span' && /text-decoration(?:-line)?\s*:\s*[^;"']*underline/i.test(part))
      )
        types.push('underline');
      if (name === 'mark') types.push('highlight');
      if (['s', 'del'].includes(name)) types.push('strike');
      if (['b', 'strong'].includes(name)) types.push('bold');
      if (['em', 'i'].includes(name)) types.push('italic');
      stack.push({ tag: name, start: text.length, types });
    }
  }
  for (const item of stack) end(item);
  return { text, formatting };
}
export function materialSegments(text: string, ranges: MaterialRange[]) {
  const valid = ranges.filter((r) => r.start >= 0 && r.end <= text.length && r.end > r.start);
  const cuts = [...new Set([0, text.length, ...valid.flatMap((r) => [r.start, r.end])])].sort(
    (a, b) => a - b,
  );
  return cuts.slice(0, -1).map((start, i) => ({
    start,
    text: text.slice(start, cuts[i + 1]),
    styles: [
      ...new Set(valid.filter((r) => r.start <= start && r.end >= cuts[i + 1]).map((r) => r.type)),
    ],
  }));
}
