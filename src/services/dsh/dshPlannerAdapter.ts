// DshPlannerAdapter：invoke('dsh_prepare_chapter') 薄 facade。
// 浏览器开发模式返回明确的"仅 Tauri 可用"错误，不伪造结果。

import type {
  ChapterPreparationInput,
  ChapterPreparationPlannerOptions,
  ChapterPreparationProposal,
} from '../../types/chapterPreparation';
import { isTauriRuntime, tauriInvoke } from '../tauri/runtime';

export interface DshPlannerAdapter {
  prepare(
    input: ChapterPreparationInput,
    options?: ChapterPreparationPlannerOptions,
  ): Promise<ChapterPreparationProposal>;
}

export const dshPlannerAdapter: DshPlannerAdapter = {
  async prepare(input, options) {
    if (!isTauriRuntime()) {
      throw new Error('DSH 章节准备提案仅在桌面端（Tauri 环境）可用，浏览器开发模式不伪造结果');
    }
    if (!options || typeof options.apiKey !== 'string' || options.apiKey.trim().length === 0) {
      throw new Error('缺少 DeepSeek Provider 的 apiKey（从设置中的 Provider 配置读取）');
    }
    return tauriInvoke<ChapterPreparationProposal>('dsh_prepare_chapter', { input, options });
  },
};
