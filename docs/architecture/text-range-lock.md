# Text Range Lock 架构冻结

> 实施版本：v2.4.0
>
> v2.3.0 不提供选区写入；只允许整章结果生成候选草稿。

## 1. 模型

~~~ts
interface TextRangeLock {
  lockId: string;
  novelId: string;
  chapterId: string;
  draftId: string;
  draftVersion: number;
  baseContentHash: string;
  selectionStart: number;
  selectionEnd: number;
  selectedContentHash: string;
  prefixAnchorHash?: string;
  suffixAnchorHash?: string;
  indexEncoding: 'utf16_code_unit';
  anchorWindow: number;
  createdAt: string;
}
~~~

锁创建后不可变，并由 ApplyPlan operation 引用。锁定的是“某一草稿版本中的某一段精确内容”，不是编辑器当前光标。

## 2. 索引语义

selectionStart/selectionEnd 统一采用 UTF-16 code unit，区间为半开 [start, end)。原因是 React/DOM textarea 的 selectionStart/selectionEnd 原生使用此语义，前端可无损捕获。

Rust 必须实现显式 UTF-16 边界转换函数，不能把该索引直接当 UTF-8 byte offset 或 Rust char 索引：

- CJK BMP 字符通常占 1 个 UTF-16 code unit；
- Emoji 等补充平面字符占 2 个 surrogate code units；
- 组合字符（例如字母+重音）由多个 code units 组成；
- grapheme cluster 不是锁的索引单位，但 UI 应尽量按 grapheme 选择；
- start/end 不得落在 surrogate pair 中间；越界或非法边界直接冲突。

前后端对同一固定测试向量计算索引、子串和 SHA-256，避免语言实现漂移。

## 3. Hash 规范

- baseContentHash：完整正文的原始 UTF-8 bytes SHA-256；不做 trim、换行替换或 Unicode normalization。
- selectedContentHash：按 UTF-16 边界截得的精确子串再以 UTF-8 bytes SHA-256。
- prefix/suffix anchor：选区相邻最多 64 个 UTF-16 code units（anchorWindow 可版本化）的子串 hash；不得截断 surrogate pair。
- lock 自身 hash：稳定序列化全部身份、版本、索引、内容/锚点 hash 与 indexEncoding 后 SHA-256。

只依赖 start/end 不安全：在其前方插入一个字符后索引整体偏移；相同索引可能指向完全不同内容。全文 hash、版本和选区 hash 共同阻止静默误写。

## 4. 权威应用校验

在同一 SQLite transaction 中：

1. 查询 draftId 并验证 novelId/chapterId；
2. 验证 draftVersion；
3. 读取完整正文，禁止使用 preview；
4. 验证 baseContentHash；
5. 校验 start/end 范围和 surrogate 边界；
6. 截取选区并验证 selectedContentHash；
7. 如存在锚点，验证 prefix/suffix；
8. 生成替换后的完整内容、hash 和字数；
9. 通过 save_chapter_draft_atomic 的事务内核心创建新候选草稿；
10. 写 target link 和 operation 权威结果后 commit。

任何一步失败都不允许降级为 replace_all，更不允许覆盖 adopted 草稿。

## 5. 模糊重定位策略

默认不自动模糊应用。发生全文版本/hash 冲突时，可在事务外为用户生成“重定位建议”，但它不是原锁的成功校验。

只在以下全部成立时提供候选：

- selectedContentHash 在最新全文中精确命中一次；
- prefixAnchorHash 和 suffixAnchorHash 在 ±2048 UTF-16 code units 的有界窗口中同时匹配；
- 命中不跨越非法 surrogate 边界；
- 目标仍是同一 novel/chapter 且草稿可编辑；
- UI 展示 old/new range 与差异，用户明确确认。

确认后创建新的 TextRangeLock、PlacementProposal 和 ApplyPlan。原锁保持冲突状态，绝不原地改索引。

若选中文本重复、多重锚点冲突或只有单侧锚点匹配，不提供自动候选。

## 6. 冲突时允许的用户操作

- 重新选择最新正文范围并创建新 Task；
- 查看 Artifact，手动复制；
- 将整章 Artifact 另存为新候选草稿（仅 Artifact 本来就是完整章节时）；
- 放弃 ApplyPlan；
- 对唯一重定位建议查看 diff 后确认并生成新 Plan。

禁止：“仍然应用到旧索引”“忽略 hash”“局部结果改为整章覆盖”。

## 7. 空选区与不同任务

- selectionStart === selectionEnd 为 TEXT_RANGE_EMPTY，不创建选区 Task。
- 续写应使用 insertion lock：start=end 但必须由单独 actionType=insert 定义，并锁定左右锚点；不能与 replace-range 共用空选区语义。
- 扩写/缩写/局部改写均是 replace-range，必须返回替换片段 Artifact，不接收 Provider 返回的整章文本直接覆盖。

## 8. 测试向量

至少覆盖：纯 CJK、ASCII+CJK、单 Emoji、Emoji+肤色修饰、ZWJ 家庭 Emoji、组合重音、CRLF/LF、选区在 surrogate 中间、空选区、越界、前方插入、选区内部修改、重复选中文本、单/双锚点、长正文分片读取失败。

浏览器与 Rust 对每个向量必须得到相同 UTF-16 长度、截取内容、selectedContentHash 和冲突结论。
