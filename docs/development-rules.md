# AI Novel Studio 开发规则文档

> 文件名：`development-rules.md`  
> 项目名称：AI Novel Studio  
> 本地路径：`F:\ai-novel-studio`  
> 技术路线：Tauri + React + TypeScript + SQLite  
> 开发方式：VS Code + Copilot / Agent 辅助开发  
> 文档目的：约束后续开发流程、目录结构、版本管理、GitHub 备份、UI 方向、AI 功能开发边界，避免项目在长期迭代中变成混乱的网页后台或不可维护的代码堆。

---

## 0. Agent 基础设施（v1.0.43 新增）

AI Novel Studio 已建立完整的 Agent 工程化开发基础设施。所有开发者在开始工作前，除本文档外，还应阅读：

- **`AGENTS.md`** — AI Agent 总入口规则（必读）
- **`.github/instructions/`** — 6 个分领域开发指令
- **`.github/skills/`** — 5 个多步骤 Agent 工作流
- **`.cursor/rules/`** — 5 个 IDE 规则
- **`docs/agent-workflow.md`** — Agent 标准工作流

AI Agent 在操作本仓库时，必须：
1. 先读 `AGENTS.md`
2. 遵循 `docs/agent-workflow.md` 定义的工作流
3. 遵守 `.cursor/rules/agent-safety.mdc` 中的安全约束

---

## 1. 项目基本定位

AI Novel Studio 是一个原生运行在 Windows 上的 AI 小说创作软件。

它的核心目标不是普通码字，也不是一次性生成整本小说，而是通过不同提示词调用 AI API，让 AI 在不同创作阶段承担不同分工，辅助用户逐章完成一本小说。

核心流程：

```text
用户创建小说作品
↓
填写世界背景、规则体系、主角、特殊能力
↓
建立分卷大纲和章节大纲
↓
导入或创建风格方案、输出控制方案
↓
进入章节写作工作台
↓
选择本章出场角色、剧情事件、风格、目标字数
↓
AI 生成一章正文
↓
用户修改、重生成、润色、检查
↓
用户确认采用
↓
系统自动总结章节、更新上下文
↓
继续生成下一章
```

后续所有功能都必须服务于这个主流程。

---

## 2. 项目开发总原则

### 2.1 不再沿用旧项目结构

本项目是新建项目，不是 AI World Engine 的修补版本。

允许参考旧项目中的经验：

- AI 调用思路
- 提示词分工思路
- GitHub 版本管理经验
- 本地数据保存经验
- 导入导出经验

禁止直接沿用旧项目的信息架构：

- 不以“世界项目”为主入口
- 不以“世界推演记录”为核心页面
- 不做普通后台管理系统
- 不把 UI 做成网页式数据管理面板
- 不把“上下文包”做成开局强制填写项

本项目主入口必须是：

```text
小说作品 → 作品详情 → 章节写作工作台 → AI 生成正文
```

---

### 2.2 先稳定主干，再扩展高级功能

开发顺序必须遵循：

```text
界面骨架
↓
本地数据结构
↓
章节写作闭环
↓
AI 生成闭环
↓
风格方案
↓
角色与事件辅助
↓
上下文总结
↓
质量检查与润色
```

不得在基础框架未稳定前同时开发过多复杂功能。

MVP 阶段优先完成：

- 桌面应用壳
- 首页 UI
- 作品管理
- 作品详情
- 分卷 / 章节管理
- 写作工作台
- 章节草稿保存
- AI 生成正文
- 用户确认采用

暂缓开发：

- 多模型复杂调度
- 云同步
- 多人协作
- 复杂版权检测
- 全书自动生成
- 高级发布平台
- 复杂统计分析
- 插件市场

---

### 2.3 每次开发必须小步提交

Copilot / Agent 每次开发任务必须控制范围。

推荐每次任务只做一个明确版本：

