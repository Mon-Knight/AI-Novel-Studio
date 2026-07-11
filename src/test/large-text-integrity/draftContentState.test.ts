import { describe, expect, it } from 'vitest';

import { isDraftContentReady, type DraftContentState } from '../../types/draftContentState';

describe('large-text content state contract', () => {
  it('only exposes editable content for a verified ready state', () => {
    const ready: DraftContentState = {
      status: 'ready',
      content: '完整正文',
      contentHash: 'verified-hash',
      contentLength: 4,
    };
    const unavailable: DraftContentState = {
      status: 'unavailable',
      preview: '截断预览',
      errorCode: 'LARGE_TEXT_CONTENT_UNAVAILABLE',
      retryable: true,
    };

    expect(isDraftContentReady(ready)).toBe(true);
    expect(isDraftContentReady(unavailable)).toBe(false);
    expect('content' in unavailable).toBe(false);
  });
});
