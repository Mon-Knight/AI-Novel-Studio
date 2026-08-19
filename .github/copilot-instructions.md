# GitHub Copilot / Agent 项目开发指令

项目名称：AI Novel Studio  
项目路径：F:\ai-novel-studio  
目标平台：Windows 桌面端  
技术路线：Tauri + React + TypeScript + SQLite  
主要开发工具：VS Code + GitHub Copilot / Agent  
文档用途：约束 Copilot / Agent 在本项目中的开发方向、代码结构、UI 风格、数据边界和版本管理流程。

---

# 1. 项目定位

AI Novel Studio 是一个原生运行在 Windows 上的 AI 小说创作软件。

本项目的目标不是普通码字软件，也不是普通网页后台，而是一个面向长篇小说创作的桌面端 AI 工作台。

核心逻辑是：

```text
用户提供世界背景、主角、特殊能力、分卷大纲、章节大纲
↓
软件通过不同提示词调用 AI API，让 AI 承担不同创作分工
↓
AI 辅助生成角色、事件、正文、润色建议、质量检查、章节总结
↓
用户修改、选择、确认采用
↓
系统沉淀上下文，继续辅助下一章生成
```

所有开发任务都必须围绕“逐章辅助完成一本小说”这个目标展开。

---

# 2. 开发时必须优先阅读的文档

开始任何开发任务前，优先查看以下文档：

```text
docs/product-design.md
docs/ui-reference.md
docs/data-model.md
```

后续若存在以下文档，也应参考：

```text
docs/prompt-system.md
docs/version-roadmap.md
docs/development-rules.md
```

如果代码和文档冲突：

1. 以用户最新需求为最高优先级。
2. 以 `docs/product-design.md` 的产品定位为主要方向。
3. 以 `docs/ui-reference.md` 的 UI 约束为界面标准。
4. 以 `docs/data-model.md` 的数据边界为数据设计依据。
5. 不要自行把项目改回普通后台或普通写作软件。

---

# 3. 项目最高优先级

本项目所有功能、界面、数据结构、提示词系统，都应服务于以下目标：

```text
第一优先级：像一个真正的 Windows 小说创作软件
第二优先级：以章节为单位完成 AI 正文生成
第三优先级：通过提示词让 AI 承担不同创作分工
第四优先级：用户选择和确认，AI 不直接决定最终正文
第五优先级：保存上下文，保证长篇小说连续性
第六优先级：长期可维护，避免代码和功能混乱
```

---

# 4. 本项目不应被开发成什么

开发过程中严禁把 AI Novel Studio 做成以下形式：

## 4.1 不要做成普通网页后台

禁止出现以下倾向：

```text
表格管理后台
普通 Dashboard
一堆表单页
大量 CRUD 页面
页面看起来像管理系统
```

本项目 UI 应接近桌面写作软件，而不是后台管理系统。

---

## 4.2 不要做成普通码字软件

普通写作软件的核心是用户手写正文。

AI Novel Studio 的核心是：

```text
右侧面板选择设定、角色、事件、风格、输出控制
↓
AI 生成章节正文到中间编辑区
↓
用户修改 / 重生成 / 润色 / 检查
↓
用户确认采用
```

中间正文区不是单纯空白编辑器，而是：

```text
AI 章节正文输出区 + 用户可编辑区 + 版本确认区
```

---

## 4.3 不要做成一次性生成整本小说的网站

本项目不追求一次生成整本小说。

正确方式是：

```text
一章一章生成
每章都允许用户选择、修改、重生成、确认采用
每章采用后自动总结上下文
后续章节调用已有上下文
```

---

## 4.4 不要沿用旧 AI World Engine 的产品结构

AI Novel Studio 是新项目。

可以参考旧项目经验，但不要沿用旧项目的“世界项目 / 世界推演 / 正史 / 分支”产品结构。

本项目应围绕以下概念设计：

```text
小说作品
分卷
章节
章节草稿
风格方案
输出控制方案
角色库
剧情事件
AI 任务记录
上下文总结
提示词模板
```

---

# 5. 技术路线约束

本项目技术路线固定为：

```text
Tauri + React + TypeScript + SQLite
```

