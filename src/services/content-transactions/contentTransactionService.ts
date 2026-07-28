import { dbCall, generateId } from '../database/db';
import type {
  ApplyContentTransactionInput,
  ApplyContentTransactionResult,
  ContentTransaction,
  FactionAsset,
  LocationAsset,
  PrepareContentTargetInput,
  PrepareContentTransactionInput,
} from '../../types/contentTransaction';

const MAX_TARGETS = 500;

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 240) throw new Error(`${label}无效。`);
  return normalized;
}

export function normalizeContentTransactionInput(
  input: PrepareContentTransactionInput,
): PrepareContentTransactionInput {
  if (input.targets.length < 1 || input.targets.length > MAX_TARGETS) {
    throw new Error('多目标事务必须包含 1～500 个目标。');
  }
  const identities = new Set<string>();
  const targets = input.targets.map((target) => {
    const targetId = requiredId(target.targetId, '目标标识');
    const identity = `${target.targetType}\u0000${targetId}`;
    if (identities.has(identity)) throw new Error('多目标事务包含重复目标。');
    identities.add(identity);
    return { ...target, targetId, payload: { ...target.payload } };
  });
  return {
    operationId: requiredId(input.operationId, '操作标识'),
    novelId: requiredId(input.novelId, '作品标识'),
    strategy: input.strategy,
    targets,
  };
}

export function buildChapterMetadataTargets(
  chapterIds: readonly string[],
  patch: { goal?: string; status?: string; titlePrefix?: string },
): PrepareContentTargetInput[] {
  const unique = [...new Set(chapterIds.map((id) => requiredId(id, '章节标识')))];
  if (unique.length === 0 || unique.length > MAX_TARGETS) {
    throw new Error('跨章节批处理必须选择 1～500 章。');
  }
  const goal = patch.goal?.trim();
  const status = patch.status?.trim();
  const titlePrefix = patch.titlePrefix?.trim();
  if (!goal && !status && !titlePrefix) throw new Error('请至少填写一项批处理变更。');
  return unique.map((chapterId, index) => ({
    targetType: 'chapter_metadata',
    targetId: chapterId,
    effectType: 'update',
    payload: {
      ...(goal ? { goal } : {}),
      ...(status ? { status } : {}),
      ...(titlePrefix ? { title: `${titlePrefix}${index + 1}` } : {}),
    },
  }));
}

export const contentTransactionService = {
  createOperationId(prefix = 'content-transaction'): string {
    return `${prefix}-${generateId()}`;
  },

  async prepare(input: PrepareContentTransactionInput): Promise<ContentTransaction> {
    return dbCall<ContentTransaction>('prepare_content_transaction', {
      input: normalizeContentTransactionInput(input),
    });
  },

  async get(transactionId: string): Promise<ContentTransaction | null> {
    return dbCall<ContentTransaction | null>('get_content_transaction', {
      input: { transactionId: requiredId(transactionId, '事务标识') },
    });
  },

  async list(novelId: string, limit = 50): Promise<ContentTransaction[]> {
    return dbCall<ContentTransaction[]>('list_content_transactions', {
      input: { novelId: requiredId(novelId, '作品标识'), limit },
    });
  },

  async apply(input: ApplyContentTransactionInput): Promise<ApplyContentTransactionResult> {
    return dbCall<ApplyContentTransactionResult>('apply_content_transaction', {
      input: {
        ...input,
        transactionId: requiredId(input.transactionId, '事务标识'),
        operationId: requiredId(input.operationId, '操作标识'),
        approvedTargets: input.approvedTargets ?? [],
      },
    });
  },

  async listFactions(novelId: string): Promise<FactionAsset[]> {
    return dbCall<FactionAsset[]>('list_faction_assets', {
      input: { novelId: requiredId(novelId, '作品标识'), limit: 500 },
    });
  },

  async listLocations(novelId: string): Promise<LocationAsset[]> {
    return dbCall<LocationAsset[]>('list_location_assets', {
      input: { novelId: requiredId(novelId, '作品标识'), limit: 500 },
    });
  },
};
