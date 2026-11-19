import { useRef, useState } from 'react';
import type { Chapter } from '../../types/chapter';
import type {
  IssueTaskAuthorizationInput,
  TaskAuthorizationAction,
  TaskAuthorizationBudget,
  TaskAuthorizationCreationScope,
} from '../../types/taskAuthorization';
import { TASK_AUTHORIZATION_ACTION_LABELS } from './taskAuthorizationPresentation';

export interface TaskAuthorizationFormProps {
  conversationId: string;
  novelId: string;
  sourceTurnId: string;
  chapters: Array<Pick<Chapter, 'id' | 'title' | 'chapterNumber'>>;
  activeChapterId?: string;
  disabled: boolean;
  onIssue: (input: IssueTaskAuthorizationInput) => Promise<unknown>;
}

const BUDGET_FIELDS: Array<{
  key: keyof TaskAuthorizationBudget;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'maxRequests', label: '最多模型请求数', min: 1, max: 10000, step: 1 },
  { key: 'maxToolCalls', label: '最多工具调用数', min: 1, max: 50000, step: 1 },
  { key: 'maxRevisions', label: '最多修订次数', min: 0, max: 200, step: 1 },
  { key: 'maxTokens', label: '最多 Token 总量', min: 1, max: 10000000, step: 1 },
  { key: 'maxCostUsd', label: '最高费用（美元）', min: 0.01, max: 10000, step: 0.01 },
];
const CREATION_FIELDS: Array<{
  key: keyof TaskAuthorizationCreationScope;
  label: string;
  min: number;
}> = [
  { key: 'firstVolumeIndex', label: '允许新建的起始卷序号', min: 1 },
  { key: 'lastVolumeIndex', label: '允许新建的结束卷序号', min: 1 },
  { key: 'maxNewVolumes', label: '最多新建卷数', min: 1 },
  { key: 'maxNewChapters', label: '最多新建章节数', min: 1 },
];

