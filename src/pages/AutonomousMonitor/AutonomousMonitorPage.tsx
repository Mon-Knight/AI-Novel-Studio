import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AutonomousGenerationPanel } from '../../components/autonomous/AutonomousGenerationPanel';
import { chapterRepository } from '../../services/database/chapterRepository';
import { novelRepository } from '../../services/database/novelRepository';
import type { Novel } from '../../types/novel';
import '../../styles/right-dock.css';

export default function AutonomousMonitorPage() {
  const { novelId = '' } = useParams<{ novelId: string }>();
  const navigate = useNavigate();
  const [novel, setNovel] = useState<Novel | null>(null);
  const [chapterCount, setChapterCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([novelRepository.getById(novelId), chapterRepository.getByNovelId(novelId)])
      .then(([loadedNovel, chapters]) => {
        if (cancelled) return;
        if (!loadedNovel) {
          setError('作品不存在');
          return;
        }
        setNovel(loadedNovel);
        setChapterCount(chapters.filter((chapter) => !chapter.adoptedDraftId).length);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, [novelId]);

  if (error || !novel) {
    return (
      <main className="page-shell autonomous-monitor-page">
        <button className="btn btn-secondary" onClick={() => navigate(`/novels/${novelId}`)}>返回作品</button>
        <p className="text-secondary">{error ?? '正在加载作品…'}</p>
      </main>
    );
  }

  return (
    <main className="page-shell autonomous-monitor-page">
      <header className="page-header">
        <div>
          <button className="btn btn-secondary" onClick={() => navigate(`/novels/${novelId}`)}>返回作品</button>
          <h1>{novel.title} · 自主生成</h1>
          <p className="text-secondary">管理章节生成、质量门槛和可追溯操作日志。</p>
        </div>
      </header>
      <AutonomousGenerationPanel novelId={novel.id} totalChapters={chapterCount} />
    </main>
  );
}
