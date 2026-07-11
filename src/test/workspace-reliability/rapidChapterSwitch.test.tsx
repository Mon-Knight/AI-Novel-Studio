import { useRef, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  MonotonicDocumentLoadGuard,
  resolveGuardedDocumentLoad,
} from '../../features/workspace/documentSafety';
import { deferred, type Deferred } from '../deferred';

function RapidSwitchHarness({ loads }: { loads: Record<string, Deferred<string>> }) {
  const [chapterId, setChapterId] = useState('chapter-a');
  const [content, setContent] = useState('chapter-a-content');
  const liveChapterRef = useRef(chapterId);
  const guardRef = useRef(new MonotonicDocumentLoadGuard());

  const selectChapter = async (nextChapterId: string) => {
    liveChapterRef.current = nextChapterId;
    setChapterId(nextChapterId);
    const target = { novelId: 'novel-a', chapterId: nextChapterId };
    const token = guardRef.current.issue(target);
    const resolved = await resolveGuardedDocumentLoad(
      guardRef.current,
      token,
      loads[nextChapterId].promise,
      () => ({ novelId: 'novel-a', chapterId: liveChapterRef.current }),
    );
    if (resolved.accepted) setContent(resolved.value);
  };

  return (
    <div>
      <button onClick={() => void selectChapter('chapter-b')}>章节 B</button>
      <button onClick={() => void selectChapter('chapter-c')}>章节 C</button>
      <div data-testid="active-chapter">{chapterId}</div>
      <textarea aria-label="正文" readOnly value={content} />
    </div>
  );
}

describe('T01 - React rapid chapter switching', () => {
  it('keeps C in the editor when B resolves last', async () => {
    const loads = {
      'chapter-b': deferred<string>(),
      'chapter-c': deferred<string>(),
    };
    const user = userEvent.setup();
    render(<RapidSwitchHarness loads={loads} />);

    await user.click(screen.getByRole('button', { name: '章节 B' }));
    await user.click(screen.getByRole('button', { name: '章节 C' }));
    expect(screen.getByTestId('active-chapter').textContent).toBe('chapter-c');

    await act(async () => loads['chapter-c'].resolve('chapter-c-content'));
    expect((screen.getByRole('textbox', { name: '正文' }) as HTMLTextAreaElement).value)
      .toBe('chapter-c-content');

    await act(async () => loads['chapter-b'].resolve('late-chapter-b-content'));
    expect((screen.getByRole('textbox', { name: '正文' }) as HTMLTextAreaElement).value)
      .toBe('chapter-c-content');
  });
});
