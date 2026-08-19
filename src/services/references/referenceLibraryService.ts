import type {
  ImportReferenceWorkInput,
  ImportReferenceWorkResult,
  InspectReferenceDuplicateResult,
  ReferenceImport,
  ReferenceSection,
  ReferenceSectionMetadata,
  ReferenceSectionPage,
  ReferenceWork,
  ReferenceWorkBundle,
  ReferenceWorkBundleLegacy,
} from '../../types/reference';
import { dbCall, generateId, lsGet, lsSet, nowISO } from '../database/db';

const REFERENCE_LIBRARY_KEY = 'ai_novel_studio_reference_library_v1';
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const DEFAULT_SECTION_PAGE_SIZE = 100;
const MAX_SECTION_PAGE_SIZE = 200;

interface LocalReferenceOperation {
  novelId?: string;
  requestIdentity: string;
  workId: string;
  importId: string;
  action: ImportReferenceWorkInput['duplicateAction'];
  created: boolean;
}

interface LocalReferenceLibraryState {
  schemaVersion: 1;
  works: ReferenceWork[];
  imports: ReferenceImport[];
  sections: ReferenceSection[];
  operations: Record<string, LocalReferenceOperation>;
}

function emptyState(): LocalReferenceLibraryState {
  return { schemaVersion: 1, works: [], imports: [], sections: [], operations: {} };
}

function readState(): LocalReferenceLibraryState {
  const state = lsGet<LocalReferenceLibraryState>(REFERENCE_LIBRARY_KEY);
  if (!state || state.schemaVersion !== 1) return emptyState();
  return state;
}

function writeState(state: LocalReferenceLibraryState): void {
  lsSet(REFERENCE_LIBRARY_KEY, state);
}

function normalizePage(
  offset = 0,
  limit = DEFAULT_SECTION_PAGE_SIZE,
): {
  offset: number;
  limit: number;
} {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('参考章节分页偏移无效。');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SECTION_PAGE_SIZE) {
    throw new Error(`参考章节分页大小必须为 1-${MAX_SECTION_PAGE_SIZE}。`);
  }
  return { offset, limit };
}

function sectionMetadata(section: ReferenceSection): ReferenceSectionMetadata {
  const { content: _content, ...metadata } = section;
  return metadata;
}

function fullSectionsFor(
  state: LocalReferenceLibraryState,
  novelId: string,
  workId: string,
  importId: string,
): ReferenceSection[] {
  return state.sections
    .filter(
      (item) => item.importId === importId && item.workId === workId && item.novelId === novelId,
    )
    .sort((left, right) => left.orderIndex - right.orderIndex);
}

function bundleFor(
  state: LocalReferenceLibraryState,
  novelId: string,
  workId: string,
  sectionOffset = 0,
  sectionLimit = DEFAULT_SECTION_PAGE_SIZE,
): ReferenceWorkBundle {
  const page = normalizePage(sectionOffset, sectionLimit);
  const work = state.works.find((item) => item.id === workId && item.novelId === novelId);
  if (!work) throw new Error('参考作品不存在或不属于当前小说。');
  const imports = state.imports
    .filter((item) => item.workId === work.id && item.novelId === novelId)
    .sort((left, right) => right.version - left.version);
  const activeImport = imports.find((item) => item.id === work.activeImportId && item.isCurrent);
  if (!activeImport) throw new Error('参考作品缺少有效的当前导入版本。');
  const fullSections = fullSectionsFor(state, novelId, workId, activeImport.id);
  if (fullSections.length !== activeImport.sectionCount) {
    throw new Error('参考资料章节派生记录不完整。');
  }
  return {
    work,
    imports,
    sections: fullSections.slice(page.offset, page.offset + page.limit).map(sectionMetadata),
    sectionTotal: fullSections.length,
    sectionOffset: page.offset,
    sectionLimit: page.limit,
  };
}

function legacyBundleFor(
  state: LocalReferenceLibraryState,
  novelId: string,
  workId: string,
): ReferenceWorkBundleLegacy {
  const paged = bundleFor(state, novelId, workId);
  return {
    work: paged.work,
    imports: paged.imports,
    sections: fullSectionsFor(state, novelId, workId, paged.work.activeImportId),
  };
}

