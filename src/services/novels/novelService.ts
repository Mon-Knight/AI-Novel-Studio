/**
 * AI Novel Studio - Novel Service
 */
import type { Novel, CreateNovelInput, UpdateNovelInput } from '../../types/novel';
import { novelRepository, type NovelRepairResult, type NovelRepairSummary } from '../database/novelRepository';

export const novelService = {
  listNovels(): Promise<Novel[]> {
    return novelRepository.getAll();
  },

  getNovelById(id: string): Promise<Novel | null> {
    return novelRepository.getById(id);
  },

  createNovel(input: CreateNovelInput): Promise<Novel> {
    return novelRepository.create(input);
  },

  updateNovel(id: string, input: UpdateNovelInput): Promise<Novel | null> {
    return novelRepository.update(id, input);
  },

  deleteNovel(id: string): Promise<void> {
    return novelRepository.remove(id);
  },

  repairLocalData(): Promise<NovelRepairResult> {
    return novelRepository.repairData();
  },

  getLastRepairSummary(): NovelRepairSummary | null {
    return novelRepository.getLastRepairSummary();
  },
};
