export const E2E_FIXTURES = {
  projectCreate: {
    title: 'E2E Create Open Project',
  },
  projectEdit: {
    originalTitle: 'E2E Project Before Edit',
    updatedTitle: 'E2E Project After Edit',
  },
  chapterSave: {
    projectTitle: 'E2E Chapter Persistence Project',
    volumeTitle: 'E2E Persistence Volume',
    chapterTitle: 'E2E Persistence Chapter',
    content: 'The fixed desktop E2E chapter body persists through navigation and reopening.',
  },
  candidateApply: {
    projectTitle: 'E2E Candidate Review Project',
    mockExpectedFragment: '时间不多了。',
  },
  leaveGuard: {
    projectTitle: 'E2E Leave Guard Project',
    secondChapterTitle: 'E2E Second Chapter',
    unsavedContent: 'The fixed leave guard draft must remain intact until the user chooses how to leave.',
    discardedContent: 'This later unsaved edit must be discarded without replacing or deleting the saved snapshot.',
  },
  largeText: {
    projectTitle: 'E2E Large Text Project',
    corruptionProjectTitle: 'E2E Corrupt Large Text Project',
    volumeTitle: 'E2E Large Text Volume',
    chapterTitle: 'E2E Large Text Chapter',
    safeChapterTitle: 'E2E Safe Chapter',
    safeContent: 'This safe chapter must remain active when a corrupted large-text draft cannot be read.',
  },
  generationCancel: {
    projectTitle: 'E2E Generation Cancellation Project',
    volumeTitle: 'E2E Cancellation Volume',
    chapterTitle: 'E2E Cancellation Chapter',
  },
} as const;

const LARGE_TEXT_MINIMUM_BYTES = 120 * 1024;
const LARGE_TEXT_MINIMUM_CHARACTERS = 70 * 1024;

/** Deterministic source text with CJK, astral emoji, and CRLF input boundaries. */
export function createLargeTextContent(): string {
  const paragraphs: string[] = [];
  let byteLength = 0;
  let characterLength = 0;

  for (
    let index = 1;
    byteLength <= LARGE_TEXT_MINIMUM_BYTES || characterLength <= LARGE_TEXT_MINIMUM_CHARACTERS;
    index += 1
  ) {
    const serial = String(index).padStart(4, '0');
    paragraphs.push(
      `第${serial}段：雨落在旧城的青瓦上，林舟记下潮汐与灯塔的位置🧭，确认每一道回声都属于当前章节。\r\n`
      + `第二行保留 Windows 换行输入，并让同行者说：“档案 ${serial} 已核对。”随后点亮信标🚀。`,
    );
    const canonicalContent = paragraphs.join('\r\n\r\n').replace(/\r\n/g, '\n');
    byteLength = new TextEncoder().encode(canonicalContent).byteLength;
    characterLength = [...canonicalContent].length;
  }

  const content = paragraphs.join('\r\n\r\n');
  const canonicalContent = content.replace(/\r\n/g, '\n');
  if (
    new TextEncoder().encode(canonicalContent).byteLength <= LARGE_TEXT_MINIMUM_BYTES
    || [...canonicalContent].length <= LARGE_TEXT_MINIMUM_CHARACTERS
  ) {
    throw new Error('Large-text fixture did not exceed the byte and character chunk boundaries');
  }
  return content;
}
