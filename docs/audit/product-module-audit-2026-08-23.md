# AI Novel Studio 左侧功能模块完整审计 (2026-08-23)

> 审计范围：左侧「创作」六项（创作工作台 / 小说作品 / 创作资产 / 风格方案 / 模板中心 / AI任务记录）及新用户端到端流程。  
> 方法：只读核对 `src/`、`src-tauri/`、`docs/` 与 CHANGELOG。  
> 基线：产品自称 v3.5.0；CHANGELOG Unreleased 另有一套 Memory / Agent Harness / 版本溯源，多数未挂进左侧主路径。

---

## 1. 当前模块状态评分

评分口径：10 = 可支撑百万字长期创作闭环；6 = 能用但主路径有断裂；4 以下 = 入口或能力名实不符。

| 模块 | 评分 | 一句话判断 |
| --- | --- | --- |
| 创作工作台 | **4.5 / 10** | 对话壳、任务树、工具行、产物卡、重试/停止都在；**真正写章的不是 `generate_chapter`**，失败主因是契约与调度，不是「模型不会写小说」。 |
| 小说作品 | **7.0 / 10** | 建书、卷章、详情、写作工作台、草稿采用是最完整的一块；但默认入口已不是这里，和对话工作台脱节。 |
| 创作资产 | **4.0 / 10** | 本质是跳转门户；世界观/人物在作品详情，地点/势力在另一页，事件面板已退役，Memory 未打通。 |
| 风格方案 | **5.5 / 10** | CRUD + 画像分析可用；**旧 Writer 管线会读，工作台 DSH allowlist 不读**。 |
| 模板中心 | **3.0 / 10** | 用户本地模板本；真正的 Prompt Registry / `prompts/*.md` 不在这个页面，Agent 也不会自动选。 |
| AI任务记录 | **5.0 / 10** | 旧 AI Task 列表可筛、可停、可删；工作台 Agent Trace / 训练反馈不在这里。 |
| 整体用户流程 | **3.5 / 10** | 文档、引导、默认首页、真正生成器是三套心智。新用户很容易卡在「生成下一章 → 工具失败」。 |
| **综合** | **4.6 / 10** | 工程底座厚，主创作路径薄。 |

---

## 2. 已完成能力

### 2.1 创作工作台

- 默认路由 `/` 就是工作台；无作品时会引导去 `/novels`。
- 小说 → 任务树、多任务并发、任务级模型快照、停止、失败「重试此回合」。
- 对话内联工具行（中文语义名 + 技术名）+ 产物卡（确认审阅 / 要求修改 / 拒绝 / 结构化应用）。
- 问候语短路，不再空打 `generate_chapter`。
- 桌面走固定 DSH Worker；浏览器走确定性 fallback，并标明「非 DSH / 非正式 Artifact」。
- 章节确认会签发审阅授权，跳写作工作台只读审阅。
- 「当前插件」只读投影 Runtime Registry。

### 2.2 小说作品

- 创建 / 导入 TXT·JSON / 删除级联 / 详情编辑。
- 世界背景、规则体系、主角、大纲卷章、角色库、上下文概览、导出。
- 写作工作台：卷章树、正文编辑、保存草稿、采用、章节总结；生成类右侧栏已退役（E2E 除外）。
- 大文本分片（`large_text_documents/chunks`）按章存正文，数据层具备百万字存储形状。

### 2.3 创作资产

- 门户可统计：角色、总结、上下文、风格、待确认设定、势力+地点。
- 正式势力/地点 + 跨章事务在 `StoryAssetsPage`（桌面 SQLite）。
- 设定库 AI 推演、参考资料库、自主规划仍有独立路由（不在左侧一级，但从详情可进）。

### 2.4 风格方案

- 手动风格 / 输出控制 / 参考文本分析。
- `styleProfilePromptProjection` 能把画像投影进**旧**生成编译器。
- 作品可 `setActive`；旧 `chapterGenerationPipeline` / `outlineGenerateService` 会读 active style。

### 2.5 模板中心

- 内置 8 条题材/大纲/角色/输出示例。
- 用户可新建、导入 txt/md/json、筛选、编辑（**只写 LocalStorage**）。

### 2.6 AI任务记录

- 按类型/状态分页、运行中轮询、停止、终态删除、粗成本汇总。
- 桌面 DSH 成功链会再开一条 AI Task → Attempt → ResultArtifact（与对话卡片分离）。

---

## 3. 存在问题列表

### 3.1 创作工作台（核心）

**Agent 对话**

