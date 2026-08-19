import { useMemo, useState, type FormEvent } from 'react';
import type { Chapter } from '../../types/chapter';
import { buildChapterMetadataTargets } from '../../services/content-transactions/contentTransactionService';
import type { PrepareContentTargetInput } from '../../types/contentTransaction';

interface CrossChapterBatchPanelProps {
  chapters: Chapter[];
  busy: boolean;
  onPrepare(targets: PrepareContentTargetInput[]): Promise<void>;
}

export default function CrossChapterBatchPanel({
  chapters,
  busy,
  onPrepare,
}: CrossChapterBatchPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [goal, setGoal] = useState('');
  const [status, setStatus] = useState('');
  const [titlePrefix, setTitlePrefix] = useState('');
  const ordered = useMemo(
    () => [...chapters].sort((left, right) => left.chapterNumber - right.chapterNumber),
    [chapters],
  );

  const toggle = (chapterId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const targets = buildChapterMetadataTargets([...selected], { goal, status, titlePrefix });
    await onPrepare(targets);
  };

  return (
    <section className="story-assets-card">
      <header className="story-assets-section-header">
        <div>
          <h3>跨章节批处理</h3>
          <p>冻结章节集合与基础 hash；先审阅候选，再按批准集合原子应用。</p>
        </div>
        <span>
          {selected.size} / {ordered.length}
        </span>
      </header>
      <form onSubmit={submit}>
        <div className="story-assets-batch-fields">
          <label>
            统一章节目标
            <input value={goal} onChange={(event) => setGoal(event.target.value)} />
          </label>
          <label>
            标题前缀
            <input
              value={titlePrefix}
              onChange={(event) => setTitlePrefix(event.target.value)}
              placeholder="例如：终局·第"
            />
          </label>
          <label>
            状态
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">保持不变</option>
              <option value="not_started">未开始</option>
              <option value="outline_ready">大纲就绪</option>
              <option value="editing">编辑中</option>
              <option value="polished">已润色</option>
            </select>
          </label>
        </div>
        <div className="story-assets-batch-toolbar">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setSelected(new Set(ordered.map((chapter) => chapter.id)))}
          >
            全选
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setSelected(new Set())}
          >
            清空
          </button>
        </div>
        <div className="story-assets-chapter-list">
          {ordered.map((chapter) => (
            <label key={chapter.id} className="story-assets-chapter-row">
              <input
                type="checkbox"
                checked={selected.has(chapter.id)}
                onChange={() => toggle(chapter.id)}
              />
              <span>
                第{chapter.chapterNumber}章 {chapter.title}
              </span>
              <small>{chapter.status}</small>
            </label>
          ))}
        </div>
        <div className="story-assets-form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || selected.size === 0}>
            生成批处理候选
          </button>
        </div>
      </form>
    </section>
  );
}
