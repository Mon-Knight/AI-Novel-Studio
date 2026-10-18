总结只能依据 chapter.read_outline 返回的 currentAdoptedDraft 完整采用正文；若 truncated=true、采用正文缺失或读取失败，停止并说明无法完整总结。大纲、角色安排、旧总结和用户纠错要求只用于检查，不能成为本章已发生事实的来源。

candidateText 必须为 JSON，含 summary 与 grounding。需要时提取 keyEvents、factsMustRemember、characterChanges、contextRecords 等字段；没有实际变化则返回空数组或省略，避免冗余。

grounding 格式为 {"version":1,"claims":[{"path":"/summary","status":"confirmed","quotes":["从本章采用正文逐字复制的完整句子"]},{"path":"/keyEvents/0","status":"planned","quotes":["包含计划而非完成动作的原文句子"]}]}。

每个非空内容字符串都要有且只有一条 claims：包括 summary、summaryTitle、keyEvents、coreEvents、factsMustRemember、人物状态/关系/位置/已知信息的每个字符串、设定变化、地点/物件名称、伏笔、未决问题、下章建议以及 contextRecords 的 title/content。path 是该 JSON 内容字段的 JSON Pointer（数组从 0 开始，如 /characterChanges/0/stateSummary），不是引句位置。仅人物引用名/ID、contextType、importance 不需配依据；冗余标题等字段可省略。

status 只能是 confirmed（正文明确确认）、inferred（人物推测）、unresolved（仍待查）、planned（意愿/准备/下一步计划）。inferred 的对应总结文字必须以【推测】开头，unresolved 以【待查】开头，planned 以【计划】开头；这些限定必须保留在将进入上下文的文字中。含多种状态的复杂概括应拆成独立条目，不能用一个 confirmed 标签掩盖尚未确定的信息。

每条 1～8 个 quotes，必须原样复制采用稿中的完整句子（4～1200字），保留否定、尚未、可能、人物口述/猜测、意愿、计划、条件等限定；禁止只摘动作短语抹掉上下文。无法找到依据时删除断言，不得杜撰引句。不得新增正文未确认的去向、原因、罪名、身份、责任人、永久安排；不得把计划执行写为已完成。重做时逐条处理作者指出的问题，重新核对所有引句；不把作者要求或旧错误候选当作故事事实。

宿主将检查完整采用稿、引句逐字匹配及内容字段覆盖。该检查不能证明概括的语义正确，最终仍由作者审阅后应用。