开发时应遵守：

```text
1. 使用 React 组织 UI。
2. 使用 TypeScript 定义核心类型。
3. 使用 Tauri 作为 Windows 桌面壳。
4. 使用 SQLite 作为本地数据存储。
5. 后续 AI API 调用必须通过统一服务层封装。
6. 提示词模板必须独立管理，不能散落在组件中。
```

---

# 6. 推荐项目目录结构

应尽量保持以下结构：

```text
F:\ai-novel-studio
├─ src/
│  ├─ app/
│  ├─ pages/
│  │  ├─ Home/
│  │  ├─ NovelDetail/
│  │  ├─ WritingWorkspace/
│  │  ├─ StyleProfiles/
│  │  ├─ Settings/
│  │  └─ ComingSoon/
│  │
│  ├─ components/
│  │  ├─ layout/
│  │  ├─ sidebar/
│  │  ├─ topbar/
│  │  ├─ novel-card/
│  │  ├─ workspace/
│  │  ├─ right-dock/
│  │  └─ common/
│  │
│  ├─ features/
│  │  ├─ novels/
│  │  ├─ chapters/
│  │  ├─ characters/
│  │  ├─ outlines/
│  │  ├─ styles/
│  │  ├─ outputProfiles/
│  │  ├─ aiTasks/
│  │  └─ prompts/
│  │
│  ├─ services/
│  │  ├─ ai/
│  │  ├─ database/
│  │  ├─ prompt/
│  │  ├─ import/
│  │  └─ export/
│  │
│  ├─ store/
│  ├─ styles/
│  └─ types/
│
├─ src-tauri/
├─ prompts/
├─ docs/
├─ .github/
└─ README.md
```

不要把所有代码堆在：

```text
src/App.tsx
```

中。

---

# 7. UI 开发总要求

UI 必须参考用户提供的三个方向：

```text
图一：作品管理首页
图二：写作工作台
图三：右侧竖向工具栏与弹出式面板
```

界面目标是：

```text
首页像作品管理软件
工作台像专业写作软件
右侧栏像可弹出/收回的 AI 生成控制台
整体像 Windows 桌面软件
```

---

# 8. 首页 UI 规则

首页应接近“作家助手”类软件的作品管理首页。

首页必须包含：

```text
左侧全局导航
顶部状态栏
中部横幅或创作提示区
快捷入口卡片
作品卡片列表
```

首页导航建议：

```text
小说作品
创作资产
风格方案
模板中心
AI任务记录
导入导出
设置中心
```

早期未完成的功能不要做成灰色死按钮。

如果模块尚未实现，应进入：

```text
即将开放页面
```

并显示该模块将在后续版本开放。

---

# 9. 作品卡片规则

首页作品卡片应显示：

```text
作品封面
作品名称
题材
当前分卷
当前章节
总字数
最近更新时间
状态
进入工作台按钮
```

作品卡片点击行为建议：

```text
点击卡片主体：进入作品详情页
点击继续创作：进入写作工作台
点击更多：编辑 / 删除 / 导出，后续版本实现
```

---

# 10. 作品详情页规则

作品详情页是“创作资产管理中心”。

它负责管理：

```text
基础设定
大纲管理
角色库
风格方案
输出控制方案
导入导出
进入写作工作台
```

注意：

```text
复杂配置放在作品详情页或专门管理页。
写作工作台只调用已有配置。
```

不要把 TXT / JSON 导入、完整风格画像编辑、输出控制方案编辑全部塞到写作工作台右侧栏。

---

# 11. 写作工作台 UI 规则

写作工作台必须接近专业写作软件布局。

基础结构：

```text
顶部工具栏
左侧卷章目录树
中间正文编辑区
右侧竖向工具栏
右侧弹出式面板
底部状态栏
```

左侧卷章树包含：

```text
作品相关
第一卷
  第1章
  第2章
第二卷
  第1章
新建卷
新建章
```

中间正文区要求：

```text
显示章节标题
显示 AI 生成正文
允许用户编辑
支持保存草稿
支持确认采用
后续支持历史版本
```

底部状态栏显示：

```text
本章字数
目标字数
当前草稿版本
保存状态
AI 生成状态
```

