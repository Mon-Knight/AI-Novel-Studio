import { contentTransactionService } from '../content-transactions/contentTransactionService';
import { referenceLibraryService } from '../references/referenceLibraryService';
import type { FactionAsset, LocationAsset } from '../../types/contentTransaction';
import type { GenerationContextSource } from '../../types/generationContext';
import type { ReferenceWork } from '../../types/reference';

const STORY_ASSET_BUDGET = 3_200;
const REFERENCE_BUDGET = 3_000;
const ITEM_LIMIT = 700;
const RESEARCH_EXCERPT_LIMIT = 900;

export interface GenerationAssetContext {
  storyAssetText?: string;
  referenceText?: string;
  sources: GenerationContextSource[];
  warnings: string[];
}

export interface GenerationAssetContextDependencies {
  listFactions?: (novelId: string) => Promise<FactionAsset[]>;
  listLocations?: (novelId: string) => Promise<LocationAsset[]>;
  listReferenceWorks?: (novelId: string) => Promise<ReferenceWork[]>;
  listReferenceSections?: typeof referenceLibraryService.listSections;
  getReferenceSectionContent?: typeof referenceLibraryService.getSectionContent;
}

function limitText(value: string | undefined, limit: number): string {
  const text = value?.trim() ?? '';
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 18))}...[内容已截断]`;
}

function projectSourcedBlocks(
  items: ReadonlyArray<{ block: string; source: GenerationContextSource }>,
  budget: number,
): { text?: string; sources: GenerationContextSource[] } {
  const blocks: string[] = [];
  const sources: GenerationContextSource[] = [];
  let used = 0;
  for (const item of items) {
    const separator = blocks.length > 0 ? 2 : 0;
    if (used + separator >= budget) break;
    const block = limitText(item.block, budget - used - separator);
    if (!block) continue;
    blocks.push(block);
    sources.push(item.source);
    used += separator + block.length;
  }
  return { text: blocks.length > 0 ? blocks.join('\n\n') : undefined, sources };
}

function includesAssetName(relevanceText: string, name: string): boolean {
  const needle = name.trim().toLocaleLowerCase();
  return !!needle && relevanceText.toLocaleLowerCase().includes(needle);
}

function newestFirst<T extends { updatedAt: string; id: string }>(left: T, right: T): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

function selectAssets<T extends { name: string; updatedAt: string; id: string }>(
  assets: readonly T[],
  relevanceText: string,
): T[] {
  const ordered = [...assets].sort(newestFirst);
  const mentioned = ordered.filter((asset) => includesAssetName(relevanceText, asset.name));
  return mentioned.length > 0 ? mentioned.slice(0, 8) : ordered.slice(0, 2);
}

export function projectStoryAssets(
  factions: readonly FactionAsset[],
  locations: readonly LocationAsset[],
  relevanceText: string,
): Pick<GenerationAssetContext, 'storyAssetText' | 'sources'> {
  const selectedFactions = selectAssets(factions, relevanceText);
  const selectedLocations = selectAssets(locations, relevanceText);
  const items = [
    ...selectedFactions.map((faction) => ({
      block: limitText(
        [
          `【势力】${faction.name}${faction.kind ? `（${faction.kind}）` : ''}`,
          faction.description ? `描述：${faction.description}` : '',
          faction.goals ? `目标：${faction.goals}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        ITEM_LIMIT,
      ),
      source: {
        type: 'faction',
        title: `势力：${faction.name}`,
        sourceId: faction.id,
        status: 'used',
        summary: `revision=${faction.revision}`,
      } satisfies GenerationContextSource,
    })),
    ...selectedLocations.map((location) => ({
      block: limitText(
        [
          `【地点】${location.name}${location.kind ? `（${location.kind}）` : ''}`,
          location.description ? `描述：${location.description}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        ITEM_LIMIT,
      ),
      source: {
        type: 'location',
        title: `地点：${location.name}`,
        sourceId: location.id,
        status: 'used',
        summary: `revision=${location.revision}`,
      } satisfies GenerationContextSource,
    })),
  ];
  const projected = projectSourcedBlocks(items, STORY_ASSET_BUDGET);
  return {
    storyAssetText: projected.text,
    sources: projected.sources,
  };
}

async function loadReferenceProjection(
  novelId: string,
  dependencies: Required<
    Pick<
      GenerationAssetContextDependencies,
      'listReferenceWorks' | 'listReferenceSections' | 'getReferenceSectionContent'
    >
  >,
): Promise<Pick<GenerationAssetContext, 'referenceText' | 'sources' | 'warnings'>> {
  const warnings: string[] = [];
  const items: Array<{ block: string; source: GenerationContextSource }> = [];
  const works = (await dependencies.listReferenceWorks(novelId))
    .filter(
      (work) =>
        work.sourceStatus === 'available' &&
        work.purpose !== 'style' &&
        !!work.activeImportId &&
        !!work.activeSourceHash,
    )
    .slice(0, 4);

  for (const work of works) {
    try {
      const selectedSectionHashes: string[] = [];
      const workParts = [
        `【${work.purpose === 'research' ? '研究资料' : '灵感方向'}】${work.title}`,
        work.description ? `用途说明：${limitText(work.description, 500)}` : '',
      ].filter(Boolean);
      if (work.purpose === 'research') {
        const page = await dependencies.listReferenceSections(
          novelId,
          work.id,
          work.activeImportId,
          0,
          2,
        );
        const sections = await Promise.all(
          page.items.map((item) =>
            dependencies.getReferenceSectionContent(novelId, work.id, work.activeImportId, item.id),
          ),
        );
        for (const section of sections) {
          const excerpt = limitText(section.content, RESEARCH_EXCERPT_LIMIT);
          if (!excerpt) continue;
          selectedSectionHashes.push(`${section.id}:${section.contentHash}`);
          workParts.push(`资料节选《${section.title}》：\n${excerpt}`);
        }
      }
      if (workParts.length < 2) continue;
      items.push({
        block: workParts.join('\n'),
        source: {
          type: 'reference_material',
          title: `参考资料：${work.title}`,
          sourceId: `${work.id}:${work.activeImportId}`,
          status: 'used',
          summary: [
            `purpose=${work.purpose}`,
            `source_hash=${work.activeSourceHash}`,
            selectedSectionHashes.length ? `sections=${selectedSectionHashes.join(',')}` : '',
          ]
            .filter(Boolean)
            .join(';'),
        },
      });
    } catch {
      warnings.push(`参考资料《${work.title}》读取失败，本轮未注入。`);
    }
  }

  const projected = projectSourcedBlocks(items, REFERENCE_BUDGET);
  return {
    referenceText: projected.text,
    sources: projected.sources,
    warnings,
  };
}

export async function loadGenerationAssetContext(
  novelId: string,
  relevanceText: string,
  deps: GenerationAssetContextDependencies = {},
): Promise<GenerationAssetContext> {
  const listFactions = deps.listFactions ?? ((id) => contentTransactionService.listFactions(id));
  const listLocations = deps.listLocations ?? ((id) => contentTransactionService.listLocations(id));
  const referenceDependencies = {
    listReferenceWorks:
      deps.listReferenceWorks ?? ((id: string) => referenceLibraryService.listWorks(id)),
    listReferenceSections:
      deps.listReferenceSections ??
      ((...args: Parameters<typeof referenceLibraryService.listSections>) =>
        referenceLibraryService.listSections(...args)),
    getReferenceSectionContent:
      deps.getReferenceSectionContent ??
      ((...args: Parameters<typeof referenceLibraryService.getSectionContent>) =>
        referenceLibraryService.getSectionContent(...args)),
  };
  const warnings: string[] = [];
  const [factions, locations, references] = await Promise.all([
    listFactions(novelId).catch(() => {
      warnings.push('势力资产读取失败，本轮未注入。');
      return [];
    }),
    listLocations(novelId).catch(() => {
      warnings.push('地点资产读取失败，本轮未注入。');
      return [];
    }),
    loadReferenceProjection(novelId, referenceDependencies).catch(() => ({
      referenceText: undefined,
      sources: [],
      warnings: ['参考资料目录读取失败，本轮未注入。'],
    })),
  ]);
  const story = projectStoryAssets(factions, locations, relevanceText);
  return {
    storyAssetText: story.storyAssetText,
    referenceText: references.referenceText,
    sources: [...story.sources, ...references.sources],
    warnings: [...warnings, ...references.warnings],
  };
}
