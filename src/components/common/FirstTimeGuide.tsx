import { useState } from 'react';
import { BookOpenText, MessageSquareText, ShieldCheck, X } from 'lucide-react';
import '../../styles/first-time-guide.css';

const GUIDE_KEY = 'ai_novel_studio_guide_dismissed';

function FirstTimeGuide() {
  const [visible, setVisible] = useState(() => {
    try {
      return !localStorage.getItem(GUIDE_KEY);
    } catch {
      return true;
    }
  });
  const dismiss = () => {
    try {
      localStorage.setItem(GUIDE_KEY, '1');
    } catch {
      /* Help can still close for this session. */
    }
    setVisible(false);
  };

  if (!visible) {
    return (
      <button className="guide-reopen" type="button" onClick={() => setVisible(true)}>
        查看创作指南
      </button>
    );
  }

  return (
    <aside className="first-time-guide" data-testid="first-time-guide" aria-label="创作指南">
      <div className="guide-heading">
        <strong>从一个目标开始，逐章完成作品</strong>
        <button
          type="button"
          data-testid="first-time-guide-dismiss"
          aria-label="关闭首次使用指南"
          onClick={dismiss}
        >
          <X aria-hidden="true" size={18} strokeWidth={1.8} />
        </button>
      </div>
      <ol className="guide-steps">
        <li>
          <BookOpenText aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>创建或导入作品</span>
        </li>
        <li>
          <MessageSquareText aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>在创作工作台提出任务</span>
        </li>
        <li>
          <ShieldCheck aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>审阅候选，再显式保存与采用</span>
        </li>
      </ol>
      <details>
        <summary>查看完整创作流程</summary>
        <ol className="guide-full-steps">
          <li>创建作品，填写名称、题材和创意方向，也可导入已有作品。</li>
          <li>在作品详情整理世界、规则与主角；在任务中也可要求生成相关候选。</li>
          <li>建立分卷和章节，逐步完善大纲、角色与事件。</li>
          <li>进入创作工作台，选择作品、任务模型和目标章节，描述本次创作要求。</li>
          <li>检查候选内容与作用范围。结构化候选由显式应用进入正式资产。</li>
          <li>章节候选先确认进入审阅，按需显式编辑并保存草稿。</li>
          <li>审阅完成后采用为正式正文；保存草稿本身不等于采用。</li>
          <li>完成章节总结，沉淀上下文，再继续下一章。</li>
          <li>在作品详情或导入导出页导出作品，并定期备份。</li>
        </ol>
      </details>
    </aside>
  );
}

export default FirstTimeGuide;
