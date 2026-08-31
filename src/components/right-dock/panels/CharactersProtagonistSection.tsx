import { Crown } from 'lucide-react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterCharacter, Character } from '../../../types/character';

interface CharactersProtagonistSectionProps {
  chapter?: Chapter;
  protagonists: Character[];
  chapterChars: ChapterCharacter[];
  actionBusy: boolean;
  onSetAppearance: (character: Character, appear: boolean) => void;
}

export function CharactersProtagonistSection({
  chapter,
  protagonists,
  chapterChars,
  actionBusy,
  onSetAppearance,
}: CharactersProtagonistSectionProps) {
  return (
    <div className="panel-section">
      <div
        className="panel-section-title"
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <Crown size={14} strokeWidth={1.8} aria-hidden="true" />
        主角快捷项{protagonists.length > 1 ? `（${protagonists.length}）` : ''}
      </div>
      {protagonists.length > 0 ? (
        protagonists.map((protagonist) => {
          const chapterCharacter = chapterChars.find((item) => item.characterId === protagonist.id);
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
                <Crown size={16} strokeWidth={1.8} aria-hidden="true" />
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
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
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
                    onChange={(event) => onSetAppearance(protagonist, event.target.checked)}
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
                onClick={() => onSetAppearance(protagonist, !chapterCharacter)}
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
  );
}
