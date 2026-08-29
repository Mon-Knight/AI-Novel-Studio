/** SHA-256 used by the durable document and recovery protocols. */
export async function computeContentSha256(content: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(content);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  }

  const error = new Error('当前环境不能生成可靠的 SHA-256。') as Error & { code: string };
  error.code = 'CONTENT_SHA256_UNAVAILABLE';
  throw error;
}
