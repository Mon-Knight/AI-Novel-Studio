import type { ChapterSummary } from '../../types/chapterSummary';
import { formatDateTime } from '../../utils/date';

/** Read-only context details remain available when generation moves into its source task. */
export function ChapterSummaryDetails({ summary }: { summary: ChapterSummary }) {
  const lists: Array<[string, string[] | undefined]> = [
    ['关键事件', summary.keyEvents],
    ['核心事件', summary.coreEvents],
    ['设定变化', summary.settingChanges],
    ['新地点', summary.newLocations],
    ['新物品与能力', summary.newItemsOrAbilities],
    ['新增伏笔', summary.newForeshadows],
    ['已回收伏笔', summary.resolvedForeshadows],
    ['伏笔记录', summary.foreshadowing],
    ['未解问题', summary.unresolvedQuestions],
    ['需记住的事实', summary.factsMustRemember],
  ];
  const validation = summary.validationResult;
  return (
    <div data-testid="chapter-summary-details">
      <div className="panel-section">
        <h4 className="panel-section-title">章节摘要</h4>
        <p style={{ whiteSpace: 'pre-wrap' }}>{summary.summary}</p>
      </div>
      {lists.map(([label, items]) =>
        items?.length ? (
          <div className="panel-section" key={label}>
            <h4 className="panel-section-title">{label}</h4>
            <ul>
              {items.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {summary.protagonistStateChange && (
        <div className="panel-section">
          <h4 className="panel-section-title">主角状态变化</h4>
          <p>{summary.protagonistStateChange}</p>
        </div>
      )}
      {summary.importantCharacterChanges?.length ? (
        <div className="panel-section">
          <h4 className="panel-section-title">重要人物变化</h4>
          <ul>
            {summary.importantCharacterChanges.map((item, index) => (
              <li key={index}>
                {item.name}：{item.change}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {Array.isArray(summary.characterChanges) && summary.characterChanges.length > 0 && (
        <div className="panel-section">
          <h4 className="panel-section-title">人物状态</h4>
          <ul>
            {summary.characterChanges.map((item, index) => (
              <li key={index}>
                {item.characterName}：
                {[
                  item.stateSummary,
                  item.relationshipChanges,
                  item.goalChanges,
                  item.location,
                  item.healthState,
                  item.knowledgeState,
                ]
                  .filter(Boolean)
                  .join('；')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(summary.relationshipChanges) && summary.relationshipChanges.length > 0 && (
        <div className="panel-section">
          <h4 className="panel-section-title">人物关系变化</h4>
          <ul>
            {summary.relationshipChanges.map((item, index) => (
              <li key={index}>
                {item.fromCharacterName}与{item.toCharacterName}：{item.change}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(summary.nextChapterHints || summary.nextChapterHook) && (
        <div className="panel-section">
          <h4 className="panel-section-title">下一章衔接建议</h4>
          <p>{summary.nextChapterHints}</p>
          <p>{summary.nextChapterHook}</p>
        </div>
      )}
      {validation && (
        <div className="panel-section">
          <h4 className="panel-section-title">审阅与校验</h4>
          <p>
            {validation.authorReviewed
              ? '作者已审阅，语义未自动核实'
              : '自动校验结果仅供参考，事实仍需对照正式稿审阅'}
          </p>
          <ul>
            {validation.problems.map((item, index) => (
              <li key={index}>{item.message}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="panel-section">创建于：{formatDateTime(summary.createdAt)}</p>
    </div>
  );
}
