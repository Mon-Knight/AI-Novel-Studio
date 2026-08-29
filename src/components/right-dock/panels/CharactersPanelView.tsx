import type { AiSettings } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type {
  Character,
  ChapterCharacter,
  CharacterCandidate,
  ChapterCharacterRole,
} from '../../../types/character';
import { CharacterRoleLabels, ChapterCharacterRoleLabels } from '../../../types/character';

interface CharactersPanelViewProps {
  aiSettings: AiSettings;
  chapter?: Chapter;
  characters: Character[];
  chapterChars: ChapterCharacter[];
  candidates: CharacterCandidate[];
  availableChars: Character[];
  protagonists: Character[];
  loading: boolean;
  actionBusy: boolean;
  syncing: boolean;
  notice: string;
  error: string;
  isProtagonistCharacter: (character?: Character | null) => boolean;
  onSetProtagonistAppearance: (character: Character, appear: boolean) => void;
  onRemoveFromChapter: (character: ChapterCharacter) => void;
  onAddToChapter: (
    characterId: string,
    characterName: string,
    roleInChapter: ChapterCharacterRole,
  ) => void;
  onStopGeneratingCandidates: () => void;
  onGenerateCandidates: () => void;
  onConfirmCandidate: (candidate: CharacterCandidate) => void;
}

