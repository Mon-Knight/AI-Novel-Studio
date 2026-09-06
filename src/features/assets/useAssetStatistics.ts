import { useEffect, useRef, useState } from 'react';
import { characterService } from '../../services/characters/characterService';
import { chapterSummaryService } from '../../services/context/chapterSummaryService';
import { contextRecordService } from '../../services/context/contextRecordService';
import { styleProfileService } from '../../services/styles/styleProfileService';
import { settingSuggestionService } from '../../services/settingSuggestions/settingSuggestionService';
import { importedAssetService } from '../../services/styles/importedAssetService';
import { contentTransactionService } from '../../services/content-transactions/contentTransactionService';
import { getDbMode } from '../../services/database/db';
import { settingRepository } from '../../services/database/settingRepository';
import { protagonistRepository } from '../../services/database/protagonistRepository';
import { describeUnknownError } from '../../utils/errorMessage';

interface AssetStatisticsState {
  novelId: string;
  status: 'loading' | 'ready' | 'error';
  values: Record<string, number>;
  error: string;
}

export function useAssetStatistics(novelId: string) {
  const [state, setState] = useState<AssetStatisticsState>({
    novelId: '',
    status: 'loading',
    values: {},
    error: '',
  });
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    if (!novelId) return;
    setState({ novelId, status: 'loading', values: {}, error: '' });
    void Promise.all([
      characterService.getByNovelId(novelId),
      settingRepository.getWorldSettings(novelId),
      settingRepository.getRuleSystems(novelId),
      protagonistRepository.getByNovelId(novelId),
      chapterSummaryService.getByNovelId(novelId),
      contextRecordService.getByNovelId(novelId),
      styleProfileService.getAll(novelId),
      settingSuggestionService.getByNovelId(novelId),
      importedAssetService.getAll(novelId),
      getDbMode() === 'tauri'
        ? Promise.all([
            contentTransactionService.listFactions(novelId),
            contentTransactionService.listLocations(novelId),
          ])
        : Promise.resolve([[], []] as const),
    ])
      .then(
        ([
          chars,
          worldSettings,
          ruleSystems,
          protagonist,
          sums,
          ctx,
          styles,
          suggestions,
          importedAssets,
          [factions, locations],
        ]) => {
          if (request !== generation.current) return;
          setState({
            novelId,
            status: 'ready',
            error: '',
            values: {
              foundation:
                Number(worldSettings.length > 0) +
                Number(ruleSystems.length > 0) +
                Number(Boolean(protagonist)),
              chars: chars.length,
              sums: sums.length,
              ctx: ctx.length,
              styles: styles.length,
              suggestions: suggestions.filter((item) => item.status === 'pending').length,
              importedAssets: importedAssets.length,
              storyAssets: factions.length + locations.length,
            },
          });
        },
      )
      .catch((cause: unknown) => {
        if (request !== generation.current) return;
        setState({
          novelId,
          status: 'error',
          values: {},
          error: describeUnknownError(cause, '资产统计读取失败。'),
        });
      });
    return () => {
      generation.current += 1;
    };
  }, [novelId, retry]);

  // Hide previous-project values in the selection render, before the effect runs.
  const current: AssetStatisticsState =
    state.novelId === novelId
      ? state
      : {
          novelId,
          status: 'loading' as const,
          values: {},
          error: '',
        };
  return {
    ...current,
    reload: () => {
      setState({ novelId, status: 'loading', values: {}, error: '' });
      setRetry((value) => value + 1);
    },
  };
}
