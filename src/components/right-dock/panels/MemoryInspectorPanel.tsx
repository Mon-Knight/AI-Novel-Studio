import { useEffect, useState } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { SceneMemoryContext } from '../../../types/novelMemory';
import { novelMemoryManager } from '../../../services/memory/novelMemoryManager';

export interface MemoryInspectorPanelProps {
  novelId?: string;
  chapter?: Chapter;
  sceneId?: string;
  taskInput?: Record<string, unknown>;
  onClose?: () => void;
}

export default function MemoryInspectorPanel({
  novelId,
  chapter,
  sceneId,
  taskInput,
  onClose,
}: MemoryInspectorPanelProps) {
  const [context, setContext] = useState<SceneMemoryContext | null>(null);
  const [versionNumber, setVersionNumber] = useState<number>(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadMemory() {
      if (!novelId) {
        setContext(null);
        return;
      }
      setLoading(true);
      try {
        const sid =
          sceneId ||
          (typeof taskInput?.sceneId === 'string'
            ? taskInput.sceneId
            : taskInput?.sceneNo
              ? `scene-${taskInput.sceneNo}`
              : chapter?.id
                ? `chap-${chapter.id}`
                : 'current-scene');

        const povId =
          typeof taskInput?.povCharacterId === 'string'
            ? taskInput.povCharacterId
            : typeof taskInput?.povCharacter === 'string'
              ? taskInput.povCharacter
              : undefined;

        const activeIds = Array.isArray(taskInput?.activeCharacterIds)
          ? (taskInput.activeCharacterIds as string[])
          : Array.isArray(taskInput?.characters)
            ? (taskInput.characters as string[])
            : undefined;

        const retrieved = await novelMemoryManager.retrieveContext({
          novelId,
          sceneId: sid,
          povCharacterId: povId,
          activeCharacterIds: activeIds,
          maxMemoryTokens: 2000,
        });

        if (!cancelled) {
          setContext(retrieved);
          const versions = novelMemoryManager.listMemoryVersions(novelId);
          setVersionNumber(versions.length > 0 ? versions[versions.length - 1].versionNumber : 1);
        }
      } catch {
        if (!cancelled) setContext(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMemory();
    return () => {
      cancelled = true;
    };
  }, [novelId, chapter?.id, sceneId, taskInput]);

  const hasMemoryData = Boolean(
    context &&
      (context.longTermMemories.length > 0 ||
        context.midTermMemories.length > 0 ||
        context.shortTermMemories.length > 0 ||
        context.povCharacter ||
        context.activeCharacters.length > 0 ||
        context.currentConflict ||
        context.constraints.length > 0),
  );

  const displayScene =
    sceneId ||
    (typeof taskInput?.sceneTitle === 'string'
      ? taskInput.sceneTitle
      : taskInput?.sceneNo
        ? `Scene ${taskInput.sceneNo}`
        : chapter?.title || '当前分镜');

  const allRetrievedFragments = [
    ...(context?.longTermMemories ?? []),
    ...(context?.midTermMemories ?? []),
    ...(context?.shortTermMemories ?? []),
  ];

  return (
    <div
      className="right-panel memory-inspector-panel"
      data-testid="memory-inspector-panel"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <div
        className="right-panel-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border-light, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🧠</span>
          <strong style={{ fontSize: 14 }}>Memory Inspector</strong>
        </div>
        {onClose && (
          <button
            type="button"
            className="right-panel-close"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              color: 'var(--color-text-muted, #64748b)',
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div
        className="right-panel-body"
        style={{ flex: 1, overflowY: 'auto', padding: '16px' }}
      >
        {loading ? (
          <div
            className="text-sm text-muted"
            style={{ textAlign: 'center', padding: 24 }}
          >
            检索记忆数据中...
          </div>
        ) : !hasMemoryData ? (
          <div
            className="memory-inspector-empty"
            data-testid="memory-inspector-empty"
            style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--color-text-muted, #64748b)',
              fontSize: 13,
            }}
          >
            No memory context available
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 1. 基础状态概览卡片 */}
            <div
              style={{
                background: 'var(--color-bg-subtle, #f8fafc)',
                border: '1px solid var(--color-border-light, #e2e8f0)',
                borderRadius: 8,
                padding: 12,
                fontSize: 12,
              }}
            >
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: 'var(--color-text-muted, #64748b)' }}>当前 Scene: </span>
                <strong data-testid="inspector-scene-name">{displayScene}</strong>
              </div>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: 'var(--color-text-muted, #64748b)' }}>Memory Version: </span>
                <span
                  data-testid="inspector-memory-version"
                  style={{
                    display: 'inline-block',
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: 'var(--color-primary-light, #e0e7ff)',
                    color: 'var(--color-primary, #4338ca)',
                    fontWeight: 600,
                  }}
                >
                  v{versionNumber}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted, #64748b)' }}>POV 视点角色: </span>
                <strong data-testid="inspector-pov-name">
                  {context?.povCharacter?.name || '默认全知视角'}
                </strong>
                {context?.povCharacter?.dynamicState && (
                  <div
                    style={{
                      marginTop: 4,
                      paddingLeft: 8,
                      borderLeft: '2px solid var(--color-primary, #6366f1)',
                      color: 'var(--color-text-secondary, #475569)',
                    }}
                  >
                    {context.povCharacter.dynamicState.currentEmotion && (
                      <div>心境: {context.povCharacter.dynamicState.currentEmotion}</div>
                    )}
                    {context.povCharacter.dynamicState.currentGoal && (
                      <div>动机: {context.povCharacter.dynamicState.currentGoal}</div>
                    )}
                    {context.povCharacter.dynamicState.injuries &&
                      context.povCharacter.dynamicState.injuries.length > 0 && (
                        <div>状态: {context.povCharacter.dynamicState.injuries.join('、')}</div>
                      )}
                  </div>
                )}
              </div>
            </div>

            {/* 2. Retrieved Fragments (召回碎片) */}
            <section data-testid="inspector-retrieved-fragments">
              <h4 style={{ fontSize: 13, marginBottom: 8, color: 'var(--color-text-primary, #1e293b)' }}>
                🔍 召回碎片 (Retrieved Fragments · {allRetrievedFragments.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {allRetrievedFragments.map((frag) => (
                  <div
                    key={frag.id}
                    style={{
                      border: '1px solid var(--color-border-light, #e2e8f0)',
                      borderRadius: 6,
                      padding: 8,
                      fontSize: 12,
                      background: 'var(--color-bg-card, #ffffff)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span
                        style={{
                          fontSize: 11,
                          padding: '1px 4px',
                          background: 'var(--color-bg-subtle, #f1f5f9)',
                          borderRadius: 3,
                          color: 'var(--color-text-muted, #64748b)',
                        }}
                      >
                        {frag.type} · {frag.tier}
                      </span>
                      <span style={{ fontSize: 11, color: '#eab308' }}>
                        {'★'.repeat(frag.importance)}
                      </span>
                    </div>
                    <div style={{ lineHeight: 1.4 }}>{frag.content}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* 3. Long-Term Memories (长期记忆) */}
            {context && context.longTermMemories.length > 0 && (
              <section data-testid="inspector-long-term">
                <h4 style={{ fontSize: 13, marginBottom: 8, color: 'var(--color-text-primary, #1e293b)' }}>
                  🏛️ 长期记忆 (Long-Term · 世界规则/核心设定)
                </h4>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.5 }}>
                  {context.longTermMemories.map((m) => (
                    <li key={m.id}>{m.content}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* 4. Mid-Term Memories (中期记忆) */}
            {context && context.midTermMemories.length > 0 && (
              <section data-testid="inspector-mid-term">
                <h4 style={{ fontSize: 13, marginBottom: 8, color: 'var(--color-text-primary, #1e293b)' }}>
                  🗺️ 中期记忆 (Mid-Term · 本卷剧情/人物态势)
                </h4>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.5 }}>
                  {context.midTermMemories.map((m) => (
                    <li key={m.id}>{m.content}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* 5. Short-Term Memories (短期记忆) */}
            {context && context.shortTermMemories.length > 0 && (
              <section data-testid="inspector-short-term">
                <h4 style={{ fontSize: 13, marginBottom: 8, color: 'var(--color-text-primary, #1e293b)' }}>
                  ⚡ 短期记忆 (Short-Term · 工作记忆/前序衔接)
                </h4>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.5 }}>
                  {context.shortTermMemories.map((m) => (
                    <li key={m.id}>{m.content}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* 6. 硬约束与禁忌 */}
            {context && context.constraints.length > 0 && (
              <section data-testid="inspector-constraints">
                <h4 style={{ fontSize: 13, marginBottom: 8, color: 'var(--color-text-primary, #1e293b)' }}>
                  ⚠️ 场景硬约束 (Constraints)
                </h4>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--color-danger, #ef4444)' }}>
                  {context.constraints.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