---

# 12. 右侧工具栏规则

右侧栏是 AI 章节生成控制入口。

必须是：

```text
固定竖向工具栏
点击图标展开功能面板
再次点击收回
点击正文区自动收回
按 Esc 自动收回
切换章节自动收回
```

右侧工具栏建议项：

```text
AI生成
大纲
角色
事件
设定
风格
检查
润色
```

右侧弹出面板宽度建议：

```text
320px - 380px
```

不要让右侧面板长期占用正文空间。

---

# 13. 右侧面板职责边界

## 13.1 AI 生成面板

负责：

```text
选择当前章节
选择目标字数
选择风格方案
选择输出控制方案
选择生成模式
生成本章
重新生成
根据当前稿修改
确认采用
```

不负责：

```text
导入 TXT
编辑完整风格画像
编辑完整输出控制方案
管理所有作品设定
```

---

## 13.2 大纲面板

负责：

```text
查看当前分卷大纲
查看当前章节大纲
查看本章目标
查看与上一章衔接
查看结尾伏笔
```

---

## 13.3 角色面板

负责：

```text
选择本章出场角色
显示已生成角色库
显示 AI 推荐候选角色
将用户选择的角色加入本章
```

规则：

```text
AI 候选角色必须经用户确认后才能进入角色库。
第二次调用已生成角色时，必须读取已有角色关系、目标、性格限制、不能做出的行为和当前状态。
```

---

## 13.4 事件面板

负责：

```text
显示 AI 推荐事件
显示用户已选择事件
标记必须发生事件
标记禁止发生事件
将事件转化为正文生成提示词来源
```

事件生成必须基于：

```text
分卷大纲
章节大纲
前文总结
当前角色状态
当前矛盾
未回收伏笔
```

---

## 13.5 设定面板

负责查看当前章调用的设定：

```text
世界背景
魔法 / 科技 / 规则体系
主角特殊能力
本章特殊限制
```

不负责维护完整世界观。

---

## 13.6 风格面板

负责调用已有风格方案和输出控制方案。

可以显示摘要：

```text
当前风格方案
目标字数
节奏倾向
对话比例摘要
描写比例摘要
禁用写法摘要
```

不负责完整风格管理。

---

## 13.7 检查面板

负责：

```text
逻辑检查
设定违背检查
角色行为检查
前后文割裂检查
病句 / 错别字检查
节奏检查
```

检查结果必须以“建议”形式呈现，不得直接覆盖用户正文。

---

## 13.8 润色面板

负责：

```text
保持剧情不变
增强描写
减少废话
强化冲突
调整节奏
统一文风
```

润色结果应生成新版本，不直接覆盖当前正文。

---

# 14. 数据模型开发规则

核心数据必须围绕以下概念：

```text
Novel
Volume
Chapter
ChapterDraft
WorldSetting
RuleSystem
Protagonist
Character
CharacterState
Outline
ChapterEvent
StyleProfile
OutputProfile
ChapterSummary
ContextRecord
PromptTemplate
AiTaskRecord
ImportedAsset
Settings
```

类型文件建议放在：

```text
src/types/
```

推荐拆分：

```text
src/types/novel.ts
src/types/volume.ts
src/types/chapter.ts
src/types/character.ts
src/types/style.ts
src/types/output.ts
src/types/context.ts
src/types/ai.ts
src/types/settings.ts
```

不要把所有类型写在一个组件文件里。

---

# 15. 章节与草稿规则

章节是正文生成的基本单位。

同一章节必须允许多个草稿版本：

```text
AI 初稿
AI 重生成稿
用户修改稿
AI 润色稿
导入稿
最终采用稿
```

采用规则：

```text
1. 用户点击确认采用后，当前草稿成为正式正文。
2. 同章节其他草稿取消采用状态。
3. 章节状态更新为 adopted。
4. 章节正式字数更新。
5. 后续触发章节总结与上下文更新。
```

AI 生成结果不能直接覆盖正式正文。

---

# 16. AI 分工规则

AI Novel Studio 通过不同提示词让 AI 承担不同岗位。

必须支持或预留以下任务类型：