- 桌面是「DSH 模型自己写 `candidateText`，再交给校验槽」；浏览器是「关键词路由 + 假预览」。两套语义不一致。
- `AgentChatWorkspace` / `AgentLoop` / 9 工具 Harness **没有路由**，和左侧工作台是平行体系。
- 任务永远叫「新的创作任务」，发送后不改标题。
- **没有章节选择器**。`chapterId` 静默取 `novel.currentChapterId` 或第一章；用户无法指定「生成第 18 章」。

**Task 创建**

- 只能先空任务再打字；不能按章/按目标建任务。
- 无章绑定时 UI 写「只读检索，不生成候选」，但快捷芯片仍是「生成下一章」。

**Tool 调用（这是 `generate_chapter` 失败的根）**

`generate_chapter` **不是生成器**。Gateway / TS Registry 都写明：接收并验证模型**已经写好**的 `candidateText`，不写正式正文，自己也不调用 Writer。

失败分层：

| 层 | 判断 | 典型症状 |
| --- | --- | --- |
| **1. 工具契约 / 参数（主因）** | 是 | `candidateText must be a non-empty string` / `章节候选过短` / `chapterId is required` |
| **2. Agent 调度** | 是 | 模型把工具当「去写一章」而空调用；或问候以外的闲聊仍被关键词打成 generate |
| **3. 数据** | 常见 | 无卷章、`chapter not found`、绑错章、novel/chapter 归属不一致 |
| **4. 服务 / 治理投影** | 桌面常见次因 | DSH 载体未装好；`缺少实际治理请求身份`；缺 `largeTextRefId`；哈希不一致；结果不是合法 JSON |
| **5. 模型能力** | 次因 | 要把整章塞进 tool 参数（上限 40 万字）；小上下文模型极易截断/拒填 |
| **6. 产品命名** | 放大一切 | UI 写「生成章节候选」，实现是「校验槽」。用户和模型都被骗 |

关键词路由 `matchCandidateTool()` 在绑了章且不是纯问候时，**默认就是 `generate_chapter`**。只要用户说了「帮我写」「继续」「这一段」，桌面模型几乎必然去调这个槽。

DSH allowlist **没有** `style.read_profile`、`chapter.read_context`、`verification.*`。风格、完整章上下文、就绪检查进不了工作台工具环。

**失败处理 / 重试**

- 工具失败会标红；整轮失败出「重试此回合」。
- 重试 = 再发同一句用户话，**不修参数、不换工具、不补 candidateText**。契约失败会稳定复现。
- 无「补全参数后重放」「改用旧 Writer 管线」的恢复。

**输出展示**

- 成功才有 Artifact 卡；失败常常只有一行 tool error。
- 浏览器成功也是「预览，不是 ResultArtifact」，确认/审阅在浏览器上是空心的。

**用户确认**

- 章节：确认 → 审阅授权 → 写作工作台；**不能在对话里一键采用**。
- 「要求修改」只记决定，**不自动再生成**。
- 结构化候选可 `request_apply`；质量报告故意不能应用。
- 写作工作台生成/大纲/角色/事件/风格/润色面板已退役，确认后用户几乎只能手改。

### 3.2 小说作品

- 默认首页已是工作台，作品库降为二级；详情主按钮仍是「进入写作工作台」，不是「回对话生成」。
- 卷章管理在详情 `OutlineManager`，工作台看不到卷章树。
- 状态同步：工作台换书会重绑章，但任务不感知「当前章已换/已删」。
- Version：`chapter_drafts.version_no` 是真持久化；`ChapterVersionService`（Git 式 revision / provenance）是 **进程内 Map**，重启丢失。
- Memory：采用正文**没有**调用 `memoryService.putDocument`。`search_memory` 经常空。
- 百万字：存储按章分片可以；工作台一次读全上下文、无章选择、Memory 不入库，**养不了百万字**。

### 3.3 创作资产

用户要查的五类资产，实际落点：

| 用户以为 | 真实位置 | 和 Memory |
| --- | --- | --- |
| 世界观 | 作品详情 `world_settings` + 规则体系 | 不自动进 Memory |
| 人物 | 详情角色库 + `protagonists`（两套） | `get_character_states` 只读库表；`novelMemoryManager` 是另一套内存态 |
| 地点 / 势力 | `/novels/:id/story-assets`，浏览器模式不可用 | 未进三层 Memory |
| 事件 | 写作台 `EventsPanel` **已退役**；无左侧入口 | 候选走 `suggest_events`，正式章事件难找 |

重复源至少四套：详情设定、Story Assets、设定推演、`expand_settings` 候选；角色库 vs 主角表 vs Memory 动态状态 vs `generate_characters`。