```text
v0.1.0：桌面壳与首页
v0.2.0：作品详情与基础设定
v0.3.0：分卷与章节管理
v0.4.0：写作工作台 UI
v0.5.0：AI 正文生成闭环
v0.6.0：风格方案与输出控制
v0.7.0：角色与事件辅助
v0.8.0：上下文总结
v0.9.0：质量检查与润色
v1.0.0：可正式写长篇的基础版
```

不要让 Agent 一次性完成多个版本目标。

---

## 3. 技术栈规则

### 3.1 固定技术路线

本项目采用：

```text
Tauri
React
TypeScript
SQLite
```

技术分工：

| 技术 | 用途 |
|---|---|
| Tauri | Windows 桌面应用壳、打包、系统能力调用 |
| React | UI 界面开发 |
| TypeScript | 类型约束、提升长期维护性 |
| SQLite | 本地小说数据、章节、角色、风格方案保存 |
| CSS / Tailwind 可选 | UI 样式实现 |
| Markdown / JSON | 提示词模板、风格配置、文档管理 |

---

### 3.2 不随意更换技术栈

没有明确决策前，不得改成：

- Electron
- PySide6
- FastAPI + HTML
- Vue
- Angular
- 纯 Python 桌面
- 纯网页应用

后续确实需要改技术路线时，必须先单独写技术评估文档，再进行迁移。

---

### 3.3 TypeScript 规则

所有核心业务代码必须优先使用 TypeScript。

要求：

- 不随意使用 `any`
- 类型定义集中放入 `src/types/`
- 复杂数据结构必须有 interface 或 type
- AI 任务、小说、章节、角色、风格方案等必须定义类型
- 组件 props 必须定义类型
- API 返回值必须定义类型

允许在早期 MVP 阶段临时使用简单 mock 类型，但后续必须逐步规范。

---

## 4. 推荐项目目录结构

项目根目录：

```text
F:\ai-novel-studio
```

推荐结构：

```text
ai-novel-studio/
├─ src/
│  ├─ app/
│  │  ├─ routes/
│  │  ├─ layout/
│  │  └─ providers/
│  │
│  ├─ pages/
│  │  ├─ Home/
│  │  ├─ NovelDetail/
│  │  ├─ WritingWorkspace/
│  │  ├─ StyleProfiles/
│  │  ├─ Settings/
│  │  └─ ImportExport/
│  │
│  ├─ components/
│  │  ├─ layout/
│  │  ├─ sidebar/
│  │  ├─ topbar/
│  │  ├─ novel-card/
│  │  ├─ editor/
│  │  ├─ right-dock/
│  │  └─ panels/
│  │
│  ├─ features/
│  │  ├─ novels/
│  │  ├─ volumes/
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
│  │  ├─ import/
│  │  ├─ export/
│  │  └─ prompt/
│  │
│  ├─ store/
│  │  ├─ novelStore.ts
│  │  ├─ workspaceStore.ts
│  │  └─ settingsStore.ts
│  │
│  ├─ styles/
│  │  ├─ global.css
│  │  ├─ layout.css
│  │  └─ workspace.css
│  │
│  └─ types/
│     ├─ novel.ts
│     ├─ chapter.ts
│     ├─ character.ts
│     ├─ style.ts
│     ├─ prompt.ts
│     └─ ai.ts
│
├─ src-tauri/
│  ├─ src/
│  ├─ tauri.conf.json
│  └─ Cargo.toml
│
├─ prompts/
│  ├─ system/
│  ├─ settings/
│  ├─ style/
│  ├─ outline/
│  ├─ workspace/
│  └─ context/
│
├─ data/
│  ├─ default_styles.json
│  ├─ default_output_profiles.json
│  └─ templates.json
│
├─ docs/
│  ├─ product-design.md
│  ├─ ui-reference.md
│  ├─ data-model.md
│  ├─ prompt-system.md
│  ├─ version-roadmap.md
│  └─ development-rules.md
│
├─ .github/
│  └─ copilot-instructions.md
│
├─ README.md
├─ package.json
├─ tsconfig.json
└─ .gitignore
```

