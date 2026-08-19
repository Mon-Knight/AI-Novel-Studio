import type { ScenePlanItem } from '../../../types/chapterEngineering';
import { ListField, TextField } from './ChapterEngineeringFields';

interface ChapterEngineeringScenePlanViewProps {
  scenePlan: ScenePlanItem[];
  scenePlanRunning: boolean;
  scenePlanCandidate: ScenePlanItem[] | null;
  busy: boolean;
  loading: boolean;
  compiling: boolean;
  jobRunning: boolean;
  draftRunning: boolean;
  updateScene: <K extends keyof ScenePlanItem>(id: string, key: K, value: ScenePlanItem[K]) => void;
  updateSceneBeats: (id: string, values: string[]) => void;
  addScene: () => void;
  removeScene: (id: string) => void;
  onGenerateCandidate: () => Promise<void>;
  onSaveCandidate: (apply: boolean) => Promise<void>;
}

export function ChapterEngineeringScenePlanView({
  scenePlan,
  scenePlanRunning,
  scenePlanCandidate,
  busy,
  loading,
  compiling,
  jobRunning,
  draftRunning,
  updateScene,
  updateSceneBeats,
  addScene,
  removeScene,
  onGenerateCandidate,
  onSaveCandidate,
}: ChapterEngineeringScenePlanViewProps) {
  return (
    <div className="panel-section">
      <div
        className="panel-section-title"
        style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}
      >
        <span>Scene / Beat Plan</span>
        <button
          type="button"
          className="engineering-link-btn"
          disabled={busy || loading || compiling || scenePlanRunning || jobRunning || draftRunning}
          onClick={onGenerateCandidate}
          data-testid="scene-plan-generate"
        >
          {scenePlanRunning ? '生成中...' : 'AI 生成候选'}
        </button>
      </div>
      <div className="engineering-help-text">
        候选只进入本地待确认区；保存或应用前不会修改章节工程状态。规划使用全局
        Provider，正文生成再按 Beat 串行使用本地模型；每个 Beat 是一次独立调用。
      </div>
      {scenePlanCandidate && (
        <div className="engineering-candidate-card" data-testid="scene-plan-candidate">
          <strong>待确认候选：{scenePlanCandidate.length} 个 Scene</strong>
          {scenePlanCandidate.map((scene) => (
            <div className="engineering-step-row" key={`candidate-${scene.id}`}>
              <div>
                <strong>
                  {scene.sceneNo}. {scene.title || '未命名场景'}
                </strong>
              </div>
              <small>{scene.goal || '未填写场景目标'}</small>
              <small>Beat：{scene.beats.map((beat) => beat.text).join('；')}</small>
            </div>
          ))}
          <div className="engineering-actions">
            <button
              type="button"
              className="panel-btn panel-btn-secondary"
              disabled={busy}
              onClick={() => onSaveCandidate(false)}
            >
              保存候选草稿
            </button>
            <button
              type="button"
              className="panel-btn panel-btn-primary"
              disabled={busy}
              onClick={() => onSaveCandidate(true)}
            >
              保存并应用候选
            </button>
          </div>
        </div>
      )}
      {scenePlan.map((scene) => (
        <div className="engineering-scene" key={scene.id}>
          <div className="engineering-scene-header">
            <strong>场景 {scene.sceneNo}</strong>
            <button
              type="button"
              className="engineering-link-btn"
              onClick={() => removeScene(scene.id)}
            >
              删除
            </button>
          </div>
          <TextField
            label="场景标题"
            value={scene.title}
            onChange={(value) => updateScene(scene.id, 'title', value)}
          />
          <TextField
            label="场景状态胶囊"
            value={scene.contextCapsule ?? ''}
            onChange={(value) => updateScene(scene.id, 'contextCapsule', value)}
            multiline
          />
          <TextField
            label="地点"
            value={scene.location}
            onChange={(value) => updateScene(scene.id, 'location', value)}
          />
          <ListField
            label="角色"
            value={scene.characters}
            onChange={(value) => updateScene(scene.id, 'characters', value)}
            rows={3}
          />
          <TextField
            label="目标"
            value={scene.goal}
            onChange={(value) => updateScene(scene.id, 'goal', value)}
            multiline
          />
          <TextField
            label="冲突"
            value={scene.conflict}
            onChange={(value) => updateScene(scene.id, 'conflict', value)}
            multiline
          />
          <ListField
            label="关键动作"
            value={scene.keyActions}
            onChange={(value) => updateScene(scene.id, 'keyActions', value)}
          />
          <ListField
            label="有序节拍（每行一项）"
            value={scene.beats.map((beat) => beat.text)}
            onChange={(value) => updateSceneBeats(scene.id, value)}
            rows={4}
          />
          <TextField
            label="关键对白"
            value={scene.keyDialogue}
            onChange={(value) => updateScene(scene.id, 'keyDialogue', value)}
            multiline
          />
          <ListField
            label="释放信息"
            value={scene.informationRelease}
            onChange={(value) => updateScene(scene.id, 'informationRelease', value)}
          />
          <TextField
            label="结果"
            value={scene.result}
            onChange={(value) => updateScene(scene.id, 'result', value)}
            multiline
          />
          <ListField
            label="场景限制"
            value={scene.constraints ?? []}
            onChange={(value) => updateScene(scene.id, 'constraints', value)}
          />
          <TextField
            label="预期结束状态"
            value={scene.expectedEndState ?? ''}
            onChange={(value) => updateScene(scene.id, 'expectedEndState', value)}
            multiline
          />
          <TextField
            label="转场"
            value={scene.transition}
            onChange={(value) => updateScene(scene.id, 'transition', value)}
            multiline
          />
        </div>
      ))}
      <button type="button" className="panel-btn panel-btn-secondary" onClick={addScene}>
        新增场景
      </button>
    </div>
  );
}