门户卡片大半跳回同一详情页。Back 写「返回首页」却 `to="/"`（工作台）。浏览器下势力/地点恒为 0。

### 3.4 风格方案

- 页面 `getAll()` **不按当前小说过滤**，全局一锅粥。
- 影响旧 Writer（`generationContextCompiler` / `useChapterGenerationAction`），**不影响工作台 DSH**。
- 工作台「风格分析」被路由成 `check_quality`，「润色/风格」才是 `polish_chapter`。
- 模型适配在 Prompt Registry，不在风格页。

### 3.5 模板中心

三套互不相认：

1. 本页：LocalStorage 用户模板，Agent 不读。  
2. `promptTemplateRegistry`：官方模板 + 模型族适配，**只有单测引用**。  
3. `prompts/*.md` + `productionCompilationRegistry`：旧生成/自主规划在用。

工作台芯片只是六句 goal 文案，不是 Registry。**Agent 不能按任务/模型自动选模板。**  
ComingSoon 文案还把本页说成「提示词模板」，名实不符。

### 3.6 AI任务记录

- 看的是旧 `ai_task_records`（章节生成/润色/检查…），不是工作台 conversation/run/tool event。
- 工作台成功才会投影一条 Task；**失败的 generate_chapter 往往只留在对话里**。
- 无 Agent Decision Trace、无用户点踩、无导出。
- `feedbackDatasetService` 是内存数组，重启清空；左侧无入口。
- `GenerationTracePanel` / `MemoryInspectorPanel` 在写作台右侧，且依赖未持久的 Memory/Trace。

不满足「调试 + 训练采集」一体化。

---

## 4. Bug 风险

**P0 级**

1. **空调用 `generate_chapter` 必失败**（缺 `candidateText`）。不是偶发模型幻觉，是工具定义。  
2. **无章节 / 错章节** → `chapter not found` / `必须绑定目标章节`。UI 不能选章。  
3. **工具成功、投影失败**：缺 `governedProviderRequestId`、缺大文本引用、哈希/JSON/归属校验。用户看到「生成失败」，正文可能已经在模型侧写过。  
4. **浏览器 fallback 冒充生成**：假预览、无正式 Artifact；用户确认进审阅会空。  
5. **采用不入库 Memory**：长期检索是空的，越写越漂。  
6. **退役生成面板 + 工作台又生成不了** = 主路径双杀。E2E 仍能打开旧面板，生产和用户不一致。

**P1 级**

7. 重试复现同一契约错误。  
8. 「要求修改」不触发再生成。  
9. 任务标题永不更新；多任务全是「新的创作任务」。  
10. `ChapterVersionService` / `novelMemoryManager` / feedback 样本重启丢失，却被 CHANGELOG 写成已完成。  
11. 风格页跨作品串数据。  
12. 模板中心只在 LocalStorage，桌面换机/重装即无。  
13. 资产页/任务页 Back 去工作台，文案说首页。  
14. ComingSoon 仍描述已上线模块，路由还在。  
15. 用户文档（`user-guide.md` / FirstTimeGuide）仍教「右侧 AI 生成」，与 v3.5 相反。

**P2 级**

16. 工作台无流式正文（旧管线有 SSE）。  
17. 冲突提示不阻断并发，确认时才 CAS 撞车。  
18. 压缩上下文是预览卡，和生成质量弱相关。  
19. 插件面板对排障几乎无帮助。

---

## 5. 架构问题

```text
用户以为的主路径
  说话 → Agent 规划 → 生成章节 → 改 → 存 → 继续

实际有三条平行管线
  A. 工作台 DSH：模型填 candidateText → 校验槽 → Artifact → 审阅授权 → 写作台手改
  B. 旧 Writer：prompt/style/context 编译 → chapter_generate / scene-beat（默认 UI 已藏）
  C. Unreleased Harness：AgentLoop + Memory Layer + ChapterRevision（无路由，内存态）
```

1. **「生成」被拆成「模型作文 + 校验入库」**，名字还叫 generate。这是调度问题，不是单纯模型差。  
2. **双运行时**：Tauri DSH vs 浏览器脚本步骤表；桌面问题在浏览器复现不了。  
3. **双 Memory**：SQLite `memory_documents`（工作台在搜）vs 内存三层 Memory（Inspector/Agent 在用）vs `chapter_summaries/context_records`。  
4. **双版本**：草稿 `version_no` vs 内存 `ChapterRevision`。  
5. **双/三 Prompt**：页面模板、Registry、`prompts/*.md`。  
6. **风格不在工作台闭环**：旧编译器吃风格，DSH 11 工具不读风格。  
7. **确认过重**：章必须离开对话去写作台；写作台又不能再生成。  
8. **文档负债**：产品设计第 21 节、用户指南、首次引导、ComingSoon、Unreleased CHANGELOG 四套故事。

