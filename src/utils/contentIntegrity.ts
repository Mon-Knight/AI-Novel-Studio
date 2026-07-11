/** SHA-256 used by the durable document and recovery protocols. */
export async function computeContentSha256(content: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = new TextEncoder().encode(content);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // Browser fallback is intentionally deterministic. Tauri/web production
  // environments provide Web Crypto; this keeps local tests functional.
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
