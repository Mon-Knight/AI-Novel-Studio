import type { CharacterProfileEditorController } from '../../features/characters/useCharacterProfileEditor';
import { CharacterRoleLabels } from '../../types/character';
import { hasProtagonistBinding } from '../../services/characters/characterProfile';
import { ModalFrame } from '../common/ModalFrame';
import { CHARACTER_TEXT_FIELDS, CharacterProfileFields } from './CharacterProfileFields';

export function CharacterProfileEditor({ editor }: { editor: CharacterProfileEditorController }) {
  const state = editor.state;
  if (!state) return null;
  return (
    <ModalFrame
      title={`编辑角色 · ${state.baseline.name}`}
      maxWidth={660}
      onDismiss={editor.close}
      busy={state.busy}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={state.busy}
            onClick={editor.close}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={state.busy || state.conflicted || !state.values.name.trim()}
            onClick={() => void editor.save()}
          >
            {state.busy ? '处理中…' : '保存角色'}
          </button>
        </>
      }
    >
      <p className="detail-card-desc">修改当前作品的角色档案；主角设定和已采用正文需分别核对。</p>
      <CharacterProfileFields
        values={state.values}
        onChange={editor.change}
        disabled={state.busy}
        roleLocked={hasProtagonistBinding(state.baseline)}
      />
      {state.error && (
        <p role="alert" className="detail-text-error">
          {state.error}
        </p>
      )}
      {state.conflicted && (
        <div className="detail-gap-top">
          <p>输入已保留。刷新并核对正式版本，再确认以最新版本为基础保存。</p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={state.busy}
            onClick={() => void editor.refresh()}
          >
            刷新正式版本（保留输入）
          </button>
        </div>
      )}
      {state.latest && (
        <section className="detail-list-item detail-gap-top" aria-label="最新正式人物档案">
          <h3>最新正式版本</h3>
          <dl>
            <dt>角色名称</dt>
            <dd>{state.latest.name}</dd>
            <dt>角色类型</dt>
            <dd>{state.latest.roleType ? CharacterRoleLabels[state.latest.roleType] : '未分类'}</dd>
            {CHARACTER_TEXT_FIELDS.map((field) => (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{state.latest?.[field.key] || '未填写'}</dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={state.busy}
            onClick={editor.useLatest}
          >
            已核对，使用最新基线（保留输入）
          </button>
        </section>
      )}
    </ModalFrame>
  );
}