**百万字长期维护？数据层勉强，产品层不能。**  
缺：按章绑定任务、采用即入 Memory、分层检索进生成、持久版本/反馈、工作台与卷章树一体。现在是「能存很多章」，不是「能持续写很多章」。

---

## 6. 整体用户流程：中断点

```text
打开软件 → 创作工作台
  ✕ 无作品：还能去小说库
  ✕ 有作品：默认第一章，用户不知道
  ✕ 首次引导只在 /novels，默认首页看不到
        ↓
创建小说（必须离开工作台）
  △ 详情页能填设定/卷章
  ✕ 主 CTA 是写作工作台，不是对话
  ✕ 不建章就回工作台 → 无法生成
        ↓
输入需求「生成下一章」
  ✕ 未配 API / DSH 未就绪 → 任务启动失败
  ✕ 模型空调用工具 → generate_chapter 失败   ← 最高频
  ✕ 浏览器：假预览，不能当正式稿
        ↓
Agent 规划
  △ 只有系统提示里的「先读后写再交 candidateText」
  ✕ 无可见计划树；无风格/模板自动选择
        ↓
生成章节
  ✕ 工具成功仍可能投影失败
  ✕ 不经 chapterGenerationPipeline，风格/Memory/场景作家都不在
        ↓
修改
  △ 确认后去写作台手改
  ✕ 「要求修改」不再生
  ✕ 写作台生成面板已退役
        ↓
保存 / 采用
  △ 草稿版本可用
  ✕ 不写 Memory，不写 Git 式版本，不采集反馈
        ↓
继续创作
  ✕ 工作台仍绑旧章；任务名仍是「新的创作任务」
  ✕ 下一章要回详情建章，再靠静默绑定碰运气
```

---

## 7. 优先级

### P0 — 影响核心创作流程

1. **重定义或重实现 `generate_chapter`**：要么变成真 Writer（调编译管线/场景作家，工具只负责触发），要么改名并在 UI 写清「先出正文再提交校验」。禁止再让模型空调用一个校验槽。  
2. **工作台必须显式选章**；无章时禁用生成芯片，引导去建章。  
3. **失败可行动**：区分参数/调度/数据/服务/模型；重试允许改参，而不是原话重放。  
4. **接通一条唯一写章路径**：工作台产物 ← 旧 Writer 或新 Harness，不要三条半成品。  
5. **采用 → Memory 入库**（至少 adopted_draft / summary），否则 `search_memory` 无意义。  
6. **文档/引导与默认首页对齐**：先设模型、建书、建章、再对话生成。

### P1 — 影响体验

1. 任务标题随首条目标更新；可按章过滤任务。  
2. 「要求修改」自动开新回合并带上上一份候选。  
3. 风格 active profile 进入工作台只读工具或系统提示。  
4. 事件/地点/势力从资产页能管，而不是退役面板 + 隐藏路由。  
5. AI任务记录合并 conversation run / tool event / Artifact，失败也可查。  
6. 干掉或改写 ComingSoon、过期 user-guide、错误 Back 按钮。  
7. 风格/模板按当前小说隔离；模板不要只活在 LocalStorage。

### P2 — 优化项

1. 把 Prompt Registry 接到工作台自动选模。  
2. 持久化 ChapterRevision / NovelMemory / Feedback，再谈训练采集。  
3. 流式候选、压缩质量、插件健康对用户可读。  
4. 删除或隐藏未挂路由的 `AgentChatWorkspace`，避免继续双栈膨胀。  
5. 百万字：章级窗口 + 分层 Memory + 版本 diff，而不是一次塞全书。

---

## 8. 对「generate_chapter 为什么失败」的结论

**主要不是「模型不会写」，也不是单纯服务挂了。**

排序：

1. **工具参数 / 契约**（主因）：工具不写正文，只验 `candidateText`；空调用瞬间失败。  
2. **Agent 调度**：名字叫 generate，allowlist 又把它当写章入口；模型按常识去调。  
3. **数据**：未建章、未选章、章已删。  
4. **服务投影**：DSH / 治理请求身份 / 大文本哈希 —— 工具已成功也会整轮失败。  
5. **模型**：超长 tool 参数、截断、非 JSON 结构化候选。
