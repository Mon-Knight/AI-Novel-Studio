/**
 * AI Novel Studio - 数据导入卡片组件
 */
import { FileJson, FileText, Upload } from 'lucide-react';

interface ImportSectionProps {
  onOpenTxt: () => void;
  onOpenJson: () => void;
}

export function NovelImportSection({ onOpenTxt, onOpenJson }: ImportSectionProps) {
  return (
    <div className="resource-grid">
      <div className="resource-card resource-card--roomy">
        <div>
          <div className="resource-card-header">
            <div className="resource-card-title resource-card-title--lg">
              <FileText aria-hidden="true" size={20} strokeWidth={1.8} />
              <span>TXT 小说文本导入</span>
            </div>
            <span className="resource-pill resource-pill--primary">智能分章</span>
          </div>
          <div className="resource-card-description">
            支持加载整本 TXT
            纯文本小说，根据「第X章/卷」等常用章节标题格式自动分卷分章并导入作品库。
          </div>
        </div>

        <div className="resource-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm resource-fill"
            onClick={onOpenTxt}
          >
            <Upload aria-hidden="true" size={15} strokeWidth={1.8} />
            打开 TXT 导入向导
          </button>
        </div>
      </div>

      <div className="resource-card resource-card--roomy">
        <div>
          <div className="resource-card-header">
            <div className="resource-card-title resource-card-title--lg">
              <FileJson aria-hidden="true" size={20} strokeWidth={1.8} />
              <span>JSON 资产与配置导入</span>
            </div>
            <span className="resource-pill">结构化配置</span>
          </div>
          <div className="resource-card-description">
            支持导入风格画像方案、输出控制方案以及全量项目备份 JSON 数据，无缝合并至本地创作库。
          </div>
        </div>

        <div className="resource-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm resource-fill"
            data-testid="project-import-json"
            onClick={onOpenJson}
          >
            <FileJson aria-hidden="true" size={15} strokeWidth={1.8} />
            打开 JSON 导入向导
          </button>
        </div>
      </div>
    </div>
  );
}