function requestIdentity(input: ImportReferenceWorkInput): string {
  return JSON.stringify({
    novelId: input.novelId,
    duplicateAction: input.duplicateAction,
    duplicateImportId: input.duplicateImportId ?? null,
    workId: input.workId ?? null,
    title: input.title?.trim() ?? null,
    purpose: input.purpose ?? null,
    description: input.description?.trim() || null,
    sourceFilePath: input.sourceFilePath ?? null,
    fileName: input.analysis.fileName,
    encoding: input.analysis.encoding,
    encodingSource: input.analysis.encodingSource,
    sourceHash: input.analysis.sourceHash,
    decodedTextHash: input.analysis.decodedTextHash,
    sourceByteLength: input.analysis.sourceByteLength,
    decodedUtf8ByteLength: input.analysis.decodedUtf8ByteLength,
    totalChars: input.analysis.totalChars,
    parserVersion: input.analysis.parserVersion,
    sectionPlanHash: input.analysis.sectionPlanHash,
    warnings: input.analysis.warnings,
  });
}

function validateImportInput(input: ImportReferenceWorkInput): void {
  if (!input.operationId.trim() || input.operationId.length > 200) {
    throw new Error('参考资料导入 operationId 无效。');
  }
  if (!input.novelId.trim()) throw new Error('参考资料缺少小说作用域。');
  if (!HASH_PATTERN.test(input.analysis.sourceHash)) throw new Error('参考资料原始文件哈希无效。');
  if (!HASH_PATTERN.test(input.analysis.decodedTextHash)) throw new Error('参考资料正文哈希无效。');
  if (!HASH_PATTERN.test(input.analysis.sectionPlanHash))
    throw new Error('参考资料章节计划哈希无效。');
  if (input.analysis.sections.length === 0) throw new Error('参考资料没有可导入章节。');
  if (
    input.analysis.sections.length !==
    new Set(input.analysis.sections.map((item) => item.orderIndex)).size
  ) {
    throw new Error('参考资料章节序号重复。');
  }
  if (input.analysis.sections.some((item, index) => item.orderIndex !== index + 1)) {
    throw new Error('参考资料章节序号不连续。');
  }
  if (input.duplicateAction === 'createWork') {
    if (!input.title?.trim()) throw new Error('新建参考作品时必须提供标题。');
    if (unicodeLength(input.title.trim()) > 200) throw new Error('参考作品标题过长。');
    if (!input.purpose) throw new Error('新建参考作品时必须选择用途。');
    if (input.description && unicodeLength(input.description.trim()) > 2_000) {
      throw new Error('参考作品说明过长。');
    }
  }
  if (input.duplicateAction === 'createVersion' && !input.workId) {
    throw new Error('新增参考版本时必须指定参考作品。');
  }
  if (input.duplicateAction === 'skip' && !input.duplicateImportId) {
    throw new Error('跳过重复导入时必须指定已有版本。');
  }
}

function localInspect(novelId: string, sourceHash: string): InspectReferenceDuplicateResult {
  if (!novelId.trim() || !HASH_PATTERN.test(sourceHash)) throw new Error('重复检查参数无效。');
  const state = readState();
  const matches = state.imports
    .filter((item) => item.novelId === novelId && item.sourceHash === sourceHash)
    .map((item) => ({
      workId: item.workId,
      workTitle: state.works.find((work) => work.id === item.workId)?.title ?? '已删除参考作品',
      importId: item.id,
      importVersion: item.version,
      isCurrent: item.isCurrent,
      importedAt: item.importedAt,
    }))
    .sort((left, right) => right.importedAt.localeCompare(left.importedAt));
  return { novelId, sourceHash, matches };
}

function unicodeLength(value: string): number {
  let length = 0;
  for (const _character of value) length += 1;
  return length;
}

async function sha256Text(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境缺少可靠的 SHA-256，参考章节读取已终止。');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifiedLocalSection(section: ReferenceSection): Promise<ReferenceSection> {
  if (
    unicodeLength(section.content) !== section.charCount ||
    section.sourceEndUtf16 - section.sourceStartUtf16 !== section.content.length ||
    (await sha256Text(section.content)) !== section.contentHash
  ) {
    throw new Error('参考章节正文完整性校验失败。');
  }
  return { ...section };
}

