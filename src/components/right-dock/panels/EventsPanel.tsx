import { useState, useEffect, useCallback } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { Character, ChapterCharacter } from '../../../types/character';
import type { ChapterEvent, ChapterEventStatus } from '../../../types/chapterEvent';
import { ChapterEventStatusLabels } from '../../../types/chapterEvent';
import { characterService } from '../../../services/characters/characterService';
import { chapterCharacterService } from '../../../services/characters/chapterCharacterService';
import { chapterEventService } from '../../../services/characters/chapterEventService';
import { eventSuggestService } from '../../../services/ai/eventSuggestService';
import type { EventSuggestion } from '../../../services/ai/eventSuggestService';

interface EventsPanelProps {
  novelId?: string;
  chapter?: Chapter;
  onGenerated?: (draft: any) => void;
  onAdopted?: () => void;
}

function EventsPanel({ novelId, chapter, onGenerated, onAdopted }: EventsPanelProps) {
  const [events, setEvents] = useState<ChapterEvent[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [chapterChars, setChapterChars] = useState<ChapterCharacter[]>([]);
  const [suggestions, setSuggestions] = useState<EventSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!novelId || !chapter?.id) return;
    const [evts, chars, cc] = await Promise.all([
      chapterEventService.getByChapterId(chapter.id),
      characterService.getByNovelId(novelId),
      chapterCharacterService.getByChapterId(chapter.id),
    ]);
    setEvents(evts);
    setCharacters(chars);
    setChapterChars(cc);
  }, [novelId, chapter?.id]);

  useEffect(() => { load(); }, [load]);

  const handleSuggestEvents = async () => {
    if (!novelId || !chapter) return;
    setLoading(true); setError('');
    try {
      const chapterCharacters = chapterChars
        .map((cc) => characters.find((c) => c.id === cc.characterId))
        .filter(Boolean) as Character[];
      const list = await eventSuggestService.suggestEvents({
        novelId, chapterId: chapter.id, chapterOutline: chapter.title, characters: chapterCharacters,
      });
      setSuggestions(list);
    } catch (e: any) { setError(e.message || '生成失败'); }
    finally { setLoading(false); }
  };

  const handleAdoptSuggestion = async (s: EventSuggestion) => {
    if (!novelId || !chapter?.id) return;
    const ev = await chapterEventService.create({
      novelId, chapterId: chapter.id, title: s.title, description: s.description,
      involvedCharacterIds: s.involvedCharacterIds, impact: s.impact, risk: s.risk,
      status: 'selected', source: 'ai_suggested',
    });
    setEvents((prev) => [...prev, ev]);
    setSuggestions((prev) => prev.filter((x) => x.title !== s.title));
  };

  const handleSetStatus = async (id: string, status: ChapterEventStatus) => {
    await chapterEventService.setStatus(id, status);
    setEvents((prev) => prev.map((e) => e.id === id ? { ...e, status } : e));
  };

  const handleRemove = async (id: string) => {
    await chapterEventService.remove(id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
  };

  const getStatusStyle = (status: ChapterEventStatus) => {
    if (status === 'required') return { color: 'var(--color-error)', fontWeight: 600 };
    if (status === 'forbidden') return { color: 'var(--color-text-muted)', textDecoration: 'line-through' };
    return {};
  };

  if (!novelId) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择作品</div>;

  return (
    <div>
      {/* 当前事件列表 */}
      <div className="panel-section">
        <div className="panel-section-title">📋 本章事件（{events.length}）</div>
        {events.map((ev) => (
          <div key={ev.id} className="event-item">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={getStatusStyle(ev.status)}>
                {ev.status === 'required' && '🔴 '}
                {ev.status === 'forbidden' && '🚫 '}
                {ev.title}
              </strong>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {ChapterEventStatusLabels[ev.status]}
              </span>
            </div>
            <div style={{ fontSize: 12, marginTop: 2, color: 'var(--color-text-secondary)' }}>{ev.description}</div>
            {ev.impact && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>影响：{ev.impact}</div>}
            {ev.risk && <div style={{ fontSize: 11, color: 'var(--color-warning)' }}>风险：{ev.risk}</div>}
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button className="btn btn-text btn-sm" onClick={() => handleSetStatus(ev.id, 'required')}>必须发生</button>
              <button className="btn btn-text btn-sm" onClick={() => handleSetStatus(ev.id, 'forbidden')}>禁止发生</button>
              <button className="btn btn-text btn-sm" onClick={() => handleSetStatus(ev.id, 'selected')}>已选择</button>
              <button className="btn btn-text btn-sm" onClick={() => handleRemove(ev.id)}>删除</button>
            </div>
          </div>
        ))}
        {events.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>暂无事件，可 AI 建议</div>
        )}
      </div>

      {/* AI 建议 */}
      <div className="panel-section">
        <div className="panel-section-title">🤖 AI 推荐事件</div>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSuggestEvents}
          disabled={loading || !chapter}
          style={{ marginBottom: 8, width: '100%' }}
        >
          {loading ? '⏳  分析中...' : '💡 生成本章事件建议'}
        </button>
        {error && <div style={{ fontSize: 12, color: 'var(--color-error)', marginBottom: 8 }}>{error}</div>}
        {suggestions.map((s, i) => (
          <div key={i} className="event-item" style={{ borderColor: 'var(--color-primary-light)' }}>
            <strong>{s.title}</strong>
            <div style={{ fontSize: 12, marginTop: 2, color: 'var(--color-text-secondary)' }}>{s.description}</div>
            {s.impact && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>影响：{s.impact}</div>}
            {s.risk && <div style={{ fontSize: 11, color: 'var(--color-warning)' }}>风险：{s.risk}</div>}
            <button
              className="btn btn-primary btn-sm"
              onClick={() => handleAdoptSuggestion(s)}
              style={{ marginTop: 4 }}
            >
              ✅ 采用建议
            </button>
          </div>
        ))}
        {suggestions.length === 0 && !loading && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>
            点击上方按钮，AI 将根据章节大纲和出场角色建议可能的事件
          </div>
        )}
      </div>

      {/* 提示 */}
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: '8px 0', borderTop: '1px solid var(--color-border-light)' }}>
        💡 事件建议基于分卷大纲、章节大纲、前文总结、当前角色状态和未回收伏笔
      </div>
    </div>
  );
}

export default EventsPanel;
