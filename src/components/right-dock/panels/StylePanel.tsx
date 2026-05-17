import { useState, useEffect } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { StyleProfile } from '../../../types/style';
import type { OutputProfile } from '../../../types/output';
import { styleProfileService } from '../../../services/styles/styleProfileService';
import { outputProfileService } from '../../../services/styles/outputProfileService';
import { formatNumber } from '../../../utils/format';

interface StylePanelProps {
  novelId?: string;
  chapter?: Chapter;
  onStyleChange?: (style: StyleProfile) => void;
  onOutputChange?: (output: OutputProfile) => void;
}

function StylePanel({ novelId, chapter, onStyleChange, onOutputChange }: StylePanelProps) {
  const [styles, setStyles] = useState<StyleProfile[]>([]);
  const [outputs, setOutputs] = useState<OutputProfile[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState('');
  const [selectedOutputId, setSelectedOutputId] = useState('');

  useEffect(() => {
    styleProfileService.getAll(novelId).then((list) => {
      setStyles(list);
      if (list.length > 0 && !selectedStyleId) {
        setSelectedStyleId(list[0].id);
        onStyleChange?.(list[0]);
      }
    });
    outputProfileService.getAll(novelId).then((list) => {
      setOutputs(list);
      const def = list.find((o) => o.isDefault) || list[0];
      if (def && !selectedOutputId) {
        setSelectedOutputId(def.id);
        onOutputChange?.(def);
      }
    });
  }, [novelId]);

  const selectedStyle = styles.find((s) => s.id === selectedStyleId);
  const selectedOutput = outputs.find((o) => o.id === selectedOutputId);

  const handleStyleSelect = (id: string) => {
    setSelectedStyleId(id);
    const s = styles.find((x) => x.id === id);
    if (s) onStyleChange?.(s);
  };

  const handleOutputSelect = (id: string) => {
    setSelectedOutputId(id);
    const o = outputs.find((x) => x.id === id);
    if (o) onOutputChange?.(o);
  };

  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">风格方案</div>
        <select className="panel-select" value={selectedStyleId} onChange={(e) => handleStyleSelect(e.target.value)}>
          {styles.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
        </select>
        {selectedStyle && (
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 8, lineHeight: 1.6 }}>
            {selectedStyle.narrativePerspective && <div>👁️ {selectedStyle.narrativePerspective}</div>}
            {selectedStyle.tone && <div>🎭 {selectedStyle.tone}</div>}
            {selectedStyle.pace && <div>⚡ {selectedStyle.pace}</div>}
            <div>💬 {Math.round(selectedStyle.dialogueRatio * 100)}% · 🖊️ {Math.round(selectedStyle.descriptionRatio * 100)}%</div>
          </div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">输出控制方案</div>
        <select className="panel-select" value={selectedOutputId} onChange={(e) => handleOutputSelect(e.target.value)}>
          {outputs.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
        </select>
        {selectedOutput && (
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 8, lineHeight: 1.6 }}>
            <div>📊 {formatNumber(selectedOutput.targetWordCount ?? selectedOutput.chapterWordRange.default)} 字</div>
            <div>⚡ {selectedOutput.paceLevel === 'fast' ? '快节奏' : selectedOutput.paceLevel === 'slow' ? '慢节奏' : '中等节奏'}</div>
            {chapter && <div style={{ marginTop: 4 }}>章节目标：{formatNumber(chapter.targetWordCount ?? 4000)} 字</div>}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 12 }}>
        前往 <a href="#/styles" style={{ color: 'var(--color-primary)' }}>风格方案管理</a> 查看更多
      </div>
    </div>
  );
}

export default StylePanel;
