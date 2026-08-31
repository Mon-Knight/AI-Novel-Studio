import { outputProfileService } from './outputProfileService';
import { styleProfileService } from './styleProfileService';
import type { OutputProfile } from '../../types/output';
import type { StyleProfile } from '../../types/style';

export interface ResolvedGenerationProfiles {
  styleProfileId?: string;
  outputProfileId?: string;
}

const SYSTEM_DEFAULT_STYLE_NAME = '默认小说风格';

function newestFirst<T extends { updatedAt: string; id: string }>(left: T, right: T): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

export function selectGenerationStyleProfile(
  novelId: string,
  profiles: readonly StyleProfile[],
): StyleProfile | undefined {
  const ordered = [...profiles].sort(newestFirst);
  return (
    ordered.find((profile) => profile.novelId === novelId && profile.isActive) ??
    ordered.find(
      (profile) =>
        !profile.novelId &&
        profile.isActive &&
        profile.sourceType === 'system_default' &&
        profile.name === SYSTEM_DEFAULT_STYLE_NAME,
    ) ??
    ordered.find((profile) => !profile.novelId && profile.isActive)
  );
}

export function selectGenerationOutputProfile(
  novelId: string,
  profiles: readonly OutputProfile[],
): OutputProfile | undefined {
  const ordered = [...profiles].sort(newestFirst);
  return (
    ordered.find((profile) => profile.novelId === novelId && profile.isDefault) ??
    ordered.find((profile) => !profile.novelId && profile.isDefault)
  );
}

export async function resolveGenerationProfiles(
  novelId: string,
  options: { initialize?: boolean } = {},
): Promise<ResolvedGenerationProfiles> {
  const [activeStyle, styles, outputs] = await Promise.all([
    styleProfileService.getActive(novelId).catch(() => null),
    styleProfileService.getAll(novelId, options).catch(() => []),
    outputProfileService.getAll(novelId, options).catch(() => []),
  ]);
  const style = activeStyle?.isActive ? activeStyle : selectGenerationStyleProfile(novelId, styles);
  const output = selectGenerationOutputProfile(novelId, outputs);
  return {
    styleProfileId: style?.id,
    outputProfileId: output?.id,
  };
}
