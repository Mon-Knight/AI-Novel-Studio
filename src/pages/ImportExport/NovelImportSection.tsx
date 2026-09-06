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
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 12,
      }}
    >
      <div
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          padding: 20,
          background: 'var(--color-bg-card)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontWeight: 600,
                fontSize: 16,
              }}
            >
              <FileText aria-hidden="true" size={20} strokeWidth={1.8} />
              <span>TXT 小说文本导入</span>
            </div>
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 10,
                background: 'var(--color-primary-light)',
                color: 'var(--color-primary)',
                fontWeight: 500,
              }}
            >
              智能分章
            </span>
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              marginTop: 10,
              lineHeight: 1.6,
            }}
          >
            支持加载整本 TXT
            纯文本小说，根据「第X章/卷」等常用章节标题格式自动分卷分章并导入作品库。
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ width: '100%' }}
            onClick={onOpenTxt}
          >
            <Upload aria-hidden="true" size={15} strokeWidth={1.8} />
            打开 TXT 导入向导
          </button>
        </div>
      </div>

      <div
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          padding: 20,
          background: 'var(--color-bg-card)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontWeight: 600,
                fontSize: 16,
              }}
            >
              <FileJson aria-hidden="true" size={20} strokeWidth={1.8} />
              <span>JSON 资产与配置导入</span>
            </div>
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 10,
                background: 'var(--color-bg-hover)',
                color: 'var(--color-text-secondary)',
              }}
            >
              结构化配置
            </span>
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              marginTop: 10,
              lineHeight: 1.6,
            }}
          >
            支持导入风格画像方案、输出控制方案以及全量项目备份 JSON 数据，无缝合并至本地创作库。
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-testid="project-import-json"
            style={{ width: '100%' }}
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
