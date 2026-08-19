import type { AiGenerateOptions } from '../../types/ai';
import type {
  LayeredStyleResult,
  ReferenceSection,
  ReferenceSectionMetadata,
  ReferenceWorkBundle,
} from '../../types/reference';
import type { StyleProfile } from '../../types/style';
import type { CreateStyleProfileInput } from '../../types/style';
import { throwIfAiRequestCancelled } from '../ai/aiCancellation';
import { analyzeLayeredReferenceStyle } from './layeredStyleAnalyzer';
import { referenceLibraryService } from './referenceLibraryService';
import { styleProfileService } from '../styles/styleProfileService';

const SECTION_METADATA_PAGE_SIZE = 200;
const ANALYSIS_SECTION_RATIOS = [0, 0.35, 0.5, 0.65, 0.82, 1] as const;

export interface CreateReferenceStyleProfileResult {
  profile: StyleProfile;
  analysis: LayeredStyleResult;
}

export interface ReferenceStyleProfileDependencies {
  analyze?: typeof analyzeLayeredReferenceStyle;
  saveProfile?: (input: CreateStyleProfileInput & { novelId: string }) => Promise<StyleProfile>;
  listSections?: typeof referenceLibraryService.listSections;
  getSectionContent?: typeof referenceLibraryService.getSectionContent;
}

function selectAnalysisSections(sections: ReferenceSectionMetadata[]): ReferenceSectionMetadata[] {
  if (sections.length === 0) return [];
  const totalChars = sections.reduce((sum, section) => sum + section.charCount, 0);
  const selected = new Map<string, ReferenceSectionMetadata>();
  for (const ratio of ANALYSIS_SECTION_RATIOS) {
    const target = totalChars <= 1 ? 0 : Math.floor((totalChars - 1) * ratio);
    let cursor = 0;
    let match = sections[sections.length - 1];
    for (const section of sections) {
      cursor += section.charCount;
      if (target < cursor) {
        match = section;
        break;
      }
    }
    selected.set(match.id, match);
  }
  return [...selected.values()].sort(
    (left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id),
  );
}

async function loadSectionCatalog(
  bundle: ReferenceWorkBundle,
  activeImportId: string,
  listSections: typeof referenceLibraryService.listSections,
  signal?: AbortSignal,
): Promise<ReferenceSectionMetadata[]> {
  const catalog: ReferenceSectionMetadata[] = [];
  let expectedTotal: number | undefined;
  for (let offset = 0; ; offset += SECTION_METADATA_PAGE_SIZE) {
    throwIfAiRequestCancelled(signal);
    const page = await listSections(
      bundle.work.novelId,
      bundle.work.id,
      activeImportId,
      offset,
      SECTION_METADATA_PAGE_SIZE,
    );
    throwIfAiRequestCancelled(signal);
    if (page.offset !== offset || page.limit !== SECTION_METADATA_PAGE_SIZE) {
      throw new Error('参考章节分页响应与请求不一致。');
    }
    if (expectedTotal === undefined) expectedTotal = page.total;
    if (page.total !== expectedTotal) throw new Error('参考章节分页过程中总数发生变化。');
    if (page.items.length === 0 && catalog.length < page.total) {
      throw new Error('参考章节分页提前结束。');
    }
    catalog.push(...page.items);
    if (catalog.length >= page.total) break;
  }
  if (catalog.length !== expectedTotal) throw new Error('参考章节元数据数量不完整。');
  const ordered = [...catalog].sort(
    (left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id),
  );
  if (
    ordered.some(
      (section, index) =>
        section.orderIndex !== index + 1 ||
        section.importId !== activeImportId ||
        section.workId !== bundle.work.id ||
        section.novelId !== bundle.work.novelId,
    ) ||
    new Set(ordered.map((section) => section.id)).size !== ordered.length
  ) {
    throw new Error('参考章节元数据作用域或顺序无效。');
  }
  return ordered;
}