---

## 5. 目录职责边界

### 5.1 `src/pages/`

只放页面级组件，例如：

- 首页
- 作品详情
- 写作工作台
- 风格方案页
- 设置页
- 导入导出页

页面组件负责组合子组件，不应写大量业务逻辑。

---

### 5.2 `src/components/`

只放可复用 UI 组件，例如：

- 左侧导航
- 顶部栏
- 作品卡片
- 编辑器容器
- 右侧弹出栏
- 通用按钮
- 通用弹窗
- 状态标签

组件尽量保持纯 UI，不直接调用 AI API 或数据库。

---

### 5.3 `src/features/`

放业务模块逻辑，例如：

- novels：小说作品
- volumes：分卷
- chapters：章节
- characters：角色
- styles：风格方案
- aiTasks：AI 任务记录
- prompts：提示词任务注册

业务模块可以组织 hooks、services、reducers、types，但不要混入大段 UI 样式。

---

### 5.4 `src/services/`

放底层服务：

- AI API 客户端
- SQLite 访问
- 提示词模板读取
- 提示词变量组装
- TXT / JSON 导入
- TXT / Markdown / Docx 导出

服务层不得直接依赖页面组件。

---

### 5.5 `prompts/`

所有提示词模板必须放在 `prompts/` 目录。

禁止在 React 组件里硬编码大段提示词。

允许页面向服务层传入任务参数，但提示词模板必须集中管理。

---

### 5.6 `docs/`

所有产品设计、数据模型、提示词系统、UI 参考、开发规则都必须放入 `docs/`。

Copilot / Agent 开发前必须优先读取相关文档。

---

## 6. UI 开发规则

### 6.1 UI 总方向

UI 必须参考用户提供的写作软件图片，但不做一比一复制。

整体目标：

```text
像 Windows 桌面写作软件
而不是浏览器网页后台
```

核心界面：

```text
首页：作品管理首页
工作台：左侧卷章树 + 中间正文编辑区 + 右侧竖向工具栏 / 弹出面板
```

---

### 6.2 首页 UI 规则

首页应参考成熟写作软件的作品管理首页。

必须包含：

- 左侧全局导航栏
- 顶部状态栏
- 中间横幅 / 快捷入口
- 新建作品
- 导入作品
- 模板入口
- 最近作品
- 作品卡片列表

作品卡片建议展示：

- 作品名称
- 题材
- 当前卷 / 当前章
- 总字数
- 最近更新时间
- 创作状态
- 进入工作台按钮

首页不得做成普通表格后台。

---

### 6.3 写作工作台 UI 规则

写作工作台必须包含：

```text
顶部工具栏
左侧卷章目录树
中间正文编辑区
右侧竖向工具栏
右侧弹出式面板
底部状态栏
```

中间正文区定位：

```text
AI 生成正文输出区
用户修改区
草稿保存区
版本确认区
```

不得把中间正文区设计成仅供用户手写的普通文本框。

---

### 6.4 右侧栏 UI 规则

右侧栏必须符合以下规则：

- 右侧固定一列竖向图标
- 点击图标后弹出对应面板
- 再次点击可收回
- 点击正文区域可自动收回
- 面板不应长期挤占正文区域
- 面板内容应简洁，不做复杂后台表单

右侧栏建议包含：

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

MVP 阶段可先实现：

```text
AI生成
大纲
角色
事件
检查
```

---

### 6.5 工作台右侧栏职责

右侧栏只负责“调用和选择”，不负责复杂资产管理。

应该在工作台显示：

- 当前章节
- 目标字数
- 当前风格方案
- 当前输出控制方案
- 本章出场角色
- 本章剧情事件
- 生成按钮
- 重生成按钮
- 润色按钮
- 检查按钮
- 确认采用按钮

