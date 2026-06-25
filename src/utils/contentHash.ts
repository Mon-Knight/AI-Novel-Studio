export function countTextWords(text: string): number {
  const cleaned = text.replace(/[#*\-`>\s]+/g, ' ').trim();
  if (!cleaned) return 0;
  const cjk = (cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const words = (cleaned.match(/[a-zA-Z0-9]+/g) || []).length;
  return cjk + words;
}

export function hashTextContent(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `txt_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