```text
setting_structure
rule_structure
protagonist_structure
volume_outline_expand
chapter_outline_generate
style_analyze
character_generate
event_suggest
chapter_generate
chapter_rewrite
chapter_polish
quality_check
chapter_summarize
context_update
```

每个 AI 任务应保存到 AI 任务记录中。

AI 任务记录至少应包含：

```text
任务类型
任务状态
模型名称
输入摘要
提示词模板
输出结果
错误信息
开始时间
结束时间
```

---

# 17. 提示词模板规则

提示词模板必须独立管理。

推荐目录：

```text
prompts/
├─ chapter_generate.md
├─ chapter_rewrite.md
├─ style_analyze.md
├─ character_generate.md
├─ event_suggest.md
├─ quality_check.md
└─ chapter_summarize.md
```

禁止：

```text
在 React 组件中直接写大量提示词
在按钮点击事件里拼复杂 prompt
多个地方重复复制同一段提示词
```

应通过统一服务层处理：

```text
Prompt Orchestrator / 提示词调度中心
```

---

# 18. AI 服务层规则

AI 调用必须通过服务层封装。

推荐结构：

```text
src/services/ai/
├─ aiClient.ts
├─ aiTypes.ts
└─ aiTaskService.ts

src/services/prompt/
├─ promptOrchestrator.ts
├─ promptTemplateService.ts
└─ contextBuilder.ts
```

组件层只负责触发操作，不直接处理完整 AI 请求细节。

---

# 19. 数据库服务层规则

SQLite 访问必须通过服务层或 Repository 层封装。

推荐结构：

```text
src/services/database/
├─ db.ts
├─ novelRepository.ts
├─ chapterRepository.ts
├─ characterRepository.ts
├─ styleRepository.ts
└─ aiTaskRepository.ts
```

禁止：

```text
在 UI 组件中直接写 SQL
在多个组件中重复数据库逻辑
把数据库逻辑和 UI 渲染混在一起
```

---

# 20. v0.1.0 开发范围

v0.1.0 只做项目基础框架和 UI 原型，不接复杂 AI 功能。

必须实现：

```text
1. Tauri + React + TypeScript 基础项目
2. 应用名称 AI Novel Studio
3. 首页作品管理布局
4. 左侧全局导航
5. 顶部状态栏
6. 快捷入口卡片
7. 作品卡片列表
8. 作品详情页占位
9. 写作工作台基础三栏布局
10. 右侧竖向工具栏
11. 右侧面板展开 / 收回基础交互
12. 即将开放页面
13. 基础 mock 数据
14. 基础 TypeScript 类型
15. GitHub 首次备份
16. v0.1.0 标签
```

v0.1.0 不做：

```text
真实 AI API 调用
完整 SQLite 数据库
真实 TXT / JSON 导入
真实正文生成
真实质量检查
真实上下文总结
安装包打包
复杂编辑器功能
```

---

# 21. 版本路线

后续版本按以下方向推进：

```text
v0.1.0：桌面壳与首页 UI 原型
v0.2.0：作品详情与基础设定
v0.3.0：分卷与章节管理
v0.4.0：写作工作台 UI 完善
v0.5.0：AI 正文生成闭环
v0.6.0：风格方案与输出控制
v0.7.0：角色与事件辅助
v0.8.0：上下文总结
v0.9.0：质量检查与润色
v1.0.0：可正式写长篇的基础版
```

不要跨版本一次性实现过多功能。

---

# 22. Git 与 GitHub 规则

本项目必须使用 Git 管理，并推送到 GitHub 备份。

每次开发前先执行：

```powershell
git status
```

每个稳定版本完成后执行：

```powershell
git switch -c codex/v0.1.0-release
git add .
git commit -m "feat: initialize AI Novel Studio v0.1.0"
git push -u origin codex/v0.1.0-release

# PR 审查和门禁通过并合并后
git switch main
git pull --ff-only origin main
git tag v0.1.0
git push origin v0.1.0
```

分支、PR、hotfix 与回滚以 `docs/project/git-workflow.md` 为准，不在日常开发中直接提交到 `main`。

后续版本提交信息应清晰，例如：

