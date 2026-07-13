import type {
  ConfirmationStatus,
  CreativeIntentStatementInputV1,
  CreativeKnowledgeClass,
} from '../../types/creativeIntent';
import { editCreativeIntentStatement } from '../../features/creative-intent/creativeIntentDraft';

interface CreativeIntentEditorProps {
  statements: CreativeIntentStatementInputV1[];
  disabled?: boolean;
  onAdd: () => void;
  onChange: (index: number, statement: CreativeIntentStatementInputV1) => void;
  onRemove: (index: number) => void;
}

const kindLabels: Record<CreativeIntentStatementInputV1['kind'], string> = {
  goal: '创作目标',
  preference: '创作偏好',
  fact: '明确事实',
  constraint: '硬性约束',
};

const knowledgeLabels: Record<CreativeKnowledgeClass, string> = {
  author_explicit: '作者明确输入',
  inferred_preference: '推断偏好',
  requires_confirmation: '需要作者确认',
};

const confirmationLabels: Record<ConfirmationStatus, string> = {
  pending: '待确认',
  confirmed: '作者已确认',
  rejected: '作者已拒绝',
};

function valueText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value, null, 2);
}

function CreativeIntentEditor({
  statements,
  disabled = false,
  onAdd,
  onChange,
  onRemove,
}: CreativeIntentEditorProps) {
  const editContent = (
    index: number,
    statement: CreativeIntentStatementInputV1,
    patch: Partial<Pick<CreativeIntentStatementInputV1, 'kind' | 'value'>>,
  ) => {
    onChange(index, editCreativeIntentStatement(statement, patch));
  };

  const decide = (
    index: number,
    statement: CreativeIntentStatementInputV1,
    status: ConfirmationStatus,
  ) => onChange(index, { ...statement, confirmation: { status } });

  return (
    <section className="creative-intent-editor" aria-label="创作意图编辑器">
      <div className="creative-intent-editor-head">
        <div>
          <h2>意图陈述</h2>
          <p>逐项写清方向。冻结后只会创建新版本，不会覆盖旧版本。</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onAdd} disabled={disabled}>
          ＋ 新增陈述
        </button>
      </div>

      {statements.length === 0 ? (
        <div className="creative-intent-empty">
          <strong>还没有创作意图</strong>
          <span>先添加一项目标、事实、偏好或约束。</span>
          <button type="button" className="btn btn-primary" onClick={onAdd} disabled={disabled}>
            添加第一项
          </button>
        </div>
      ) : (
        <div className="creative-intent-list">
          {statements.map((statement, index) => {
            const status = statement.confirmation.status;
            const inferred = statement.knowledgeClass !== 'author_explicit';
            return (
              <article className="creative-intent-card" key={statement.statementId}>
                <div className="creative-intent-card-head">
                  <span className="creative-intent-index">{index + 1}</span>
                  <div className="creative-intent-trust">
                    <span className={`creative-intent-knowledge ${statement.knowledgeClass}`}>
                      {knowledgeLabels[statement.knowledgeClass]}
                    </span>
                    <span className={`creative-intent-status ${status}`}>
                      {confirmationLabels[status]}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="creative-intent-remove"
                    onClick={() => onRemove(index)}
                    disabled={disabled}
                    aria-label={`删除第 ${index + 1} 项创作意图`}
                  >
                    删除
                  </button>
                </div>

                <label className="creative-intent-field">
                  <span>类型</span>
                  <select
                    className="input"
                    value={statement.kind}
                    disabled={disabled}
                    aria-label={`第 ${index + 1} 项类型`}
                    onChange={(event) => editContent(index, statement, {
                      kind: event.target.value as CreativeIntentStatementInputV1['kind'],
                    })}
                  >
                    {Object.entries(kindLabels).map(([value, label]) => (
                      <option value={value} key={value}>{label}</option>
                    ))}
                  </select>
                </label>

                <label className="creative-intent-field">
                  <span>内容</span>
                  <textarea
                    className="input creative-intent-textarea"
                    value={valueText(statement.value)}
                    disabled={disabled}
                    aria-label={`第 ${index + 1} 项内容`}
                    placeholder="例如：故事围绕普通人在陌生规则中逐步成长，不以无代价力量解决冲突。"
                    onChange={(event) => editContent(index, statement, { value: event.target.value })}
                  />
                </label>

                {inferred && (
                  <div className="creative-intent-evidence">
                    <strong>判断依据</strong>
                    {statement.evidence.length > 0 ? (
                      <ul>
                        {statement.evidence.map((evidence) => (
                          <li key={evidence.evidenceId}>{evidence.excerpt || evidence.sourceType}</li>
                        ))}
                      </ul>
                    ) : <span>缺少依据，当前不能冻结。</span>}
                    <small>置信度 {Math.round(statement.confidence * 100)}%</small>
                  </div>
                )}

                <div className="creative-intent-card-actions">
                  {status !== 'confirmed' && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={disabled || valueText(statement.value).trim().length === 0}
                      onClick={() => decide(index, statement, 'confirmed')}
                    >
                      确认此项
                    </button>
                  )}
                  {status === 'confirmed' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={disabled}
                      onClick={() => decide(index, statement, 'pending')}
                    >
                      撤销确认
                    </button>
                  )}
                  {inferred && status !== 'rejected' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={disabled}
                      onClick={() => decide(index, statement, 'rejected')}
                    >
                      拒绝此项
                    </button>
                  )}
                  {status === 'rejected' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={disabled}
                      onClick={() => decide(index, statement, 'pending')}
                    >
                      重新审查
                    </button>
                  )}
                  <span className="creative-intent-confirm-note">
                    {status === 'confirmed'
                      ? '本次冻结会记录为作者确认。'
                      : status === 'rejected'
                        ? '该项会保留审计，但不会视为作者意图。'
                        : '待确认项不会被描述成作者已确认。'}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default CreativeIntentEditor;