function localImport(input: ImportReferenceWorkInput): ImportReferenceWorkResult {
  validateImportInput(input);
  const state = readState();
  const identity = requestIdentity(input);
  const replay = state.operations[input.operationId];
  if (replay) {
    if (replay.requestIdentity !== identity)
      throw new Error('参考资料导入 operationId 已用于不同请求。');
    return {
      action: replay.action,
      bundle: bundleFor(state, input.novelId, replay.workId),
      created: replay.created,
    };
  }

  if (input.duplicateAction === 'skip') {
    const existing = state.imports.find(
      (item) =>
        item.id === input.duplicateImportId &&
        item.novelId === input.novelId &&
        item.sourceHash === input.analysis.sourceHash,
    );
    if (!existing) throw new Error('指定的重复参考版本不存在或哈希不一致。');
    return {
      action: 'skip',
      bundle: bundleFor(state, input.novelId, existing.workId),
      created: false,
    };
  }

  const now = nowISO();
  const workId = input.duplicateAction === 'createWork' ? generateId() : input.workId!;
  let work = state.works.find((item) => item.id === workId && item.novelId === input.novelId);
  if (input.duplicateAction === 'createWork') {
    if (work) throw new Error('参考作品 ID 冲突。');
    work = {
      id: workId,
      novelId: input.novelId,
      title: input.title!.trim(),
      purpose: input.purpose!,
      description: input.description?.trim() || undefined,
      activeImportId: '',
      activeSourceHash: '',
      revision: 1,
      sourceStatus: 'available',
      sectionCount: 0,
      totalChars: 0,
      createdAt: now,
      updatedAt: now,
    };
    state.works.push(work);
  } else if (!work) {
    throw new Error('目标参考作品不存在或不属于当前小说。');
  }

  const version =
    state.imports
      .filter((item) => item.workId === workId && item.novelId === input.novelId)
      .reduce((maximum, item) => Math.max(maximum, item.version), 0) + 1;
  for (const item of state.imports) {
    if (item.workId === workId && item.novelId === input.novelId) item.isCurrent = false;
  }
  const importId = generateId();
  const imported: ReferenceImport = {
    id: importId,
    workId,
    novelId: input.novelId,
    version,
    isCurrent: true,
    operationId: input.operationId,
    fileName: input.analysis.fileName,
    fileType: 'txt',
    sourceFilePath: input.sourceFilePath,
    encoding: input.analysis.encoding,
    detectedEncoding:
      input.analysis.encodingSource === 'user_override' ? undefined : input.analysis.encoding,
    encodingSource: input.analysis.encodingSource,
    sourceHash: input.analysis.sourceHash,
    decodedTextHash: input.analysis.decodedTextHash,
    sourceByteLength: input.analysis.sourceByteLength,
    decodedUtf8ByteLength: input.analysis.decodedUtf8ByteLength,
    totalChars: input.analysis.totalChars,
    sectionCount: input.analysis.sections.length,
    parserVersion: input.analysis.parserVersion,
    sectionPlanHash: input.analysis.sectionPlanHash,
    warnings: [...input.analysis.warnings],
    importedAt: now,
  };
  state.imports.push(imported);
  state.sections.push(
    ...input.analysis.sections.map((item) => ({
      ...item,
      id: generateId(),
      importId,
      workId,
      novelId: input.novelId,
    })),
  );
  work.activeImportId = importId;
  work.activeSourceHash = imported.sourceHash;
  work.sectionCount = imported.sectionCount;
  work.totalChars = imported.totalChars;
  work.sourceStatus = 'available';
  work.updatedAt = now;
  if (input.duplicateAction === 'createVersion') work.revision += 1;
  state.operations[input.operationId] = {
    novelId: input.novelId,
    requestIdentity: identity,
    workId,
    importId,
    action: input.duplicateAction,
    created: true,
  };
  writeState(state);
  return {
    action: input.duplicateAction,
    bundle: bundleFor(state, input.novelId, workId),
    created: true,
  };
}