/** User-edited issuance spec only. Model identity, baselines and grant IDs come from native authority. */
export function WorkbenchTaskAuthorizationForm({
  conversationId,
  novelId,
  sourceTurnId,
  chapters,
  activeChapterId,
  disabled,
  onIssue,
}: TaskAuthorizationFormProps) {
  const [actions, setActions] = useState<TaskAuthorizationAction[]>([]);
  const [actionLimits, setActionLimits] = useState<Record<TaskAuthorizationAction, number>>({
    apply_planning: 1,
    adopt_chapter_text: 1,
    apply_summary: 1,
  });
  const [chapterIds, setChapterIds] = useState<string[]>(
    activeChapterId && chapters.some((chapter) => chapter.id === activeChapterId)
      ? [activeChapterId]
      : [],
  );
  const [allowNovelPlanning, setAllowNovelPlanning] = useState(false);
  const [allowCreation, setAllowCreation] = useState(false);
  const [creation, setCreation] = useState<TaskAuthorizationCreationScope>({
    firstVolumeIndex: 1,
    lastVolumeIndex: 1,
    maxNewVolumes: 1,
    maxNewChapters: 1,
  });
  const [maxWrites, setMaxWrites] = useState(1);
  const [minutes, setMinutes] = useState(30);
  const [wallMinutes, setWallMinutes] = useState(10);
  const [budget, setBudget] = useState<TaskAuthorizationBudget>({
    maxRequests: 8,
    maxToolCalls: 24,
    maxRevisions: 2,
    maxTokens: 32000,
    maxCostUsd: 1,
    maxWallClockMs: 600000,
  });
  const [error, setError] = useState('');
  const [issuing, setIssuing] = useState(false);
  const inFlight = useRef(false);
  const locked = disabled || issuing;
  const issue = async () => {
    if (locked || inFlight.current || !sourceTurnId || !conversationId || !novelId) return;
    const integer = (value: number, min = 1) => Number.isSafeInteger(value) && value >= min;
    const validBudget = BUDGET_FIELDS.every(
      (field) =>
        Number.isFinite(budget[field.key]) &&
        budget[field.key] >= field.min &&
        budget[field.key] <= field.max &&
        (field.step !== 1 || integer(budget[field.key], field.min)),
    );
    if (
      !actions.length ||
      !integer(maxWrites) ||
      maxWrites > 200 ||
      chapterIds.length > 200 ||
      !integer(minutes) ||
      minutes > 1440 ||
      !integer(wallMinutes) ||
      wallMinutes > 60 ||
      !validBudget ||
      actions.some((action) => !integer(actionLimits[action]) || actionLimits[action] > maxWrites)
    ) {
      setError('请选择至少一个动作，并填写有限的写入次数、预算和有效期（最多 1440 分钟）。');
      return;
    }
    if (!chapterIds.length && !allowCreation && !allowNovelPlanning) {
      setError('请选择明确的章节范围，或明确允许作品规划/有限新建范围。');
      return;
    }
    if (allowNovelPlanning && !actions.includes('apply_planning')) {
      setError('作品级规划范围仅能配合“自动应用规划”动作授权。');
      return;
    }
    if (
      allowCreation &&
      (!allowNovelPlanning ||
        !CREATION_FIELDS.every((field) => integer(creation[field.key], field.min)) ||
        creation.lastVolumeIndex < creation.firstVolumeIndex ||
        creation.lastVolumeIndex > 50 ||
        creation.maxNewVolumes > creation.lastVolumeIndex - creation.firstVolumeIndex + 1 ||
        creation.maxNewChapters > 200 ||
        !actions.includes('apply_planning'))
    ) {
      setError('新建权限需分别勾选规划动作和作品级规划范围，并明确合法的卷范围及新建数量。');
      return;
    }
    inFlight.current = true;
    setIssuing(true);
    setError('');
    try {
      const result = await onIssue({
        conversationId,
        novelId,
        sourceTurnId,
        chapterIds,
        allowNovelPlanning,
        ...(allowCreation ? { creationScope: creation } : {}),
        actions: actions.map((action) => ({ action, maxWrites: actionLimits[action] })),
        maxWrites,
        budget: { ...budget, maxWallClockMs: wallMinutes * 60000 },
        expiresAt: new Date(Date.now() + minutes * 60000).toISOString(),
      });
      if (result !== false) setActions([]);
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : '授权请求未完成'} 请重新读取权威授权记录，不会自动重签。`,
      );
    } finally {
      inFlight.current = false;
      setIssuing(false);
    }
  };
  return (
    <section aria-label="签发本任务有限预授权" className="resource-form">
      <p>
        <strong>仅授权本任务当前目标及其受控后续阶段。</strong>{' '}
        默认保留人工确认。新的独立目标需要重新授权；生成许可不等于采用许可，下面的动作分别授权，不包含修改世界规则或清理数据。
      </p>
      <fieldset disabled={locked}>
        <legend>允许自动执行的正式写入</legend>
        {(Object.keys(TASK_AUTHORIZATION_ACTION_LABELS) as TaskAuthorizationAction[]).map(
          (action) => (
            <div className="resource-field" key={action}>
              <label>
                <input
                  type="checkbox"
                  data-testid="workbench-task-authorization-action"
                  data-action={action}
                  checked={actions.includes(action)}
                  onChange={(event) =>
                    setActions((current) =>
                      event.target.checked
                        ? [...current, action]
                        : current.filter((item) => item !== action),
                    )
                  }
                />{' '}
                {TASK_AUTHORIZATION_ACTION_LABELS[action]}
              </label>
              <label>
                {TASK_AUTHORIZATION_ACTION_LABELS[action]}最多次数
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  step={1}
                  disabled={!actions.includes(action)}
                  value={actionLimits[action]}
                  onChange={(event) =>
                    setActionLimits((current) => ({
                      ...current,
                      [action]: event.target.valueAsNumber,
                    }))
                  }
                />
              </label>
            </div>
          ),
        )}
        <label>
          本次授权正式写入总上限
          <input
            className="form-input"
            type="number"
            min={1}
            step={1}
            value={maxWrites}
            onChange={(event) => setMaxWrites(event.target.valueAsNumber)}
          />
        </label>
      </fieldset>
      <fieldset disabled={locked}>
        <legend>本作品内的明确目标范围</legend>
        <label>
          允许的已有章节（按 Ctrl 或 Shift 多选）
          <select
            className="form-input"
            multiple
            size={Math.min(6, Math.max(2, chapters.length))}
            value={chapterIds}
            onChange={(event) =>
              setChapterIds(Array.from(event.target.selectedOptions, (option) => option.value))
            }
          >
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                第{chapter.chapterNumber}章 · {chapter.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={allowNovelPlanning}
            onChange={(event) => setAllowNovelPlanning(event.target.checked)}
          />{' '}
          允许作品级规划（不扩大正文或总结范围）
        </label>
        <label>
          <input
            type="checkbox"
            checked={allowCreation}
            onChange={(event) => setAllowCreation(event.target.checked)}
          />{' '}
          允许在明确卷范围内有限新建章节
        </label>
        {allowCreation && (
          <div className="resource-form-grid">
            {CREATION_FIELDS.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  className="form-input"
                  type="number"
                  min={field.min}
                  step={1}
                  value={creation[field.key]}
                  onChange={(event) =>
                    setCreation((current) => ({
                      ...current,
                      [field.key]: event.target.valueAsNumber,
                    }))
                  }
                />
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <details>
        <summary>查看并设置有限执行预算和有效期</summary>
        <fieldset disabled={locked} className="resource-form-grid">
          <legend>任务及其所有子任务共享预算</legend>
          {BUDGET_FIELDS.map((field) => (
            <label key={field.key}>
              {field.label}
              <input
                className="form-input"
                type="number"
                min={field.min}
                max={field.max}
                step={field.step}
                value={budget[field.key]}
                onChange={(event) =>
                  setBudget((current) => ({ ...current, [field.key]: event.target.valueAsNumber }))
                }
              />
            </label>
          ))}
          <label>
            最长执行时长（分钟）
            <input
              className="form-input"
              type="number"
              min={1}
              step={1}
              value={wallMinutes}
              onChange={(event) => setWallMinutes(event.target.valueAsNumber)}
            />
          </label>
          <label>
            授权有效期（分钟）
            <input
              className="form-input"
              type="number"
              min={1}
              max={1440}
              step={1}
              value={minutes}
              onChange={(event) => setMinutes(event.target.valueAsNumber)}
            />
          </label>
        </fieldset>
      </details>
      <p>
        授权绑定当前任务的执行模型及基线；模型变更、目标版本冲突、预算耗尽或具体人工审阅要求会停止自动应用。预授权不等于作者已审阅，也不证明内容语义正确。
      </p>
      {!sourceTurnId && <p role="status">请先提交明确的任务目标，再签发与该目标绑定的预授权。</p>}
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className="btn btn-primary"
        data-testid="workbench-task-authorization-issue"
        disabled={locked || !sourceTurnId || !actions.length}
        onClick={() => void issue()}
      >
        {issuing ? '正在签发…' : '签发本任务有限预授权'}
      </button>
    </section>
  );
}
