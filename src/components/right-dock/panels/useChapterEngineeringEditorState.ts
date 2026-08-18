import { useState } from 'react';
import { generateId } from '../../../services/database/db';
import {
  createDefaultChapterCard,
  createDefaultGenerationConstraints,
  createDefaultQualityRules,
  createDefaultScenePlan,
} from '../../../services/engineering/chapterEngineeringService';
import type {
  ChapterCard,
  GenerationConstraints,
  QualityRules,
  SceneBeat,
  ScenePlanItem,
} from '../../../types/chapterEngineering';
import { createEmptyScene, renumberScenes } from './chapterEngineeringPanelSupport';

export function useChapterEngineeringEditorState() {
  const [card, setCard] = useState<ChapterCard>(() => createDefaultChapterCard());
  const [scenePlan, setScenePlan] = useState<ScenePlanItem[]>(() => createDefaultScenePlan());
  const [constraints, setConstraints] = useState<GenerationConstraints>(() =>
    createDefaultGenerationConstraints(),
  );
  const [qualityRules, setQualityRules] = useState<QualityRules>(() => createDefaultQualityRules());
  const [dirty, setDirty] = useState(false);

  const updateCard = <K extends keyof ChapterCard>(key: K, value: ChapterCard[K]) => {
    setCard((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  };

  const updateConstraints = <K extends keyof GenerationConstraints>(
    key: K,
    value: GenerationConstraints[K],
  ) => {
    setConstraints((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  };

  const updateWordRange = (key: 'min' | 'max', value?: number) => {
    setConstraints((previous) => ({
      ...previous,
      wordRange: { ...previous.wordRange, [key]: value },
    }));
    setDirty(true);
  };

  const updateQuality = <K extends keyof QualityRules>(key: K, value: QualityRules[K]) => {
    setQualityRules((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  };

  const updateScene = <K extends keyof ScenePlanItem>(
    id: string,
    key: K,
    value: ScenePlanItem[K],
  ) => {
    setScenePlan((previous) =>
      previous.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
    );
    setDirty(true);
  };

  const updateSceneBeats = (id: string, values: string[]) => {
    setScenePlan((previous) =>
      previous.map((item) => {
        if (item.id !== id) return item;
        const existing = item.beats ?? [];
        const beats: SceneBeat[] = values.map((text, index) => ({
          id: existing[index]?.id ?? generateId(),
          order: index + 1,
          text,
          required: existing[index]?.required !== false,
          ...(existing[index]?.characterIds?.length
            ? { characterIds: existing[index].characterIds }
            : {}),
          ...(existing[index]?.stateChange ? { stateChange: existing[index].stateChange } : {}),
        }));
        return { ...item, beats };
      }),
    );
    setDirty(true);
  };

  const addScene = () => {
    setScenePlan((previous) => [...previous, createEmptyScene(previous.length + 1)]);
    setDirty(true);
  };

  const removeScene = (id: string) => {
    setScenePlan((previous) => renumberScenes(previous.filter((item) => item.id !== id)));
    setDirty(true);
  };

  return {
    card,
    setCard,
    scenePlan,
    setScenePlan,
    constraints,
    setConstraints,
    qualityRules,
    setQualityRules,
    dirty,
    setDirty,
    updateCard,
    updateConstraints,
    updateWordRange,
    updateQuality,
    updateScene,
    updateSceneBeats,
    addScene,
    removeScene,
  };
}