不应该在工作台堆放：

- TXT 风格文件导入
- JSON 风格配置导入
- 完整风格画像编辑
- 完整输出控制方案编辑
- 大规模角色库管理
- 大规模世界设定管理

这些应放在主界面、作品详情页或专门管理页面。

---

## 7. AI 功能开发规则

### 7.1 AI 不是单个生成按钮

AI 功能必须按任务类型拆分，不得所有功能共用一个混乱提示词。

AI 任务类型包括：

- 世界设定整理
- 规则体系整理
- 主角设定整理
- 风格分析
- 分卷大纲扩展
- 章节大纲生成
- 候选角色生成
- 候选事件推理
- 章节正文生成
- 章节正文重生成
- 当前稿修改
- 正文润色
- 质量检查
- 章节总结
- 上下文更新

---

### 7.2 AI 输出不得直接成为正式正文

章节正文生成后必须先保存为草稿。

流程：

```text
AI 生成正文
↓
保存为草稿 / AI 初稿
↓
用户查看和修改
↓
用户选择重生成、润色或保存
↓
用户点击确认采用
↓
正式写入章节正文
↓
触发章节总结和上下文更新
```

禁止：

```text
AI 输出后直接覆盖正式章节
AI 输出后自动参与下一章上下文
AI 输出后不保留版本记录
```

---

### 7.3 提示词模板管理规则

所有提示词模板放入：

```text
prompts/
```

React 组件不得硬编码大段提示词。

推荐服务：

```text
src/services/prompt/
├─ promptTemplateLoader.ts
├─ promptRenderer.ts
├─ promptContextBuilder.ts
└─ promptRegistry.ts
```

推荐 AI 服务：

```text
src/services/ai/
├─ aiClient.ts
├─ aiTaskRunner.ts
├─ aiTaskRecordService.ts
└─ aiResultParser.ts
```

---

### 7.4 AI 任务记录规则

每次 AI 调用必须记录：

- 任务类型
- 所属作品
- 所属章节
- 输入摘要
- 使用模型
- 任务状态
- 输出结果
- 错误信息
- 创建时间
- 完成时间

不得记录：

- API Key
- 用户私密密钥
- 未脱敏的配置文件路径

---

### 7.5 AI 调用失败处理

AI 调用失败时，界面必须明确提示，不得静默失败。

常见错误：

- API Key 未配置
- 网络失败
- 模型返回为空
- JSON 解析失败
- 上下文过长
- 请求超时
- 额度不足
- 模型拒绝

对于 JSON 解析失败，可以允许一次格式修复重试，但不得无限循环重试。

---

## 8. 数据开发规则

### 8.1 数据以小说作品为核心

数据库设计必须围绕小说作品展开，而不是围绕世界项目。

核心实体：

- 小说作品
- 分卷
- 章节
- 章节草稿
- 世界背景
- 规则体系
- 主角设定
- 角色库
- 角色状态
- 大纲
- 章节事件
- 风格方案
- 输出控制方案
- 章节总结
- 上下文记录
- 提示词模板记录
- AI 任务记录

---

### 8.2 MVP 阶段优先表

MVP 阶段优先实现：

```text
novels
volumes
chapters
chapter_drafts
world_settings
rule_systems
protagonists
style_profiles
output_profiles
ai_task_records
```

暂缓复杂表：

```text
character_states
foreshadowing_records
context_packages
quality_reports
revision_suggestions
```

这些等章节生成闭环稳定后再加。

---

### 8.3 数据状态规则

章节状态建议：

```text
not_started
outline_ready
draft_generated
editing
adopted
summarized
```

草稿状态建议：

```text
ai_generated
user_edited
polished
discarded
adopted
```

AI 任务状态建议：

```text
pending
running
success
failed
cancelled
```

---

## 9. 风格方案与输出控制规则

### 9.1 风格导入不放在工作台

