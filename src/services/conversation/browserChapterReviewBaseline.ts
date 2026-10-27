import { canonicalHash } from '../ai/compilation/canonical';
import { isTauri } from '../database/db';
import { captureLocalRuleState } from '../worldRules/localRuleGovernance';
import { taskConversationService } from './taskConversationService';

export interface BrowserChapterRuleBaseline {
  mode: 'browser-chapter-rule-baseline-v1';
  novelId: string;
  fingerprint: string;
}
export async function captureBrowserChapterRuleBaseline(
  novelId: string,
): Promise<BrowserChapterRuleBaseline> {
  const state = captureLocalRuleState(novelId);
  const rows = {
    worlds: [...state.worlds].sort((a, b) => a.id.localeCompare(b.id)),
    rules: [...state.rules].sort((a, b) => a.id.localeCompare(b.id)),
  };
  return {
    mode: 'browser-chapter-rule-baseline-v1',
    novelId,
    fingerprint: await canonicalHash({
      mode: 'browser-chapter-rule-baseline-v1',
      novelId,
      ...rows,
    }),
  };
}
export async function assertBrowserChapterRuleBaseline(
  novelId: string,
  frozen: unknown,
): Promise<void> {
  const baseline = frozen as Partial<BrowserChapterRuleBaseline> | null;
  if (
    !baseline ||
    baseline.mode !== 'browser-chapter-rule-baseline-v1' ||
    baseline.novelId !== novelId ||
    typeof baseline.fingerprint !== 'string'
  ) {
    throw Object.assign(new Error('章节候选缺少生成时世界规则基线，请重新生成候选。'), {
      code: 'RULE_SET_SNAPSHOT_REQUIRED',
    });
  }
  if ((await captureBrowserChapterRuleBaseline(novelId)).fingerprint !== baseline.fingerprint) {
    throw Object.assign(new Error('候选生成后世界规则已变化，请重新生成候选后审阅。'), {
      code: 'RULE_SET_BASE_CONFLICT',
    });
  }
}
export async function assertBrowserReviewAuthorizationBaseline(
  authorizationId: string,
  novelId: string,
): Promise<void> {
  const card = await taskConversationService.getBrowserReviewArtifact(authorizationId);
  if (!card?.content) throw new Error('审阅候选无法读取。');
  let payload: { browserRuleSet?: unknown };
  try {
    payload = JSON.parse(card.content);
  } catch {
    throw new Error('审阅候选无法解析。');
  }
  await assertBrowserChapterRuleBaseline(novelId, payload.browserRuleSet);
}
/** Call after an authorized browser rule mutation; never changes consumed authorizations or prose. */
export function expireBrowserChapterReviewAuthorizations(novelId: string): void {
  if (isTauri()) return;
  taskConversationService.expireBrowserReviewAuthorizations(novelId);
}
