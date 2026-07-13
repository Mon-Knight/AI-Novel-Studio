import { useNavigate, useParams } from 'react-router-dom';
import CreativeIntentEditor from '../../components/creative-intent/CreativeIntentEditor';
import { useCreativeIntentWorkspace } from '../../features/creative-intent/useCreativeIntentWorkspace';
import '../../styles/creative-intent.css';

function CreativeIntentPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const navigate = useNavigate();
  const workspace = useCreativeIntentWorkspace(novelId);
  const {
    novelTitle,
    record,
    statements,
    loading,
    loadReady,
    saving,
    error,
    errorKind,
    message,
    draftState: {
      dirty,
      confirmedCount,
      pendingCount,
      pendingInferenceCount,
      blockingReasons,
    },
    load,
    freeze,
    addStatement,
    changeStatement,
    removeStatement,
  } = workspace;

  if (loading) {
    return <div className="creative-intent-page page-container" role="status">正在读取创作意图…</div>;
  }

  return (
    <div className="creative-intent-page page-container">
      <header className="creative-intent-page-header">
        <button
          type="button"
          className="creative-intent-back"
          onClick={() => navigate(`/novels/${novelId}`)}
        >
          ← 返回作品详情
        </button>
        <div className="creative-intent-title-row">
          <div>
            <span className="creative-intent-eyebrow">{novelTitle || '当前作品'}</span>
            <h1>创作意图</h1>
            <p>先由作者明确方向，再让 AI 生成候选。冻结不会写入正式设定或正文。</p>
          </div>
          <div className="creative-intent-revision-card" aria-label="当前创作意图版本">
            <span>当前版本</span>
            <strong>{record ? `r${record.intent.revision}` : '尚未冻结'}</strong>
            <small>{record ? new Date(record.intent.frozenAt).toLocaleString() : '从第一版开始'}</small>
          </div>
        </div>
      </header>

      {error && (
        <div className="creative-intent-alert error" role="alert">
          <span>{error}</span>
          {errorKind !== 'freeze' && (
            <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={saving}>
              {errorKind === 'conflict' ? '重新读取最新版本' : '重试读取'}
            </button>
          )}
        </div>
      )}
      {message && <div className="creative-intent-alert success" role="status">{message}</div>}

      <div className="creative-intent-summary">
        <div><strong>{statements.length}</strong><span>意图总数</span></div>
        <div><strong>{confirmedCount}</strong><span>作者已确认</span></div>
        <div><strong>{pendingCount}</strong><span>仍待确认</span></div>
        <div><strong>{record?.intent.contentHash.slice(0, 10) || '—'}</strong><span>冻结校验</span></div>
      </div>

      {pendingInferenceCount > 0 && (
        <div className="creative-intent-alert warning">
          有 {pendingInferenceCount} 项推断或待确认信息仍为 pending；可以随快照保留，但不会视为作者确认。
        </div>
      )}

      <CreativeIntentEditor
        statements={statements}
        disabled={saving || !loadReady}
        onAdd={addStatement}
        onChange={changeStatement}
        onRemove={removeStatement}
      />

      <footer className="creative-intent-freeze-bar">
        <div>
          <strong>{dirty ? '存在尚未冻结的修改' : '当前内容已与冻结版本一致'}</strong>
          {blockingReasons.length > 0 && <span>{blockingReasons.join('；')}</span>}
          {blockingReasons.length === 0 && <span>冻结后将创建新的不可变 revision。</span>}
        </div>
        <button
          type="button"
          className="btn btn-primary creative-intent-freeze-button"
          onClick={() => void freeze()}
          disabled={saving || blockingReasons.length > 0}
        >
          {saving ? '正在冻结…' : `冻结为 r${(record?.intent.revision ?? 0) + 1}`}
        </button>
      </footer>
    </div>
  );
}

export default CreativeIntentPage;
