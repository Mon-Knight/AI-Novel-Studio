import type {
  ChapterRevision,
  ChapterRevisionTag,
  ChapterVersionHistory,
  CreateChapterRevisionInput,
  RevisionDiff,
  RevisionDiffChunk,
} from '../../types/chapterVersion';

export function computeProseCounts(text: string): { wordCount: number; characterCount: number } {
  const normalized = String(text || '').trim();
  const characterCount = normalized.replace(/\s+/g, '').length;
  // 按照中文字符 + 英文单词统计
  const words = normalized.split(/\s+/).filter(Boolean).length;
  const cjkChars = (normalized.match(/[\u4e00-\u9fa5]/g) || []).length;
  const wordCount = Math.max(cjkChars, words);
  return { wordCount, characterCount };
}

export class ChapterVersionService {
  private revisionsMap = new Map<string, ChapterRevision[]>();

  /**
   * 创建并存证新的章节版本
   */
  async createRevision(input: CreateChapterRevisionInput): Promise<ChapterRevision> {
    const chapterId = input.chapterId.trim();
    const novelId = input.novelId.trim();
    const history = this.revisionsMap.get(chapterId) ?? [];
    const revisionNumber = history.length + 1;

    const { wordCount, characterCount } = computeProseCounts(input.content);
    const isAdopted = input.isAdopted === true || history.length === 0;
    const tag: ChapterRevisionTag = input.tag ?? (isAdopted ? 'adopted' : 'candidate');

    const revision: ChapterRevision = {
      revisionId: `rev-${chapterId}-v${revisionNumber}-${Date.now().toString(36)}`,
      chapterId,
      novelId,
      revisionNumber,
      title: input.title.trim(),
      content: input.content,
      wordCount,
      characterCount,
      source: input.source,
      tag,
      isAdopted,
      provenance: input.provenance ?? {},
      summary: input.summary?.trim(),
      createdAt: new Date().toISOString(),
    };

    if (isAdopted) {
      for (const rev of history) {
        rev.isAdopted = false;
        if (rev.tag === 'adopted') {
          rev.tag = 'draft';
        }
      }
    }

    history.push(revision);
    this.revisionsMap.set(chapterId, history);
    return revision;
  }

  /**
   * 获取特定章节的指定版本
   */
  getRevision(chapterId: string, revisionId: string): ChapterRevision | undefined {
    const history = this.revisionsMap.get(chapterId.trim()) ?? [];
    return history.find((r) => r.revisionId === revisionId.trim());
  }

  /**
   * 列出指定章节的所有历史版本 (按版本号升序)
   */
  listRevisions(chapterId: string): ChapterRevision[] {
    const history = this.revisionsMap.get(chapterId.trim()) ?? [];
    return [...history];
  }

  /**
   * 获取当前采用中的版本
   */
  getAdoptedRevision(chapterId: string): ChapterRevision | undefined {
    const history = this.revisionsMap.get(chapterId.trim()) ?? [];
    return history.find((r) => r.isAdopted);
  }

  /**
   * 采用指定版本
   */
  async adoptRevision(chapterId: string, revisionId: string): Promise<ChapterRevision> {
    const cid = chapterId.trim();
    const rid = revisionId.trim();
    const history = this.revisionsMap.get(cid) ?? [];
    const target = history.find((r) => r.revisionId === rid);

    if (!target) {
      throw new Error(`章节版本 [${rid}] 未找到。`);
    }

    for (const rev of history) {
      rev.isAdopted = rev.revisionId === rid;
      if (rev.revisionId === rid) {
        rev.tag = 'adopted';
      } else if (rev.tag === 'adopted') {
        rev.tag = 'draft';
      }
    }

    return target;
  }

