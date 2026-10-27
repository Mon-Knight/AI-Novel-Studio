import type { WorldRuleDocument } from '../../types/worldRules';
import {
  WORLD_PARAMETER_DIRECTORY,
  WORLD_RULE_KIND_LABELS,
} from '../../services/worldRules/worldRuleSchema';
import { CHARACTER_BELIEF_HINT, WORLD_PARAMETER_EXAMPLES } from './worldRulePresentation';

export function RuleTextField({
  label,
  value,
  onChange,
  testId,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
  placeholder?: string;
}) {
  return (
    <label className="panel-field-label">
      {label}
      <textarea
        className="form-textarea detail-textarea detail-textarea--sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        placeholder={placeholder}
      />
    </label>
  );
}
const split = (value: string) => value.split('\n');
export default function WorldRuleFields({
  value: d,
  onChange,
  world,
}: {
  value: WorldRuleDocument;
  onChange: (value: WorldRuleDocument) => void;
  world: boolean;
}) {
  return (
    <div className="detail-form detail-form--tight">
      <p className="text-sm text-muted">
        先写清这条内容的性质、范围和限制/代价。其余按需补充；空着、未知或 N/A
        都可以保留，不会因此判为错误。切换性质不会清空已填内容。
      </p>
      <label className="panel-field-label">
        内容性质
        <select
          className="panel-select"
          data-testid="world-rule-kind"
          value={d.kind}
          onChange={(e) => onChange({ ...d, kind: e.target.value as WorldRuleDocument['kind'] })}
        >
          {Object.entries(WORLD_RULE_KIND_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {d.kind === 'character_belief' && (
        <p className="text-sm text-muted" data-testid="world-rule-belief-hint">
          {CHARACTER_BELIEF_HINT}
        </p>
      )}
      <label className="panel-field-label">
        强度
        <select
          className="panel-select"
          data-testid="world-rule-strength"
          value={d.strength}
          onChange={(e) =>
            onChange({ ...d, strength: e.target.value as WorldRuleDocument['strength'] })
          }
        >
          <option value="descriptive">描述，不自动作为禁止项</option>
          <option value="hard">硬约束（受性质与作用域限定）</option>
          <option value="soft">软偏好，不覆盖正式事实</option>
        </select>
      </label>
      <RuleTextField
        label="适用范围说明"
        testId="world-rule-scope"
        value={d.scope.summary}
        placeholder="例如：只约束普通民船；军用或特许航线另写"
        onChange={(v) => onChange({ ...d, scope: { ...d.scope, summary: v } })}
      />
      <RuleTextField
        label="生效条件（每行一项）"
        testId="world-rule-conditions"
        value={d.conditions.join('\n')}
        placeholder="例如：闸门关闭且潮位尚未进入通航区间"
        onChange={(v) => onChange({ ...d, conditions: split(v) })}
      />
      <RuleTextField
        label="限制与失效条件"
        testId="world-rule-limitations"
        value={d.boundaries.limitations}
        placeholder="例如：闸门故障或封港令发布后不再适用"
        onChange={(v) => onChange({ ...d, boundaries: { ...d.boundaries, limitations: v } })}
      />
      <RuleTextField
        label="代价与风险"
        testId="world-rule-cost"
        value={d.boundaries.cost}
        placeholder="例如：违令可通行，但须赔偿并接受调查"
        onChange={(v) => onChange({ ...d, boundaries: { ...d.boundaries, cost: v } })}
      />
      <RuleTextField
        label="上限/数量/单位/资源边界"
        testId="world-rule-ceiling"
        value={d.boundaries.ceiling}
        placeholder="例如：同一潮汐窗口最多放行三艘"
        onChange={(v) => onChange({ ...d, boundaries: { ...d.boundaries, ceiling: v } })}
      />
      {world && (
        <details>
          <summary>世界背景八类参数（按需展开）</summary>
          <p className="text-sm text-muted">
            现实、历史或科幻都可套用这些栏目；只写对当前故事有用的条目，不要搬用名著专有设定。
          </p>
          {WORLD_PARAMETER_DIRECTORY.map((p) => (
            <div key={p.key}>
              <RuleTextField
                label={p.label}
                testId={'world-parameter-' + p.key}
                value={d.worldParameters[p.key] ?? ''}
                placeholder={WORLD_PARAMETER_EXAMPLES[p.key]}
                onChange={(v) =>
                  onChange({ ...d, worldParameters: { ...d.worldParameters, [p.key]: v } })
                }
              />
              <p className="text-sm text-muted">{p.hint}</p>
            </div>
          ))}
        </details>
      )}
      <details>
        <summary data-testid="world-rule-group-world">世界中成立什么</summary>
        <p className="text-sm text-muted">
          这里写世界里实际生效的地点、群体与人物，不是角色听说或相信的版本。
        </p>
        {(
          [
            ['chapterIds', '限定章节 ID', '例如：只在开篇两章生效，可留空表示不限'],
            ['places', '地点', '例如：内河渡口；雨季土路'],
            ['groups', '组织/群体', '例如：港务人员；普通船户'],
            ['characters', '人物', '例如：当值调度员；不自动等于知情者'],
          ] as const
        ).map(([key, label, placeholder]) => (
          <RuleTextField
            key={key}
            label={label + '（每行一项）'}
            value={d.scope[key].join('\n')}
            placeholder={placeholder}
            onChange={(v) => onChange({ ...d, scope: { ...d.scope, [key]: split(v) } })}
          />
        ))}
      </details>
      <details>
        <summary data-testid="world-rule-timing-toggle">故事时间与读者揭示</summary>
        {(
          [
            [
              'effectiveFrom',
              '故事生效时间',
              'world-rule-effective-from',
              '例如：故事第一年秋季，不是章节编号',
            ],
            ['effectiveUntil', '故事失效时间', undefined, '例如：雨季结束；不适用可填 N/A'],
            ['revealAt', '读者揭示时点/章节', 'world-rule-reveal-at', '例如：第二章向读者揭示'],
          ] as const
        ).map(([key, label, testId, placeholder]) => (
          <RuleTextField
            key={key}
            label={label}
            testId={testId}
            placeholder={placeholder}
            value={d.chronology[key]}
            onChange={(v) => onChange({ ...d, chronology: { ...d.chronology, [key]: v } })}
          />
        ))}
      </details>
      <details>
        <summary data-testid="world-rule-knowledge-toggle">角色知道或相信什么</summary>
        <p className="text-sm text-muted">
          与上一项分开：即使世界事实已成立，角色仍可能不知道、误信或有争议。
        </p>
        {d.kind === 'character_belief' && (
          <p className="text-sm text-muted">{CHARACTER_BELIEF_HINT}</p>
        )}
        <label className="panel-field-label">
          认知状态
          <select
            className="panel-select"
            value={d.epistemic.status}
            onChange={(e) =>
              onChange({
                ...d,
                epistemic: {
                  ...d.epistemic,
                  status: e.target.value as WorldRuleDocument['epistemic']['status'],
                },
              })
            }
          >
            <option value="uncertain">未定</option>
            <option value="established">已知</option>
            <option value="disputed">争议</option>
            <option value="belief">角色相信</option>
          </select>
        </label>
        <RuleTextField
          label="知情角色（每行一项）"
          testId="world-rule-knowledge-known-by"
          value={d.epistemic.knownBy.join('\n')}
          placeholder="例如：当值船长知道潮汐表，乘客只听到今日停航"
          onChange={(v) => onChange({ ...d, epistemic: { ...d.epistemic, knownBy: split(v) } })}
        />
        <RuleTextField
          label="获知时点"
          value={d.epistemic.learnedAt}
          placeholder="例如：开航前一晚从调度口信得知"
          onChange={(v) => onChange({ ...d, epistemic: { ...d.epistemic, learnedAt: v } })}
        />
        <RuleTextField
          label="获知过程/证据"
          value={d.epistemic.evidence}
          placeholder="例如：亲眼见到告示；只是码头传闻"
          onChange={(v) => onChange({ ...d, epistemic: { ...d.epistemic, evidence: v } })}
        />
      </details>
      <details>
        <summary data-testid="world-rule-group-source">来源与依赖</summary>
        <p className="text-sm text-muted">
          来源：{d.provenance.origin}；身份：{d.identity.id}；修订：{d.identity.revision}。AI
          候选不会因设置“已知”自动获得作者确认。
        </p>
        <RuleTextField
          label="来源引用（采用章节/草稿/hash/段落/作者决定，每行一项）"
          value={d.provenance.sourceRefs.join('\n')}
          placeholder="例如：采用稿草稿 hash；作者在第 3 章确认"
          onChange={(v) =>
            onChange({ ...d, provenance: { ...d.provenance, sourceRefs: split(v) } })
          }
        />
        <RuleTextField
          label="依赖资产 ID（每行一项）"
          value={d.dependencies.join('\n')}
          placeholder="例如：本作品中另一条规则的 ID；跨作品引用会被阻断"
          onChange={(v) => onChange({ ...d, dependencies: split(v) })}
        />
      </details>
      <details>
        <summary data-testid="world-rule-exceptions-toggle">例外（单独审阅批准）</summary>
        {d.exceptions.map((exception, index) => (
          <div className="detail-list-item" key={index} data-exception-index={index}>
            <span className="text-sm text-muted">
              {exception.approval === 'author_approved' ? '既有作者批准' : '待作者批准'}
            </span>
            {(
              [
                ['condition', '例外条件与范围'],
                ['effect', '允许的变化'],
                ['reason', '批准理由'],
              ] as const
            ).map(([key, label]) => (
              <RuleTextField
                key={key}
                label={label}
                testId={'world-rule-exception-' + key}
                value={exception[key]}
                onChange={(v) =>
                  onChange({
                    ...d,
                    exceptions: d.exceptions.map((item, i) =>
                      i === index ? { ...item, [key]: v, approval: 'proposed' } : item,
                    ),
                  })
                }
              />
            ))}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                onChange({ ...d, exceptions: d.exceptions.filter((_, i) => i !== index) })
              }
            >
              移除此例外草案
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid="world-rule-exception-add"
          onClick={() =>
            onChange({
              ...d,
              exceptions: [
                ...d.exceptions,
                { condition: '', effect: '', approval: 'proposed', reason: '' },
              ],
            })
          }
        >
          新增例外草案
        </button>
      </details>
    </div>
  );
}
