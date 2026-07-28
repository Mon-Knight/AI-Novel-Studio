import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BackButton from '../../components/common/BackButton';
import ReferenceImportCard from '../../components/references/ReferenceImportCard';
import { confirmDanger } from '../../utils/nativeDialog';
import { describeUnknownError } from '../../utils/errorMessage';
import { formatDate } from '../../utils/date';
import { formatNumber } from '../../utils/format';
import { referenceLibraryService } from '../../services/references/referenceLibraryService';
import { createReferenceStyleProfile } from '../../services/references/referenceStyleProfileService';
import { isAiRequestCancelled } from '../../services/ai/aiCancellation';
import type { ReferencePurpose, ReferenceWork, ReferenceWorkBundle } from '../../types/reference';
import '../../styles/reference-library.css';

function purposeLabel(purpose: ReferencePurpose): string {
  return {
    style: '风格分析',
    research: '资料研究',
    inspiration: '灵感参考',
  }[purpose];
}

function ReferenceLibraryPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const navigate = useNavigate();
  const analysisAbortRef = useRef<AbortController | null>(null);
  const [works, setWorks] = useState<ReferenceWork[]>([]);
  const [selectedWorkId, setSelectedWorkId] = useState('');
  const [bundle, setBundle] = useState<ReferenceWorkBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [analyzingStyle, setAnalyzingStyle] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadWorks = useCallback(
    async (preferredWorkId?: string) => {
      if (!novelId) return;
      const nextWorks = await referenceLibraryService.listWorks(novelId);
      setWorks(nextWorks);
      const nextId =
        preferredWorkId && nextWorks.some((item) => item.id === preferredWorkId)
          ? preferredWorkId
          : (nextWorks[0]?.id ?? '');
      setSelectedWorkId(nextId);
      setBundle(nextId ? await referenceLibraryService.getBundle(novelId, nextId) : null);
    },
    [novelId],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadWorks()
      .catch((caught: unknown) => {
        if (active) setError(describeUnknownError(caught, '参考资料库加载失败'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      analysisAbortRef.current?.abort();
    };
  }, [loadWorks]);

  const selectWork = async (workId: string) => {
    if (!novelId || busy) return;
    setSelectedWorkId(workId);
    setError('');
    try {
      setBundle(await referenceLibraryService.getBundle(novelId, workId));
    } catch (caught: unknown) {
      setError(describeUnknownError(caught, '参考作品加载失败'));
    }
  };

  const loadSectionPage = async (offset: number) => {
    if (!novelId || !bundle || busy) return;
    setBusy(true);
    setError('');
    try {
      setBundle(
        await referenceLibraryService.getBundle(
          novelId,
          bundle.work.id,
          offset,
          bundle.sectionLimit,
        ),
      );
    } catch (caught: unknown) {
      setError(describeUnknownError(caught, '参考章节分页加载失败'));
    } finally {
      setBusy(false);
    }
  };

  const activateVersion = async (importId: string) => {
    if (!novelId || !bundle || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await referenceLibraryService.activateImport(
        novelId,
        bundle.work.id,
        importId,
        bundle.work.revision,
      );
      setBundle(next);
      await loadWorks(next.work.id);
      setMessage('当前参考版本已切换，旧版本画像会标记为过期。');
    } catch (caught: unknown) {
      setError(describeUnknownError(caught, '参考版本切换失败'));
    } finally {
      setBusy(false);
    }
  };

  const analyzeStyle = async () => {
    if (!bundle || analyzingStyle) return;
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setAnalyzingStyle(true);
    setError('');
    setMessage('正在按开篇、发展、对话、描写、高潮和收束分层分析…');
    try {
      const result = await createReferenceStyleProfile(bundle, { signal: controller.signal });
      setMessage(`风格画像“${result.profile.name}”已保存，可在风格方案中启用。`);
    } catch (caught: unknown) {
      if (isAiRequestCancelled(caught)) setMessage('风格分析已停止，未保存不完整画像。');
      else setError(describeUnknownError(caught, '分层风格分析失败'));
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
      setAnalyzingStyle(false);
    }
  };

  const deleteWork = async () => {
    if (!novelId || !bundle || busy) return;
    const confirmed = await confirmDanger({
      title: '删除参考作品',
      message: `删除“${bundle.work.title}”及其全部导入版本？已生成的抽象风格画像会保留并标记来源缺失。`,
    });
    if (!confirmed) return;
    setBusy(true);
    setError('');
    try {
      await referenceLibraryService.deleteWork(novelId, bundle.work.id, bundle.work.revision);
      setSelectedWorkId('');
      await loadWorks();
      setMessage('参考作品已删除，派生画像已保留。');
    } catch (caught: unknown) {
      setError(describeUnknownError(caught, '参考作品删除失败'));
    } finally {
      setBusy(false);
    }
  };

  if (!novelId) return <div className="reference-library-page">缺少小说作用域。</div>;

  return (
    <div className="reference-library-page">
      <header className="reference-library-header">
        <BackButton fallbackTo={`/novels/${novelId}`} />
        <div>
          <h1>参考资料库</h1>
          <p>原文独立于卷章树保存；正文生成只读取抽象风格画像。</p>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate('/styles')}>
          查看风格方案
        </button>
      </header>

      {(message || error) && (
        <div className={`reference-library-notice ${error ? 'is-error' : ''}`} role="status">
          {error || message}
        </div>
      )}

      <ReferenceImportCard
        novelId={novelId}
        works={works}
        onImported={async (workId) => loadWorks(workId)}
        onStatus={(value, isError) => {
          setError(isError ? value : '');
          setMessage(isError ? '' : value);
        }}
      />

      <div className="reference-library-workspace">
        <aside className="reference-work-list" aria-label="参考作品列表">
          <div className="reference-pane-title">
            参考作品 <span>{works.length}</span>
          </div>
          {loading ? (
            <p className="reference-empty">正在加载…</p>
          ) : works.length === 0 ? (
            <p className="reference-empty">尚未导入参考资料。</p>
          ) : (
            works.map((work) => (
              <button
                key={work.id}
                className={`reference-work-item ${selectedWorkId === work.id ? 'is-active' : ''}`}
                onClick={() => void selectWork(work.id)}
              >
                <strong>{work.title}</strong>
                <span>
                  {purposeLabel(work.purpose)} · {work.sectionCount} 片段
                </span>
                <small>
                  v{work.revision} · {formatDate(work.updatedAt)}
                </small>
              </button>
            ))
          )}
        </aside>

        <main className="reference-work-detail">
          {!bundle ? (
            <div className="reference-detail-empty">选择或导入一部参考作品。</div>
          ) : (
            <>
              <div className="reference-detail-heading">
                <div>
                  <span className="reference-purpose-badge">
                    {purposeLabel(bundle.work.purpose)}
                  </span>
                  <h2>{bundle.work.title}</h2>
                  <p>{bundle.work.description || '未填写说明'}</p>
                </div>
                <div className="reference-detail-actions">
                  {bundle.work.purpose === 'style' &&
                    (analyzingStyle ? (
                      <button
                        className="btn btn-secondary"
                        onClick={() => analysisAbortRef.current?.abort()}
                      >
                        停止分析
                      </button>
                    ) : (
                      <button className="btn btn-primary" onClick={() => void analyzeStyle()}>
                        生成分层风格画像
                      </button>
                    ))}
                  <button
                    className="btn btn-secondary"
                    onClick={() => void deleteWork()}
                    disabled={busy}
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="reference-fact-grid">
                <div>
                  <strong>{formatNumber(bundle.work.totalChars)}</strong>
                  <span>总字符</span>
                </div>
                <div>
                  <strong>{bundle.work.sectionCount}</strong>
                  <span>当前片段</span>
                </div>
                <div>
                  <strong>{bundle.imports.length}</strong>
                  <span>导入版本</span>
                </div>
                <div>
                  <strong>{bundle.work.activeSourceHash.slice(0, 10)}…</strong>
                  <span>当前来源</span>
                </div>
              </div>
              <section className="reference-version-section">
                <h3>版本记录</h3>
                <div className="reference-version-list">
                  {bundle.imports.map((item) => (
                    <div
                      key={item.id}
                      className={`reference-version-item ${item.isCurrent ? 'is-current' : ''}`}
                    >
                      <div>
                        <strong>
                          v{item.version} {item.isCurrent && <em>当前</em>}
                        </strong>
                        <span>
                          {item.fileName} · {item.encoding.toUpperCase()} ·{' '}
                          {formatDate(item.importedAt)}
                        </span>
                      </div>
                      {!item.isCurrent && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => void activateVersion(item.id)}
                          disabled={busy}
                        >
                          设为当前
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
              <section className="reference-section-list">
                <h3>
                  当前章节与片段（
                  {bundle.sectionTotal === 0 ? 0 : bundle.sectionOffset + 1}-
                  {Math.min(bundle.sectionOffset + bundle.sections.length, bundle.sectionTotal)} /{' '}
                  {bundle.sectionTotal}）
                </h3>
                {bundle.sections.map((section) => (
                  <article key={section.id}>
                    <div>
                      <strong>
                        {section.orderIndex}. {section.title}
                      </strong>
                      <span>
                        {formatNumber(section.charCount)} 字符 · {section.contentHash.slice(0, 10)}…
                      </span>
                    </div>
                  </article>
                ))}
                {bundle.sectionTotal > bundle.sectionLimit && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={busy || bundle.sectionOffset === 0}
                      onClick={() =>
                        void loadSectionPage(
                          Math.max(0, bundle.sectionOffset - bundle.sectionLimit),
                        )
                      }
                    >
                      上一页
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={
                        busy || bundle.sectionOffset + bundle.sections.length >= bundle.sectionTotal
                      }
                      onClick={() =>
                        void loadSectionPage(bundle.sectionOffset + bundle.sectionLimit)
                      }
                    >
                      下一页
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default ReferenceLibraryPage;