async function loadAnalysisSections(
  bundle: ReferenceWorkBundle,
  activeImportId: string,
  metadata: ReferenceSectionMetadata[],
  getSectionContent: typeof referenceLibraryService.getSectionContent,
  signal?: AbortSignal,
): Promise<ReferenceSection[]> {
  const sections: ReferenceSection[] = [];
  for (const expected of selectAnalysisSections(metadata)) {
    throwIfAiRequestCancelled(signal);
    const section = await getSectionContent(
      bundle.work.novelId,
      bundle.work.id,
      activeImportId,
      expected.id,
    );
    throwIfAiRequestCancelled(signal);
    if (
      section.id !== expected.id ||
      section.importId !== expected.importId ||
      section.workId !== expected.workId ||
      section.novelId !== expected.novelId ||
      section.orderIndex !== expected.orderIndex ||
      section.contentHash !== expected.contentHash ||
      section.charCount !== expected.charCount ||
      section.sourceStartUtf16 !== expected.sourceStartUtf16 ||
      section.sourceEndUtf16 !== expected.sourceEndUtf16
    ) {
      throw new Error('参考章节正文与分页元数据不一致。');
    }
    sections.push(section);
  }
  return sections;
}

/**
 * Converts source excerpts into an abstract, replayable profile. The persisted
 * metadata contains hashes/ranges and per-layer abstract results, never sample
 * text or the imported reference body.
 */
export async function createReferenceStyleProfile(
  bundle: ReferenceWorkBundle,
  options: AiGenerateOptions = {},
  dependencies: ReferenceStyleProfileDependencies = {},
): Promise<CreateReferenceStyleProfileResult> {
  const activeImport = bundle.imports.find(
    (item) => item.id === bundle.work.activeImportId && item.isCurrent,
  );
  if (!activeImport || activeImport.sourceHash !== bundle.work.activeSourceHash) {
    throw new Error('参考作品的当前导入版本不完整，请刷新后重试。');
  }
  if (bundle.sectionTotal !== activeImport.sectionCount) {
    throw new Error('参考作品的当前章节派生记录不完整。');
  }
  const listSections = dependencies.listSections ?? referenceLibraryService.listSections;
  const getSectionContent =
    dependencies.getSectionContent ?? referenceLibraryService.getSectionContent;
  const catalog = await loadSectionCatalog(bundle, activeImport.id, listSections, options.signal);
  if (catalog.length !== activeImport.sectionCount) {
    throw new Error('参考作品的当前章节派生记录不完整。');
  }
  const analysisSections = await loadAnalysisSections(
    bundle,
    activeImport.id,
    catalog,
    getSectionContent,
    options.signal,
  );
  const analysis = await (dependencies.analyze ?? analyzeLayeredReferenceStyle)({
    work: bundle.work,
    importId: activeImport.id,
    sourceHash: activeImport.sourceHash,
    sections: analysisSections,
    options,
  });
  const metadata = JSON.stringify(analysis);
  if (analysisSections.some((section) => metadata.includes(section.content))) {
    throw new Error('分层风格画像意外包含参考原文，保存已终止。');
  }
  const merged = analysis.mergedProfile;
  const profile = await (dependencies.saveProfile ?? styleProfileService.create)({
    novelId: bundle.work.novelId,
    name: merged.name ?? `${bundle.work.title} · 风格画像`,
    sourceType: 'ai_analyzed',
    sourceReferenceWorkId: bundle.work.id,
    sourceReferenceImportId: activeImport.id,
    sourceContentHash: activeImport.sourceHash,
    sourceState: 'available',
    analysisMetadataJson: metadata,
    narrativePerspective: merged.narrativePerspective,
    tone: merged.tone,
    pace: merged.pace,
    sentenceStyle: merged.sentenceStyle,
    dialogueRatio: merged.dialogueRatio,
    descriptionRatio: merged.descriptionRatio,
    psychologicalRatio: merged.psychologicalRatio,
    battleStyle: merged.battleStyle,
    battleIntensity: merged.battleIntensity,
    emotionTendency: merged.emotionTendency,
    chapterEnding: merged.chapterEnding,
    forbiddenStyles: merged.forbiddenStyles,
    styleSummary: merged.styleSummary,
  });
  return { profile, analysis };
}