```text
feat: add novel detail page v0.2.0
feat: add chapter management v0.3.0
feat: add writing workspace layout v0.4.0
```

不要提交：

```text
node_modules/
dist/
target/
.env
.env.local
*.db
*.sqlite
*.log
API Key
临时缓存文件
```

---

# 23. API Key 安全规则

严禁：

```text
把 API Key 写死进代码
把 API Key 提交到 GitHub
在日志中打印完整 API Key
在 UI 中显示完整 API Key
```

必须：

```text
使用本地配置
.env.local 加入 .gitignore
设置页只显示脱敏后的 Key
AI 任务日志不保存密钥
```

---

# 24. 代码风格规则

必须遵守：

```text
使用 TypeScript
组件职责单一
类型定义独立
服务层独立
样式文件独立
避免超大组件
避免重复代码
避免无意义抽象
```

React 组件建议：

```text
一个组件只负责一个明确 UI 区域
页面组件负责组织布局
业务逻辑放 features 或 services
通用 UI 放 components/common
```

不要把一个页面写成几千行单文件。

---

# 25. 样式规则

样式建议拆分：

```text
src/styles/
├─ global.css
├─ variables.css
├─ app-shell.css
├─ home.css
├─ novel-detail.css
├─ workspace.css
└─ right-dock.css
```

视觉要求：

```text
浅色桌面软件风格
边框轻量
阴影克制
正文编辑区阅读舒适
不要大面积炫彩渐变
不要后台管理系统风
```

推荐字体：

```css
font-family: 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif;
```

---

# 26. 路由规则

建议路由：

```text
/
首页 / 作品管理

/novels/:novelId
作品详情页

/novels/:novelId/workspace
写作工作台

/styles
风格方案管理

/settings
设置中心

/coming-soon
未开放模块提示页
```

如果使用 HashRouter 或其他桌面端更稳定的路由方式，应保持路径语义清晰。

---

# 27. 未完成功能处理规则

不要出现：

```text
点击无反应
灰色按钮但没有解释
导航项无法点击
空白页面
控制台报错
```

未完成功能统一进入：

```text
ComingSoon 页面
```

页面说明：

```text
该功能将在后续版本开放。
当前版本范围以 `package.json` 与 `docs/version-roadmap.md` 的当前版本声明为准。
```

---

# 28. 测试与验证规则

每次完成任务后，至少验证：

```powershell
npm install
npm run dev
npm run tauri dev
```

如果配置了 lint，还应执行：

```powershell
npm run lint
```

每次完成版本后，应说明：

```text
修改了哪些文件
实现了哪些功能
如何运行
已验证哪些命令
是否已提交 Git
是否已推送 GitHub
是否已打 tag
```

---

# 29. Agent 执行任务时的行为要求

执行用户任务时：

```text
1. 先阅读 docs 文档。
2. 再查看当前项目结构。
3. 不要盲目重写整个项目。
4. 不要删除已有可用功能。
5. 不要未经说明改技术路线。
6. 不要擅自引入大型依赖。
7. 不要把 UI 改成后台管理风。
8. 不要把所有逻辑写进 App.tsx。
9. 不要一次性做超过当前版本范围的功能。
10. 完成后必须给出清晰完成汇报。
```

---

# 30. 完成汇报格式

每次任务完成后，建议按以下格式回复用户：

```markdown
# ✅ 完成汇报

## 一、当前版本

- 分支：
- 版本：
- Tag：

## 二、本次目标

- ...

## 三、已完成内容

- ...

## 四、新增 / 修改文件

- ...

## 五、运行与验证

- npm install：
- npm run dev：
- npm run tauri dev：
- npm run lint：

## 六、GitHub 备份

- commit：
- push：
- tag：

## 七、后续建议

- ...
```

---

# 31. 最重要的开发提醒

请始终记住：

```text
AI Novel Studio 不是普通写作软件。
AI Novel Studio 也不是网页后台。
它是一个 Windows 桌面端 AI 小说创作工作台。
它的核心是：用户控制方向，AI 分工生成，章节逐步采用，上下文持续沉淀。
```

所有代码、页面、数据结构、提示词系统和版本规划，都必须服务于这个核心目标。
