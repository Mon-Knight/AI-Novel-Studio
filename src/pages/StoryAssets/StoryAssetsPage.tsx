import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BackButton from '../../components/common/BackButton';
import { contentTransactionService } from '../../services/content-transactions/contentTransactionService';
import { chapterRepository } from '../../services/database/chapterRepository';
import { getDbMode } from '../../services/database/db';
import { novelRepository } from '../../services/database/novelRepository';
import type { Chapter } from '../../types/chapter';
import type {
  ContentTransaction,
  FactionAsset,
  LocationAsset,
  PrepareContentTargetInput,
} from '../../types/contentTransaction';
import { describeUnknownError } from '../../utils/errorMessage';
import CrossChapterBatchPanel from './CrossChapterBatchPanel';
import StoryAssetForms from './StoryAssetForms';
import TransactionReview from './TransactionReview';
import '../../styles/story-assets.css';

type PageTab = 'assets' | 'batch' | 'history';

function targetIdentity(target: ContentTransaction['targets'][number]): string {
  return `${target.targetType}\u0000${target.targetId}`;
}

export default function StoryAssetsPage() {
  const { novelId = '' } = useParams<{ novelId: string }>();
  const navigate = useNavigate();
  const desktop = getDbMode() === 'tauri';
  const [title, setTitle] = useState('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [factions, setFactions] = useState<FactionAsset[]>([]);
  const [locations, setLocations] = useState<LocationAsset[]>([]);
  const [history, setHistory] = useState<ContentTransaction[]>([]);
  const [tab, setTab] = useState<PageTab>('assets');
  const [pending, setPending] = useState<ContentTransaction | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!novelId) return;
    const novel = await novelRepository.getById(novelId);
    setTitle(novel?.title ?? '未知作品');
    const loadedChapters = await chapterRepository.getByNovelId(novelId);
    setChapters(loadedChapters);
    if (!desktop) return;
    const [loadedFactions, loadedLocations, transactions] = await Promise.all([
      contentTransactionService.listFactions(novelId),
      contentTransactionService.listLocations(novelId),
      contentTransactionService.list(novelId, 50),
    ]);
    setFactions(loadedFactions);
    setLocations(loadedLocations);
    setHistory(transactions);
  }, [desktop, novelId]);

  useEffect(() => {
    setLoading(true);
    void refresh()
      .catch((reason) => setError(describeUnknownError(reason, '正式资产读取失败')))
      .finally(() => setLoading(false));
  }, [refresh]);

  const prepare = async (targets: PrepareContentTargetInput[]) => {
    if (!desktop || !novelId || busy) return;
    setBusy(true);
    setError('');
    try {
      const transaction = await contentTransactionService.prepare({
        operationId: contentTransactionService.createOperationId('prepare'),
        novelId,
        strategy: targets.length > 1 ? 'reviewed_partial' : 'all_or_nothing',
        targets,
      });
      setPending(transaction);
      setApproved(new Set());
    } catch (reason) {
      setError(describeUnknownError(reason, '候选事务准备失败'));
    } finally {
      setBusy(false);
    }
  };

  const applyPending = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError('');
    try {
      await contentTransactionService.apply({
        transactionId: pending.transactionId,
        operationId: pending.operationId,
        expectedTransactionHash: pending.transactionHash,
        approvedTargets:
          pending.strategy === 'reviewed_partial'
            ? pending.targets
                .filter((target) => approved.has(targetIdentity(target)))
                .map((target) => ({ targetType: target.targetType, targetId: target.targetId }))
            : [],
      });
      setPending(null);
      setApproved(new Set());
      await refresh();
    } catch (reason) {
      setError(describeUnknownError(reason, '事务应用失败；所有未提交目标保持原状'));
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <div className="page-loading" role="status">
        正在加载正式创作资产…
      </div>
    );

  return (
    <main className="story-assets-page">
      <header className="story-assets-page-header">
        <div>
          <BackButton label="返回作品详情" to={`/novels/${novelId}`} />
          <h1>势力、地点与跨章节事务</h1>
          <p>{title} · 正式资产与候选应用边界</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate(`/novels/${novelId}/workspace`)}
        >
          进入写作工作台
        </button>
      </header>

      {!desktop && (
        <div className="story-assets-notice" role="status">
          正式资产依赖桌面 SQLite 事务；浏览器开发模式仅展示章节，不伪造持久记录。
        </div>
      )}
      {error && (
        <div className="story-assets-error" role="alert">
          {error}
        </div>
      )}

      <nav className="story-assets-page-tabs" aria-label="正式资产页面">
        {(
          [
            ['assets', '正式资产'],
            ['batch', '跨章节批处理'],
            ['history', '事务历史'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {pending && (
        <TransactionReview
          transaction={pending}
          approved={approved}
          busy={busy}
          onToggle={(identity) =>
            setApproved((current) => {
              const next = new Set(current);
              if (next.has(identity)) next.delete(identity);
              else next.add(identity);
              return next;
            })
          }
          onApply={() => void applyPending()}
          onCancel={() => {
            setPending(null);
            setApproved(new Set());
          }}
        />
      )}

      {tab === 'assets' && (
        <>
          <StoryAssetForms
            factions={factions}
            locations={locations}
            busy={busy || !desktop}
            createId={contentTransactionService.createOperationId}
            onPrepare={prepare}
          />
          <div className="story-assets-columns">
            <section className="story-assets-card">
              <h3>势力（{factions.length}）</h3>
              <div className="story-assets-list">
                {factions.map((faction) => (
                  <article key={faction.id}>
                    <strong>{faction.name}</strong>
                    <small>
                      r{faction.revision} · {faction.kind || '未分类'}
                    </small>
                    <p>{faction.description || faction.goals || '暂无描述'}</p>
                  </article>
                ))}
                {desktop && factions.length === 0 && (
                  <p className="story-assets-empty">尚无正式势力。</p>
                )}
              </div>
            </section>
            <section className="story-assets-card">
              <h3>地点（{locations.length}）</h3>
              <div className="story-assets-list">
                {locations.map((location) => (
                  <article key={location.id}>
                    <strong>{location.name}</strong>
                    <small>
                      r{location.revision} · {location.kind || '未分类'}
                    </small>
                    <p>{location.description || '暂无描述'}</p>
                  </article>
                ))}
                {desktop && locations.length === 0 && (
                  <p className="story-assets-empty">尚无正式地点。</p>
                )}
              </div>
            </section>
          </div>
        </>
      )}

      {tab === 'batch' && (
        <CrossChapterBatchPanel chapters={chapters} busy={busy || !desktop} onPrepare={prepare} />
      )}
      {tab === 'history' && (
        <section className="story-assets-card">
          <h3>最近事务</h3>
          <div className="story-assets-history">
            {history.map((transaction) => (
              <article key={transaction.transactionId}>
                <span className={`story-assets-status ${transaction.status}`}>
                  {transaction.status}
                </span>
                <strong>{transaction.strategy}</strong>
                <span>{transaction.targets.length} 个目标</span>
                <time>{new Date(transaction.createdAt).toLocaleString()}</time>
              </article>
            ))}
            {desktop && history.length === 0 && (
              <p className="story-assets-empty">尚无事务历史。</p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
