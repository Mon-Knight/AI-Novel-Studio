import type { Chapter } from '../../../types/chapter';

interface CharactersPanelProps {
  novelId?: string;
  chapter?: Chapter;
}

function CharactersPanel({ novelId, chapter }: CharactersPanelProps) {
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">本章出场角色</div>
        <div className="character-item">
          <div className="character-avatar">林</div>
          <div className="character-info">
            <div className="character-name">林远</div>
            <div className="character-role">主角 · 航天工程师</div>
          </div>
        </div>
        <div className="character-item">
          <div className="character-avatar">艾</div>
          <div className="character-info">
            <div className="character-name">艾琳(E-247)</div>
            <div className="character-role">配角 · 适应指导员</div>
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">已生成角色（角色库）</div>
        <div className="text-sm text-muted" style={{ textAlign: 'center', padding: 16 }}>
          角色库与 AI 候选角色将在 v0.7.0 接入
        </div>
      </div>
    </div>
  );
}

export default CharactersPanel;
