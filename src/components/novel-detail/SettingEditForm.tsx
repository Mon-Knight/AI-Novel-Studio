import { useEffect, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import type {
  RuleCategory,
  RuleSystem,
  SaveRuleSystemInput,
  WorldSetting,
} from '../../types/setting';
import { RuleCategoryLabels } from '../../types/setting';
import type {
  WorldRuleChange,
  WorldRuleChangeImpact,
  WorldRuleChangeIntent,
  WorldRuleDocument,
} from '../../types/worldRules';
import { createUniqueId } from '../../utils/uniqueId';
import {
  createWorldRuleDocument,
  parseWorldRuleDocument,
  proposeConfirmedWorldRule,
  serializeWorldRuleDocument,
} from '../../services/worldRules/worldRuleSchema';
import WorldRuleFields from './WorldRuleFields';
import RuleChangeReview from './RuleChangeReview';

export type SettingEditInput = Omit<SaveRuleSystemInput, 'novelId'>;
interface Props {
  source?: WorldSetting | RuleSystem;
  world: boolean;
  hidden?: boolean;
  onClose: () => void;
  onSave: (data: SettingEditInput) => Promise<void>;
  onPreview: (change: WorldRuleChange) => Promise<WorldRuleChangeImpact>;
}
function initialDocument(source: Props['source'], world: boolean): WorldRuleDocument | null {
  const parsed = parseWorldRuleDocument(source?.structuredJson);
  if (parsed.status === 'valid') return parsed.document;
  if (parsed.status !== 'absent') return null;
  return createWorldRuleDocument(
    source?.id ?? createUniqueId(),
    source?.content ?? '',
    world ? 'world_fact' : 'causal_rule',
  );
}

/** Hiding the form retains its local draft. No Escape handler intercepts IME composition. */
export default function SettingEditForm({
  source,
  world,
  hidden,
  onClose,
  onSave,
  onPreview,
}: Props) {
  const [baseline, setBaseline] = useState(source);
  const [title, setTitle] = useState(source?.title ?? (world ? '默认世界设定' : ''));
  const [content, setContent] = useState(source?.content ?? '');
  const [isActive, setIsActive] = useState(source?.isActive ?? true);
  const [category, setCategory] = useState<RuleCategory | ''>(
    (source as RuleSystem | undefined)?.category ?? '',
  );
  const [forbiddenRules, setForbiddenRules] = useState(
    (source as RuleSystem | undefined)?.forbiddenRules ?? '',
  );
  const [metadata, setMetadata] = useState(() => initialDocument(source, world));
  const [dirty, setDirty] = useState(false);
  const [intent, setIntent] = useState<WorldRuleChangeIntent>('confirm_change');
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [impact, setImpact] = useState<WorldRuleChangeImpact>();
  const [payload, setPayload] = useState<WorldRuleChange>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef(0);
  const mounted = useRef(true);
  const form = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, []);
  useEffect(() => {
    if (dirty || source === baseline) return;
    setBaseline(source);
    setTitle(source?.title ?? (world ? '默认世界设定' : ''));
    setContent(source?.content ?? '');
    setIsActive(source?.isActive ?? true);
    setCategory((source as RuleSystem | undefined)?.category ?? '');
    setForbiddenRules((source as RuleSystem | undefined)?.forbiddenRules ?? '');
    setMetadata(initialDocument(source, world));
    setImpact(undefined);
    setPayload(undefined);
    setConfirmed(false);
  }, [source, baseline, dirty, world]);
  useEffect(() => {
    if (!hidden)
      form.current?.querySelector<HTMLInputElement>('input[data-testid="setting-title"]')?.focus();
  }, [hidden]);
  const invalidate = () => {
    request.current += 1;
    setDirty(true);
    setImpact(undefined);
    setPayload(undefined);
    setConfirmed(false);
    setMessage('');
  };
  const close = () => {
    request.current += 1;
    setBusy(false);
    setImpact(undefined);
    setPayload(undefined);
    setConfirmed(false);
    onClose();
  };
  const buildChange = (): WorldRuleChange => {
    if (!title.trim() || !content.trim())
      throw new Error('名称与内容不能为空；其他参数可留待后续补充。');
    const previous = parseWorldRuleDocument(baseline?.structuredJson);
    const document = metadata
      ? proposeConfirmedWorldRule(
          { ...metadata, statement: content },
          previous.status === 'valid' ? previous.document : undefined,
        )
      : undefined;
    if (document && intent === 'approve_exception') {
      if (
        !document.exceptions.length ||
        document.exceptions.some((e) => !e.condition.trim() || !e.effect.trim() || !e.reason.trim())
      )
        throw new Error('批准例外前请填写明确条件、范围、变化与理由。');
      document.exceptions = document.exceptions.map((exception) => ({
        ...exception,
        approval: 'author_approved',
      }));
    }
    return {
      targetType: world ? 'world_setting' : 'rule_system',
      targetId: baseline?.id,
      title: title.trim(),
      content,
      category: world ? undefined : category || undefined,
      forbiddenRules: world ? undefined : forbiddenRules || undefined,
      structuredJson: document ? serializeWorldRuleDocument(document) : baseline?.structuredJson,
      isActive,
    };
  };
  const preview = async () => {
    const token = ++request.current;
    setBusy(true);
    setConfirmed(false);
    setMessage('');
    setImpact(undefined);
    setPayload(undefined);
    try {
      if (intent !== 'confirm_change' && !notes.trim())
        throw new Error('修订正史或批准例外必须说明理由。');
      const change = buildChange();
      const result = await onPreview(change);
      if (!mounted.current || token !== request.current) return;
      setImpact(result);
      setPayload(change);
    } catch (error) {
      if (mounted.current && token === request.current)
        setMessage(error instanceof Error ? error.message : '影响预览失败；未保存');
    } finally {
      if (mounted.current && token === request.current) setBusy(false);
    }
  };
  const save = async () => {
    if (!confirmed || !impact || !payload || busy || impact.blockingConflicts.length) return;
    setBusy(true);
    setMessage('');
    try {
      await onSave({
        title: payload.title,
        content: payload.content,
        category: payload.category as RuleCategory | undefined,
        forbiddenRules: payload.forbiddenRules,
        structuredJson: payload.structuredJson,
        isActive: payload.isActive,
        expectedUpdatedAt: baseline?.updatedAt,
        expectedRuleSetFingerprint: impact.ruleSetFingerprint,
        changeAuthorization: {
          previewHash: impact.previewHash,
          intent,
          notes: notes.trim() || undefined,
        },
      });
      if (!mounted.current) return;
      setDirty(false);
      setImpact(undefined);
      setPayload(undefined);
      setConfirmed(false);
      setMessage('保存成功');
      if (!source) {
        setTitle(world ? '默认世界设定' : '');
        setContent('');
        setForbiddenRules('');
        setMetadata(initialDocument(undefined, world));
      }
      onClose();
    } catch (error) {
      if (mounted.current) {
        setMessage(error instanceof Error ? error.message : '保存失败，草稿已保留');
        setImpact(undefined);
        setPayload(undefined);
        setConfirmed(false);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const stale = source?.updatedAt !== baseline?.updatedAt;
  return (
    <div
      ref={form}
      hidden={hidden}
      data-testid={'setting-editor-' + (world ? 'world-' : 'rule-') + (source?.id ?? 'new')}
    >
      <fieldset disabled={busy} className="detail-form detail-form--tight">
        <label className="panel-field-label">
          {world ? '设定标题' : '规则名称'}
          <input
            data-testid="setting-title"
            className="form-input detail-fill"
            value={title}
            placeholder={world ? '例如：港口供水安排' : '例如：夜间通行限制'}
            onChange={(e) => {
              invalidate();
              setTitle(e.target.value);
            }}
          />
        </label>
        {!world && (
          <label className="panel-field-label">
            题材类别
            <select
              className="panel-select"
              value={category}
              onChange={(e) => {
                invalidate();
                setCategory(e.target.value as RuleCategory | '');
              }}
            >
              <option value="">不限</option>
              {Object.entries(RuleCategoryLabels).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="panel-field-label">
          {world ? '世界背景' : '规则内容'}
          <textarea
            data-testid="setting-content"
            className="form-textarea detail-textarea detail-textarea--xl"
            value={content}
            placeholder="可用一句话写下这条设定，也可以写成长文；不必一次填完。"
            onChange={(e) => {
              invalidate();
              setContent(e.target.value);
            }}
          />
        </label>
        {!world && (
          <label className="panel-field-label">
            禁止项（注明适用性质）
            <textarea
              data-testid="setting-forbidden-rules"
              className="form-textarea detail-textarea detail-textarea--sm"
              value={forbiddenRules}
              onChange={(e) => {
                invalidate();
                setForbiddenRules(e.target.value);
              }}
            />
          </label>
        )}
        {metadata ? (
          <WorldRuleFields
            world={world}
            value={metadata}
            onChange={(value) => {
              invalidate();
              setMetadata(value);
            }}
          />
        ) : (
          <p role="status">
            {parseWorldRuleDocument(baseline?.structuredJson).status !== 'valid'
              ? '既有JSON采用旧格式或当前不支持；将原样保留，不覆盖。可继续编辑正文。'
              : ''}
          </p>
        )}
        {stale && (
          <div role="alert">
            <p>资产已由其他操作更新。本地草稿保留；请先对照当前正式版本，重新预览后才能覆盖。</p>
            <details>
              <summary>查看当前正式版本</summary>
              <pre className="detail-fact-text detail-fact-text--pre">{source?.content}</pre>
            </details>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              data-testid="setting-rebase-draft"
              onClick={() => {
                invalidate();
                setBaseline(source);
              }}
            >
              已对照当前版本，保留本地修改并更新基线
            </button>
          </div>
        )}
        <label className="panel-field-label">
          <input
            type="checkbox"
            data-testid="setting-active"
            checked={isActive}
            onChange={(e) => {
              invalidate();
              setIsActive(e.target.checked);
            }}
          />
          启用此条（停用也需预览影响，不删除来源）
        </label>
        <RuleChangeReview
          impact={impact}
          change={payload}
          intent={intent}
          notes={notes}
          confirmed={confirmed}
          onIntent={(value) => {
            invalidate();
            setIntent(value);
          }}
          onNotes={(value) => {
            invalidate();
            setNotes(value);
          }}
          onConfirm={setConfirmed}
        />
        {message && (
          <p role="status" data-testid="setting-editor-message">
            {message}
          </p>
        )}
        <div className="detail-form-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-testid="setting-close"
            onClick={close}
          >
            收起（保留未保存内容）
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-testid="setting-impact-preview"
            onClick={preview}
          >
            预览变更影响
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-testid="setting-save"
            disabled={!confirmed || !impact || !!impact.blockingConflicts.length || stale}
            onClick={save}
          >
            <Save aria-hidden="true" size={14} strokeWidth={1.8} />
            确认并保存
          </button>
        </div>
      </fieldset>
      {busy && <p role="status">正在处理，请勿重复保存；未改变当前草稿。</p>}
    </div>
  );
}