TXT / JSON 导入、风格分析、输出控制方案编辑应在主界面或作品详情页完成。

工作台只选择已有方案。

---

### 9.2 TXT 导入规则

TXT 导入用于分析抽象风格，不用于长期复制原文。

正确流程：

```text
导入 TXT
↓
AI 分析风格画像
↓
用户确认 / 修改
↓
保存为风格方案
↓
工作台调用风格方案
```

禁止：

- 每次生成时塞入完整 TXT 原文
- 要求 AI 模仿某个作者
- 复制原文句子
- 复刻原文人物、桥段、设定、专有名词

---

### 9.3 JSON 导入规则

JSON 导入用于读取标准输出控制配置。

导入时必须校验字段合法性。

不合法时应提示：

- 缺少必要字段
- 字段类型错误
- 比例范围错误
- 无法识别的配置项

---

## 10. 角色与事件开发规则

### 10.1 角色生成规则

角色不要求用户提前填完整。

正确流程：

```text
AI 根据世界背景、规则体系、章节大纲生成候选角色
↓
用户选择
↓
被选择角色进入已生成角色库
↓
第二次出场时调用已有角色资料
```

角色库应保存：

- 姓名
- 身份
- 与主角关系
- 当前目标
- 性格限制
- 行为边界
- 不能做出的行为
- 已出场章节
- 当前状态

禁止第二次出场时重新随机生成同一角色。

---

### 10.2 事件生成规则

事件不是 AI 随便决定，而是 AI 基于大纲推理多个可选事件。

正确流程：

```text
读取分卷大纲
读取当前章节大纲
读取上一章总结
读取当前角色状态
AI 生成多个候选事件
用户选择本章必须发生事件
系统转化为正文生成提示词
```

未被用户选择的候选事件不得作为已发生事实写入正文。

---

## 11. Git 与 GitHub 规则

### 11.1 GitHub 仓库

推荐仓库名：

```text
ai-novel-studio
```

本地路径：

```text
F:\ai-novel-studio
```

建议开发初期使用 private 仓库。

---

### 11.2 每次开发前必须检查

每次让 Agent 修改代码前，必须执行：

```powershell
cd "F:\ai-novel-studio"
git status
```

要求：

- 明确当前分支
- 明确是否有未提交修改
- 未提交修改必须先说明
- 不允许在不清楚状态时大规模改代码

---

### 11.3 每个版本必须提交

每完成一个稳定版本，必须执行：

```powershell
git status
git add .
git commit -m "feat: complete v0.x.x ..."
git tag v0.x.x
git push origin main
git push origin v0.x.x
```

标签格式：

```text
v0.1.0
v0.2.0
v0.3.0
...
v1.0.0
```

---

### 11.4 禁止提交的内容

`.gitignore` 必须排除：

```text
node_modules/
dist/
build/
target/
src-tauri/target/
.env
.env.local
*.log
*.db
*.sqlite
.project_backups/
.DS_Store
```

禁止提交：

- API Key
- `.env.local`
- 本地数据库
- 打包输出目录
- node_modules
- Rust target 目录
- 用户私人小说正文测试文件
- 大型临时文件

---

### 11.5 本地备份规则

重要版本除 GitHub 备份外，可以在本地建立：

```text
F:\ai-novel-studio\.project_backups\
```

该目录必须加入 `.gitignore`。

备份命名建议：

```text
ai-novel-studio-v0.1.0-YYYYMMDD-HHMM.zip
```

---

## 12. 版本路线规则

### 12.1 推荐版本路线

```text
v0.1.0：桌面壳与首页
v0.2.0：作品详情与基础设定
v0.3.0：分卷与章节管理
v0.4.0：写作工作台 UI
v0.5.0：AI 正文生成闭环
v0.6.0：风格方案与输出控制
v0.7.0：角色与事件辅助
v0.8.0：上下文总结
v0.9.0：质量检查与润色
v1.0.0：可正式写长篇的基础版
```