export function CharactersPanelView({
  aiSettings,
  chapter,
  characters,
  chapterChars,
  candidates,
  availableChars,
  protagonists,
  loading,
  actionBusy,
  syncing,
  notice,
  error,
  isProtagonistCharacter,
  onSetProtagonistAppearance,
  onRemoveFromChapter,
  onAddToChapter,
  onStopGeneratingCandidates,
  onGenerateCandidates,
  onConfirmCandidate,
}: CharactersPanelViewProps) {
  return (
    <div>
      <div className="panel-section" style={{ fontSize: 12, lineHeight: 1.8 }}>
        <div className="panel-section-title">🤖 AI 状态</div>
        <div>模式：{aiSettings.runtimeMode === 'mock' ? '🔶 Mock 模式' : '🔷 真实 API'}</div>
        {aiSettings.runtimeMode === 'api' && (
          <>
            <div>模型：{aiSettings.modelName || '未配置'}</div>
            {!aiSettings.apiKey && (
              <div style={{ color: 'var(--color-error)', marginTop: 4 }}>
                ⚠️ 未配置 API Key，请先到设置中心配置
              </div>
            )}
          </>
        )}
        {syncing && (
          <div style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>
            ⏳ 正在同步主角信息...
          </div>
        )}
        {protagonists.length > 0 && !syncing && (
          <div style={{ color: 'var(--color-primary)', marginTop: 4 }}>
            ⭐ 已同步主角：{protagonists.map((protagonist) => protagonist.name).join('、')}
          </div>
        )}
        {protagonists.length === 0 && !syncing && (
          <div style={{ color: 'var(--color-warning)', marginTop: 4 }}>
            ⚠️ 未检测到主角信息，请先在作品详情中完善主角设定
          </div>
        )}
        {notice && <div style={{ color: 'var(--color-success)', marginTop: 4 }}>{notice}</div>}
        {error && <div style={{ color: 'var(--color-error)', marginTop: 4 }}>{error}</div>}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">
          ⭐ 主角快捷项{protagonists.length > 1 ? `（${protagonists.length}）` : ''}
        </div>
        {protagonists.length > 0 ? (
          protagonists.map((protagonist) => {
            const chapterCharacter = chapterChars.find(
              (item) => item.characterId === protagonist.id,
            );
            return (
              <div
                key={protagonist.id}
                className="character-item"
                style={{
                  borderColor: 'var(--color-primary)',
                  borderWidth: 1,
                  background: 'color-mix(in srgb, var(--color-primary) 4%, transparent)',
                }}
              >
                <div
                  className="character-avatar"
                  style={{
                    background: 'var(--color-primary)',
                    color: 'var(--color-on-primary)',
                    fontWeight: 'bold',
                  }}
                >
                  ⭐
                </div>
                <div className="character-info" style={{ flex: 1 }}>
                  <div className="character-name">
                    {protagonist.name}
                    <span
                      style={{
                        color: 'var(--color-primary)',
                        fontSize: 11,
                        marginLeft: 4,
                        fontWeight: 'bold',
                      }}
                    >
                      {protagonist.protagonistLabel || '主角'}
                    </span>
                  </div>
                  <div className="character-role">
                    {protagonist.identity || '作品主角'}
                    {chapterCharacter?.mustAppear
                      ? ' · 本章必须出场'
                      : chapterCharacter
                        ? ' · 本章出场'
                        : ' · 本章不出场'}
                  </div>
                  {protagonist.goal && (
                    <div
                      style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}
                    >
                      目标：{protagonist.goal}
                    </div>
                  )}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      marginTop: 6,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!chapterCharacter}
                      disabled={!chapter?.id || actionBusy}
                      onChange={(event) =>
                        onSetProtagonistAppearance(protagonist, event.target.checked)
                      }
                    />
                    {protagonist.name}本章出场
                  </label>
                </div>
                <button
                  className="btn btn-sm"
                  style={{
                    background: chapterCharacter ? 'var(--color-bg-hover)' : 'var(--color-primary)',
                    color: chapterCharacter
                      ? 'var(--color-text-secondary)'
                      : 'var(--color-on-primary)',
                    border: 'none',
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => onSetProtagonistAppearance(protagonist, !chapterCharacter)}
                  disabled={!chapter?.id || actionBusy}
                  title={
                    !chapter?.id
                      ? '请先选择章节'
                      : chapterCharacter
                        ? `设置${protagonist.name}本章不出场`
                        : `将${protagonist.name}加入本章`
                  }
                >
                  {chapterCharacter ? '本章不出场' : '加入本章'}
                </button>
              </div>
            );
          })
        ) : (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-warning)',
              padding: '8px 0',
              lineHeight: 1.6,
            }}
          >
            尚未设置主角，请先在作品详情中完善主角信息。
          </div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">📌 本章出场角色</div>
        {chapterChars.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>
            尚未添加本章出场角色
          </div>
        )}
        {chapterChars.map((chapterCharacter) => {
          const character = characters.find((item) => item.id === chapterCharacter.characterId);
          const isProtagonist = isProtagonistCharacter(character);
          return (
            <div
              key={chapterCharacter.id}
              className="character-item"
              style={
                isProtagonist ? { borderColor: 'var(--color-primary)', borderWidth: 2 } : undefined
              }
            >
              <div
                className="character-avatar"
                style={
                  isProtagonist
                    ? {
                        background: 'var(--color-primary)',
                        color: 'var(--color-on-primary)',
                        fontWeight: 'bold',
                      }
                    : undefined
                }
              >
                {isProtagonist
                  ? '⭐'
                  : (character?.name || chapterCharacter.characterName || '?')[0]}
              </div>
              <div className="character-info">
                <div className="character-name">
                  {character?.name || chapterCharacter.characterName || '未知'}
                  {isProtagonist && (
                    <span style={{ color: 'var(--color-primary)', fontSize: 11, marginLeft: 4 }}>
                      主角
                    </span>
                  )}
                </div>
                <div className="character-role">
                  {ChapterCharacterRoleLabels[chapterCharacter.roleInChapter]}
                  {chapterCharacter.mustAppear && ' · 必须出场'}
                  {chapterCharacter.note && ` · ${chapterCharacter.note}`}
                </div>
              </div>
              <button
                className="btn btn-text btn-sm"
                onClick={() => onRemoveFromChapter(chapterCharacter)}
                disabled={actionBusy}
              >
                移除
              </button>
            </div>
          );
        })}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">📚 角色库（{characters.length}）</div>
        {availableChars.length === 0 && characters.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>
            暂无角色，可 AI 生成候选
          </div>
        )}
        {availableChars.length === 0 && characters.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>
            所有角色已加入本章
          </div>
        )}
        {availableChars.map((character) => {
          const isProtagonist = isProtagonistCharacter(character);
          return (
            <div
              key={character.id}
              className="character-item"
              style={
                isProtagonist
                  ? {
                      borderColor: 'var(--color-primary)',
                      borderWidth: 1,
                      background: 'color-mix(in srgb, var(--color-primary) 3%, transparent)',
                    }
                  : undefined
              }
            >
              <div
                className="character-avatar"
                style={
                  isProtagonist
                    ? {
                        background: 'var(--color-primary)',
                        color: 'var(--color-on-primary)',
                        fontWeight: 'bold',
                      }
                    : undefined
                }
              >
                {isProtagonist ? '⭐' : character.name[0]}
              </div>
              <div className="character-info" style={{ flex: 1 }}>
                <div className="character-name">
                  {character.name}
                  {isProtagonist && (
                    <span
                      style={{
                        color: 'var(--color-primary)',
                        fontSize: 11,
                        marginLeft: 4,
                        fontWeight: 'bold',
                      }}
                    >
                      主角
                    </span>
                  )}
                </div>
                <div className="character-role">
                  {character.roleType ? CharacterRoleLabels[character.roleType] : '未分类'}
                  {character.identity ? ` · ${character.identity}` : ''}
                </div>
                {isProtagonist && character.goal && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    目标：{character.goal}
                  </div>
                )}
                {isProtagonist && character.personality && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    性格：
                    {character.personality.length > 40
                      ? character.personality.slice(0, 40) + '...'
                      : character.personality}
                  </div>
                )}
                {isProtagonist && character.behaviorLimits && (
                  <div style={{ fontSize: 11, color: 'var(--color-warning)' }}>
                    限制：
                    {character.behaviorLimits.length > 30
                      ? character.behaviorLimits.slice(0, 30) + '...'
                      : character.behaviorLimits}
                  </div>
                )}
              </div>
              <button
                className="btn btn-sm"
                style={
                  isProtagonist
                    ? {
                        background: 'var(--color-primary)',
                        color: 'var(--color-on-primary)',
                        border: 'none',
                        whiteSpace: 'nowrap',
                      }
                    : { whiteSpace: 'nowrap' }
                }
                onClick={() =>
                  onAddToChapter(
                    character.id,
                    character.name,
                    isProtagonist ? 'main' : 'supporting',
                  )
                }
                disabled={!chapter?.id || actionBusy}
                title={
                  !chapter?.id ? '请先选择章节' : isProtagonist ? '将主角加入本章' : '加入本章'
                }
              >
                {isProtagonist ? '⭐ 加入本章' : '➕ 添加'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">🤖 AI 推荐候选角色</div>
        {loading ? (
          <button
            className="btn btn-secondary btn-sm"
            onClick={onStopGeneratingCandidates}
            style={{ marginBottom: 8, width: '100%' }}
          >
            停止生成
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={onGenerateCandidates}
            disabled={!chapter}
            style={{ marginBottom: 8, width: '100%' }}
          >
            ✨ 生成本章候选角色
          </button>
        )}
        {candidates.map((candidate, index) => (
          <div
            key={index}
            className="character-item"
            style={{ borderColor: 'var(--color-primary-light)' }}
          >
            <div
              className="character-avatar"
              style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
            >
              {candidate.name[0]}
            </div>
            <div className="character-info">
              <div className="character-name">{candidate.name}</div>
              <div className="character-role">
                {candidate.roleType
                  ? CharacterRoleLabels[candidate.roleType] || candidate.roleType
                  : '未知'}
                {candidate.identity ? ` · ${candidate.identity}` : ''}
              </div>
              {candidate.goal && (
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  目标：{candidate.goal}
                </div>
              )}
              {candidate.chapterFunction && (
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  本章作用：{candidate.chapterFunction}
                </div>
              )}
              {candidate.rawText && (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text-secondary)',
                    whiteSpace: 'pre-wrap',
                    marginTop: 4,
                  }}
                >
                  {candidate.rawText}
                </div>
              )}
            </div>
            {!candidate.rawText && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => onConfirmCandidate(candidate)}
                disabled={characters.some((character) => character.name === candidate.name)}
              >
                ✅ 确认入库
              </button>
            )}
          </div>
        ))}
        {candidates.length === 0 && !loading && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>
            点击上方按钮，AI 将根据章节大纲推荐适合本章出场的角色
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
          ⚠️ AI 候选角色需确认后才加入角色库，不会自动入库。已有主角不会被重复推荐。
        </div>
      </div>
    </div>
  );
}