  /**
   * 计算两个版本间的行级与字符级 Diff 差异
   */
  compareRevisions(fromRev: ChapterRevision, toRev: ChapterRevision): RevisionDiff {
    const fromLines = fromRev.content.split('\n');
    const toLines = toRev.content.split('\n');

    const diffChunks: RevisionDiffChunk[] = [];
    let addedCharacters = 0;
    let removedCharacters = 0;
    let addedLines = 0;
    let removedLines = 0;

    const maxLen = Math.max(fromLines.length, toLines.length);

    for (let i = 0; i < maxLen; i++) {
      const fromLine = fromLines[i];
      const toLine = toLines[i];

      if (fromLine === undefined && toLine !== undefined) {
        // 新增行
        addedLines++;
        addedCharacters += toLine.length;
        diffChunks.push({
          type: 'added',
          value: toLine,
          toLineNo: i + 1,
        });
      } else if (toLine === undefined && fromLine !== undefined) {
        // 删除行
        removedLines++;
        removedCharacters += fromLine.length;
        diffChunks.push({
          type: 'removed',
          value: fromLine,
          fromLineNo: i + 1,
        });
      } else if (fromLine === toLine) {
        // 未变动行
        diffChunks.push({
          type: 'unchanged',
          value: fromLine,
          fromLineNo: i + 1,
          toLineNo: i + 1,
        });
      } else {
        // 修改行 (拆分为删除与新增)
        removedLines++;
        removedCharacters += fromLine.length;
        diffChunks.push({
          type: 'removed',
          value: fromLine,
          fromLineNo: i + 1,
        });

        addedLines++;
        addedCharacters += toLine.length;
        diffChunks.push({
          type: 'added',
          value: toLine,
          toLineNo: i + 1,
        });
      }
    }

    const netCharDiff = toRev.characterCount - fromRev.characterCount;
    const summary =
      netCharDiff >= 0
        ? `版本 v${toRev.revisionNumber} 相对 v${fromRev.revisionNumber}：净增 ${netCharDiff} 字 (+${addedLines} 行, -${removedLines} 行)`
        : `版本 v${toRev.revisionNumber} 相对 v${fromRev.revisionNumber}：净减 ${Math.abs(netCharDiff)} 字 (+${addedLines} 行, -${removedLines} 行)`;

    return {
      fromRevisionId: fromRev.revisionId,
      toRevisionId: toRev.revisionId,
      fromRevisionNumber: fromRev.revisionNumber,
      toRevisionNumber: toRev.revisionNumber,
      addedCharacters,
      removedCharacters,
      addedLines,
      removedLines,
      diffChunks,
      summary,
    };
  }

  /**
   * 根据版本 ID 对比两个版本
   */
  compareByRevisionIds(chapterId: string, fromRevisionId: string, toRevisionId: string): RevisionDiff {
    const fromRev = this.getRevision(chapterId, fromRevisionId);
    const toRev = this.getRevision(chapterId, toRevisionId);

    if (!fromRev || !toRev) {
      throw new Error(`无法比对版本：版本不存在。`);
    }

    return this.compareRevisions(fromRev, toRev);
  }

  /**
   * 安全回滚至历史版本 (创建新的回滚版本记录，保证历史不可变)
   */
  async rollbackToRevision(
    chapterId: string,
    targetRevisionId: string,
    reason?: string,
  ): Promise<ChapterRevision> {
    const target = this.getRevision(chapterId, targetRevisionId);
    if (!target) {
      throw new Error(`目标回滚版本 [${targetRevisionId}] 不存在。`);
    }

    const summaryText = `从版本 v${target.revisionNumber} 回滚` + (reason ? `：${reason}` : '');

    return this.createRevision({
      chapterId: target.chapterId,
      novelId: target.novelId,
      title: target.title,
      content: target.content,
      source: 'rollback',
      tag: 'adopted',
      isAdopted: true,
      provenance: {
        ...target.provenance,
        routeReason: 'rollback_restoration',
        author: 'system_rollback',
      },
      summary: summaryText,
    });
  }

  /**
   * 修改版本标签
   */
  async tagRevision(
    chapterId: string,
    revisionId: string,
    tag: ChapterRevisionTag,
  ): Promise<ChapterRevision> {
    const target = this.getRevision(chapterId, revisionId);
    if (!target) {
      throw new Error(`版本 [${revisionId}] 不存在。`);
    }
    target.tag = tag;
    return target;
  }

  /**
   * 获取章节版本历史聚合结构
   */
  getHistory(chapterId: string, novelId = ''): ChapterVersionHistory {
    const cid = chapterId.trim();
    const history = this.revisionsMap.get(cid) ?? [];
    const adopted = history.find((r) => r.isAdopted);
    const current = history[history.length - 1];

    return {
      chapterId: cid,
      novelId: novelId || history[0]?.novelId || '',
      currentRevisionId: current?.revisionId,
      adoptedRevisionId: adopted?.revisionId,
      totalRevisions: history.length,
      revisions: [...history],
    };
  }

  reset(chapterId?: string): void {
    if (chapterId) {
      this.revisionsMap.delete(chapterId.trim());
    } else {
      this.revisionsMap.clear();
    }
  }
}

export const chapterVersionService = new ChapterVersionService();