---

### 12.2 版本完成标准

每个版本完成后必须有完成汇报，包含：

```text
一、版本与分支
二、本次目标
三、新增文件
四、修改文件
五、功能完成情况
六、测试结果
七、Git 提交与 tag
八、已知问题
九、下一步建议
```

---

## 13. 测试与验证规则

### 13.1 每次修改后至少验证

根据当前阶段执行：

```powershell
npm install
npm run dev
npm run build
npm run tauri dev
```

若项目已加入测试，则执行：

```powershell
npm test
```

或项目实际定义的测试命令。

---

### 13.2 UI 验证

UI 修改后必须检查：

- 首页是否正常显示
- 左侧导航是否可点击
- 顶部栏是否正常
- 作品卡片是否正常
- 工作台三栏布局是否正常
- 右侧栏是否可展开 / 收回
- 中间正文区是否未被右侧栏挤压变形
- 窗口缩放时布局是否可用

---

### 13.3 功能验证

AI 相关功能修改后必须检查：

- 未配置 API Key 时是否有提示
- AI 调用成功时是否保存任务记录
- AI 调用失败时是否显示错误
- 生成结果是否先保存为草稿
- 用户确认后是否才采用
- 重生成是否保留原草稿版本

---

## 14. 安全与隐私规则

### 14.1 API Key

API Key 规则：

- 不得写入代码
- 不得提交 GitHub
- 不得写入文档示例中的真实值
- 不得显示完整 key
- 设置页只能显示脱敏结果

示例：

```text
sk-****abcd
```

---

### 14.2 用户小说内容

用户导入或生成的小说正文属于用户创作内容。

默认规则：

- 不上传到非必要服务
- 不写入日志
- 不作为测试样例提交 GitHub
- 不放入公开文档
- 不作为默认示例数据

---

### 14.3 日志

日志可以记录：

- 错误类型
- 调用时间
- 任务类型
- 状态
- 简短错误信息

日志不得记录：

- API Key
- 完整隐私正文
- 用户私密路径
- 大段完整提示词中的私人内容

---

## 15. Copilot / Agent 使用规则

### 15.1 Agent 开发前必须读取文档

Agent 每次开发前应读取：

```text
docs/product-design.md
docs/ui-reference.md
docs/data-model.md
docs/prompt-system.md
docs/development-rules.md
.github/copilot-instructions.md
```

至少确认本次任务涉及的相关文档。

---

### 15.2 Agent 不能随意扩大范围

Agent 不得在完成当前任务时顺手大规模重构无关模块。

例如：

当前任务是首页 UI，则不得同时改：

- AI 服务
- 数据库结构
- 提示词模板
- 打包配置
- GitHub workflow

除非任务书明确要求。

---

### 15.3 Agent 必须解释修改

完成后必须输出：

```text
修改了哪些文件
为什么修改
如何运行
如何验证
是否已提交 Git
是否已推送 GitHub
是否有 tag
```

---

### 15.4 Agent 不得做的事情

禁止 Agent：

- 删除 docs 设计文档
- 删除 prompts 模板
- 删除 Git 历史
- 重置仓库
- 强制 push
- 提交 API Key
- 将 UI 改成普通后台
- 把所有代码写进一个文件
- 把所有提示词写进组件
- 未经确认改变技术栈
- 未经确认引入大型依赖
- 未经确认改项目目录结构

---

## 16. 代码质量规则

### 16.1 组件拆分

单个组件不应过大。

建议：

- 页面组件负责布局
- 子组件负责具体区域
- 服务层负责数据和 AI
- 类型文件负责数据结构
- 样式文件负责视觉表现

避免出现：

```text
一个 App.tsx 写完所有页面、状态、AI 调用、样式和数据处理
```

---

### 16.2 命名规则

推荐命名：