export const referenceLibraryService = {
  async inspectDuplicates(
    novelId: string,
    sourceHash: string,
  ): Promise<InspectReferenceDuplicateResult> {
    return dbCall('inspect_reference_duplicates', { input: { novelId, sourceHash } }, () =>
      localInspect(novelId, sourceHash),
    );
  },

  async import(input: ImportReferenceWorkInput): Promise<ImportReferenceWorkResult> {
    validateImportInput(input);
    return dbCall('commit_reference_import', { input }, () => localImport(input));
  },

  async listWorks(novelId: string): Promise<ReferenceWork[]> {
    if (!novelId.trim()) throw new Error('参考资料缺少小说作用域。');
    return dbCall('list_reference_works', { input: { novelId } }, () =>
      readState()
        .works.filter((item) => item.novelId === novelId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  },

  async getBundle(
    novelId: string,
    workId: string,
    sectionOffset = 0,
    sectionLimit = DEFAULT_SECTION_PAGE_SIZE,
  ): Promise<ReferenceWorkBundle> {
    const page = normalizePage(sectionOffset, sectionLimit);
    return dbCall(
      'get_reference_work_bundle',
      { input: { novelId, workId, sectionOffset: page.offset, sectionLimit: page.limit } },
      () => bundleFor(readState(), novelId, workId, page.offset, page.limit),
    );
  },

  async getBundleLegacy(novelId: string, workId: string): Promise<ReferenceWorkBundleLegacy> {
    return dbCall('get_reference_work_bundle_legacy', { input: { novelId, workId } }, () =>
      legacyBundleFor(readState(), novelId, workId),
    );
  },

  async listSections(
    novelId: string,
    workId: string,
    importId: string,
    offset = 0,
    limit = DEFAULT_SECTION_PAGE_SIZE,
  ): Promise<ReferenceSectionPage> {
    const page = normalizePage(offset, limit);
    return dbCall(
      'list_reference_sections',
      { input: { novelId, workId, importId, offset: page.offset, limit: page.limit } },
      () => {
        const state = readState();
        const imported = state.imports.find(
          (item) => item.id === importId && item.workId === workId && item.novelId === novelId,
        );
        if (!imported) throw new Error('参考导入版本不存在或不属于当前小说。');
        const sections = fullSectionsFor(state, novelId, workId, importId);
        if (sections.length !== imported.sectionCount) {
          throw new Error('参考资料章节派生记录不完整。');
        }
        return {
          items: sections.slice(page.offset, page.offset + page.limit).map(sectionMetadata),
          total: sections.length,
          offset: page.offset,
          limit: page.limit,
        };
      },
    );
  },

  async getSectionContent(
    novelId: string,
    workId: string,
    importId: string,
    sectionId: string,
  ): Promise<ReferenceSection> {
    return dbCall(
      'get_reference_section_content',
      { input: { novelId, workId, importId, sectionId } },
      async () => {
        const section = readState().sections.find(
          (item) =>
            item.id === sectionId &&
            item.importId === importId &&
            item.workId === workId &&
            item.novelId === novelId,
        );
        if (!section) throw new Error('参考章节不存在或不属于当前小说。');
        return verifiedLocalSection(section);
      },
    );
  },

  async activateImport(
    novelId: string,
    workId: string,
    importId: string,
    expectedRevision: number,
  ): Promise<ReferenceWorkBundle> {
    return dbCall(
      'activate_reference_import',
      { input: { novelId, workId, importId, expectedRevision } },
      () => {
        const state = readState();
        const work = state.works.find((item) => item.id === workId && item.novelId === novelId);
        const target = state.imports.find(
          (item) => item.id === importId && item.workId === workId && item.novelId === novelId,
        );
        if (!work || !target) throw new Error('参考作品或导入版本不存在。');
        if (work.revision !== expectedRevision)
          throw new Error('参考作品已被其他操作更新，请刷新后重试。');
        for (const item of state.imports)
          if (item.workId === workId && item.novelId === novelId)
            item.isCurrent = item.id === importId;
        work.activeImportId = target.id;
        work.activeSourceHash = target.sourceHash;
        work.sectionCount = target.sectionCount;
        work.totalChars = target.totalChars;
        work.revision += 1;
        work.sourceStatus = 'available';
        work.updatedAt = nowISO();
        writeState(state);
        return bundleFor(state, novelId, workId);
      },
    );
  },

  async deleteWork(novelId: string, workId: string, expectedRevision: number): Promise<void> {
    await dbCall('delete_reference_work', { input: { novelId, workId, expectedRevision } }, () => {
      const state = readState();
      const work = state.works.find((item) => item.id === workId && item.novelId === novelId);
      if (!work) return;
      if (work.revision !== expectedRevision)
        throw new Error('参考作品已被其他操作更新，请刷新后重试。');
      const importIds = new Set(
        state.imports
          .filter((item) => item.workId === workId && item.novelId === novelId)
          .map((item) => item.id),
      );
      state.works = state.works.filter((item) => item.id !== workId || item.novelId !== novelId);
      state.imports = state.imports.filter(
        (item) => item.workId !== workId || item.novelId !== novelId,
      );
      state.sections = state.sections.filter((item) => !importIds.has(item.importId));
      state.operations = Object.fromEntries(
        Object.entries(state.operations).filter(
          ([, operation]) =>
            operation.workId !== workId ||
            (operation.novelId !== undefined && operation.novelId !== novelId),
        ),
      );
      writeState(state);
    });
  },
};

export const __referenceLibraryTestUtils = {
  storageKey: REFERENCE_LIBRARY_KEY,
};
