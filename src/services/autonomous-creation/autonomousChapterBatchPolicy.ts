export const AUTONOMOUS_CHAPTER_BATCH_SIZE = 5;

export function resolveAutonomousChapterBatchMaxTokens(chapterCount: number): number {
  if (
    !Number.isInteger(chapterCount) ||
    chapterCount < 1 ||
    chapterCount > AUTONOMOUS_CHAPTER_BATCH_SIZE
  ) {
    throw new Error(`章节规划子批次必须包含 1-${AUTONOMOUS_CHAPTER_BATCH_SIZE} 章。`);
  }
  return Math.min(4_500, Math.max(2_000, 1_500 + chapterCount * 600));
}

export function createAutonomousChapterBatchRequestId(input: {
  operationId: string;
  volumeIndex: number;
  chapterStart: number;
  chapterEnd: number;
}): string {
  return `${input.operationId}-volume-${input.volumeIndex + 1}-chapters-${input.chapterStart}-${input.chapterEnd}`;
}