```text
Novel
Volume
Chapter
ChapterDraft
WorldSetting
RuleSystem
Protagonist
Character
StyleProfile
OutputProfile
AiTaskRecord
PromptTemplate
```

文件名建议：

```text
NovelCard.tsx
WritingWorkspace.tsx
RightDock.tsx
ChapterTree.tsx
EditorPane.tsx
AiGeneratePanel.tsx
```

---

### 16.3 注释规则

代码需要适量注释，尤其是：

- AI 任务调度
- 提示词组装
- 数据库迁移
- 章节采用逻辑
- 上下文更新逻辑
- 右侧栏展开 / 收回逻辑

不需要对非常简单的 HTML / JSX 逐行注释。

---

## 17. 数据库迁移规则

SQLite 数据结构一旦开始投入使用，后续修改表结构必须考虑迁移。

建议建立：

```text
src/services/database/migrations/
```

每次结构变化新增迁移文件，不直接粗暴删除旧表。

MVP 初期可以简单初始化表结构，但从 v0.5.0 开始应逐步规范迁移。

---

## 18. 设置中心规则

设置中心后期应至少包含：

- AI 模型设置
- API Key 设置
- 默认模型选择
- 默认目标字数
- 默认风格方案
- 本地数据位置
- 导出位置
- 界面显示
- 日志与诊断
- 关于软件

设置页不得只包含 AI Key。

---

## 19. 导入导出规则

### 19.1 导入

支持方向：

- TXT 小说正文导入
- TXT 风格参考导入
- JSON 风格配置导入
- JSON 作品备份导入

导入时必须区分用途：

```text
TXT 正文导入 ≠ TXT 风格参考导入
JSON 风格配置 ≠ JSON 作品备份
```

---

### 19.2 导出

后续支持：

- TXT 导出
- Markdown 导出
- JSON 作品备份
- Word / Docx 导出

导出时不得包含：

- API Key
- 本地绝对隐私路径
- 未脱敏模型密钥
- 不必要的日志

---

## 20. 完成汇报模板

每个版本完成后，Agent 应按以下格式汇报：

```markdown
# v0.x.x 完成汇报

## 一、版本与分支
- 当前分支：
- 当前版本：
- Git tag：
- GitHub 推送状态：

## 二、本次目标
- 目标 1：
- 目标 2：
- 目标 3：

## 三、新增文件
- 文件 1：
- 文件 2：

## 四、修改文件
- 文件 1：
- 文件 2：

## 五、功能完成情况
| 功能 | 状态 | 说明 |
|---|---|---|
|  |  |  |

## 六、测试与验证
- 命令：
- 结果：

## 七、已知问题
- 问题 1：
- 问题 2：

## 八、下一步建议
- 建议 1：
- 建议 2：
```

---

## 21. 开发前检查清单

每次开始开发前检查：

```text
1. 是否在 F:\ai-novel-studio
2. git status 是否干净
3. 是否确认当前版本目标
4. 是否阅读 docs 相关文档
5. 是否确认不修改无关模块
6. 是否确认 API Key 不会提交
7. 是否确认本次任务可运行验证
```

---

## 22. 开发后检查清单

每次开发结束后检查：

```text
1. npm run dev 是否可运行
2. npm run build 是否通过
3. npm run tauri dev 是否可启动
4. UI 是否符合参考方向
5. 是否没有把大段提示词写入组件
6. 是否没有提交 node_modules
7. 是否没有提交 .env.local
8. git status 是否确认
9. 是否 commit
10. 是否 tag
11. 是否 push GitHub
12. 是否写完成汇报
```

---

## 23. 总结

AI Novel Studio 的开发必须坚持三个核心：

```text
第一，产品上必须围绕“逐章生成小说正文”。
第二，界面上必须像桌面写作软件，而不是网页后台。
第三，工程上必须保持模块清晰、文档先行、版本可回退。
```

后续所有 Copilot / Agent 任务都必须以本文件为开发约束。
