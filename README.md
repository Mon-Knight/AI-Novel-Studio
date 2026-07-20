# AI Novel Studio

> Windows 桌面端 AI 长篇小说创作工作台。用户控制方向，AI 分工生成，章节逐步采用，上下文持续沉淀。

---

## 1. 项目简介

AI Novel Studio 是面向长篇小说创作的 **Windows 桌面端 AI 写作工作台**。

它不是普通聊天机器人，不是网页后台管理系统，也不是一次性生成整本小说的工具。它的核心形态是：

```text
作品管理
→ 世界观 / 角色 / 规则 / 风格 / 事件资产准备
→ 章节写作工作台
→ AI 生成候选
→ 用户编辑、采纳、沉淀上下文
→ 继续下一章
```

长期愿景：**AI Autonomous Creative Platform（AI 自主创作平台）**。

---

## 2. 当前版本与定位

**当前版本：v2.1.2**

**阶段：完整备份与恢复闭环 - 版本化项目备份、SQLite 事务恢复与完整性校验**

v2.1.2 聚焦作品数据的可信备份与恢复：完整项目 JSON 以版本化协议保存 SQLite 作品数据与必要的项目级本地缓存，恢复时导入为新作品并在 SQLite 单事务中验证关联、外键与大文本完整性。SQLite 恢复完成后才恢复补充本地缓存；两者不是跨存储 ACID 事务，补充缓存失败时前端会撤销刚导入的 SQLite 作品。

此前 v1.9.5～v2.1.1 已完成章节工程状态、生成上下文快照、持久生成任务、正文初稿、结构化质检、局部修复、单章质量闭环和正文变更安全门。v2.1.2 不扩展新的 AI 自动写入能力，先确保已有创作资产可以可靠迁移与恢复。

---

## 3. 当前核心能力

- **作品管理**：创建、编辑、删除小说作品，维护封面与基础元数据。
- **世界设定**：维护世界背景、规则体系、主角特殊能力。
- **分卷章节**：管理多卷结构、章节大纲与目标字数。
- **写作工作台**：左侧卷章节树、中间正文编辑区、右侧 AI 控制面板。
- **AI 正文生成**：基于世界设定、角色、事件、风格和上下文逐章生成候选正文。
- **多版本草稿**：AI 初稿、重生成稿、用户编辑稿、润色稿互不覆盖。
- **正文变更安全门**：AI 结果携带固定目标、来源草稿、基础版本 / 哈希与结果 ID；目标或基础正文变化时拒绝静默应用。
- **安全保存与采用**：草稿零行更新视为冲突；正式采用验证草稿归属并在 SQLite 事务中原子切换。
- **角色库**：创建角色、AI 候选推荐、本章出场角色管理。
- **事件辅助**：章节事件规划、AI 推荐事件、必需 / 禁止事件标记。
- **风格控制**：风格方案与输出控制方案管理。
- **上下文总结**：章节采用后沉淀上下文记录，支持后续连续生成。
- **质量检查**：逻辑、设定、角色、连续性、语言、节奏多维度检查。
- **正文润色**：多种润色模式，结果保存为新草稿。
- **导出功能**：章节 / 整本作品导出为 TXT、Markdown；项目 JSON 备份。
- **完整项目备份与恢复**：桌面 SQLite 导出带 `schemaVersion` 的完整项目 JSON；导入为新作品，不覆盖现有作品。
- **设定库 AI 推演**：生成角色、势力、地点、规则候选，用户确认后才写入正式资产。
- **AI 设置**：Mock 模式、API Key 本地管理、模型参数配置。

---

## 4. 快速开始

### 环境要求

- Node.js >= 22.6（`node:test` 需要 Node 内建 TypeScript 类型剔除）
- Rust（仅 Tauri 桌面模式需要）
- Windows 10/11

运行真实桌面 E2E 还需要 `tauri-driver 0.1.5`、Microsoft Edge WebView2 Runtime，以及与 WebView2 主版本一致的 `msedgedriver.exe`。详细安装与版本匹配见 [Windows 桌面 E2E 自动化](docs/technical/desktop-e2e.md)。

### 安装与启动

```powershell
npm install

# 浏览器开发模式
npm run dev

# Tauri 桌面开发模式
npm run tauri dev

# 前端生产构建
npm run build
```

### 构建 EXE

```powershell
npm run tauri build
```

构建产物位于 `src-tauri/target/release/`。

---

## 5. Windows 桌面规格

| 项目 | 规格 |
|------|------|
| 默认窗口 | 1280 × 820 |
| 最小窗口 | 1024 × 700 |
| 最大化 | 支持，UI 自适应 |
| 2K 适配 | 内容宽度受控，阅读 / 表单 / 卡片布局不会无限拉伸 |
| 数据存储 | 桌面模式 SQLite；浏览器开发模式 LocalStorage |

API Key 仅保存在本地，不提交到 Git，也不上传到任何服务端。

---

## 6. 页面与功能入口

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | 作品管理首页 | 作品卡片列表与快捷入口 |
| `/novels/:id` | 作品详情 | 基础设定、大纲、角色、风格、设定推演入口 |
| `/novels/:id/workspace` | 写作工作台 | AI 逐章创作核心工作区 |
| `/novels/:id/outline` | 大纲编辑器 | 分卷与章节大纲编辑 |
| `/novels/:id/setting-suggestions` | 设定库 AI 推演 | 生成并采纳角色、势力、地点、规则候选 |
| `/worlds/:worldId/lore/suggestions` | 设定库 AI 推演兼容入口 | 面向世界设定 ID 的候选推演入口 |
| `/styles` | 风格方案 | 风格方案与输出控制方案管理 |
| `/assets` | 创作资产 | 角色库、设定库与设定推演入口 |
| `/templates` | 模板中心 | 提示词模板管理 |
| `/ai-tasks` | AI 任务记录 | AI 任务历史与状态追踪 |
| `/import-export` | 导入导出 | TXT / Markdown 导入导出与 JSON 备份 |
| `/settings` | 设置中心 | AI 模式、API Key、模型参数 |
| `/coming-soon` | 即将开放 | 未完成能力的统一占位入口 |

---

## 7. AI 模式与模型配置

1. 打开设置中心（`/#/settings`）。
2. 使用 **Mock 模式** 可以在无 API Key 的情况下测试完整工作流。
3. 关闭 Mock 模式后，配置 OpenAI 兼容 API：
   - API Base URL，例如 `https://api.openai.com/v1`
   - API Key，仅保存到本地
   - 模型名称，例如 `gpt-4`、`deepseek-chat`

详细说明见 [docs/user/ai-settings.md](docs/user/ai-settings.md)。

---

## 8. 核心安全规则

- AI 只生成候选、建议或草稿，不自动写入正式数据。
- 用户确认后内容才成为正式数据。
- 所有正文变更必须绑定目标作品、目标章节和基础正文版本 / 哈希。
- 迟到响应、目标切换、版本冲突和当前会话内的重复结果必须被隔离或拒绝，不得重定向到当前编辑器。
- 保存失败不得清除未保存状态；正式采用必须验证草稿归属并保持事务原子性。
- 候选状态必须清晰：待处理、已采纳、编辑后采纳、已废弃。
- AI 不得自动覆盖正文、正稿或用户已确认资产。
- API Key 不得写死进代码或提交到 Git。
- 已有路由和功能必须保留。
- 不在 UI 组件中直接写 SQL 或大量提示词。

---

## 9. 当前版本路线

| 版本 | 内容 |
|------|------|
| v1.7.10 | 已完成：候选设定采纳与测试补齐 |
| v1.7.11 | 已完成：发布收尾、构建产物清理 |
| v1.7.12、v1.7.13、v1.7.20 | 已完成：任务删除、上下文与质量检查链路增强 |
| v1.8.x | 旧规划节点，未形成独立 CHANGELOG 发布记录 |
| v1.9.5～v1.9.7 | 已完成：章节工程、上下文编译与生成任务 |
| v2.0.0～v2.0.3 | 已完成：正文初稿、结构化质检、局部修复与版本管理 |
| v2.1.0 | 已完成：单章质量闭环稳定版 |
| v2.1.1 | 已完成：正文变更安全门 |
| v2.1.2 | **当前：完整备份与恢复闭环** |
| v2.x | 后续：任务恢复、约束验证与 Agent 能力增强 |
| v3.x | Autonomous：Multi-Agent / 自主创作 |

完整历史见 [docs/version-roadmap.md](docs/version-roadmap.md)。

---

## 10. 项目结构

```text
ai-novel-studio/
├─ src/
│  ├─ pages/            # 页面级组件
│  ├─ components/       # 通用 UI 组件
│  ├─ features/         # 业务功能模块
│  ├─ services/         # AI / 数据 / 提示词 / 导出服务
│  ├─ store/            # 状态管理
│  ├─ styles/           # 样式文件
│  ├─ types/            # TypeScript 类型定义
│  ├─ agent/            # Agent Runtime
│  └─ agent-tools/      # Agent Tool Layer
├─ src-tauri/           # Tauri Rust 桌面壳
├─ prompts/             # AI 提示词模板
├─ tests/e2e/           # WebdriverIO Windows 真实桌面 E2E
├─ docs/                # 项目文档
├─ .github/             # GitHub 配置与开发辅助系统
└─ scripts/             # 构建、E2E 运行与验证脚本
```

---

## 11. 测试与构建

```powershell
# Windows 真实 Tauri 启动冒烟测试
npm run test:e2e:smoke

# Windows 真实 Tauri 六个核心 E2E 流程
npm run test:e2e

# 定向复测一个独立桌面场景
npm run test:e2e -- --spec candidate-review-apply

# 全部前端正文安全动态测试（Node 原生 test runner）
npm run test

# 正文变更安全门动态测试
npm run test:workspace-safety

# Rust / SQLite 命令安全测试
cd src-tauri
cargo test
cargo test commands::tests -- --nocapture
cd ..

# TypeScript 类型检查 + 前端构建
npm run build

# 静态文本契约检查（不能替代动态行为测试）
npm run test:setting-suggestions
npm run test:quality-workspace
npm run test:ai-tasks-delete:static

# ESLint 检查
npm run lint

# Rust 编译检查
cd src-tauri
cargo check
cd ..

# 桌面 EXE 完整构建
npm run tauri build

# 项目验证脚本
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1
```

桌面 E2E 每个 suite 先在独立的 `.e2e-tools/target` 中构建一次带 Cargo `e2e` feature 的 Tauri 应用，再为每个 spec 独立启动真实窗口，并分配独立临时 SQLite 与 WebView2 用户目录。固定 fixtures 从空库经 UI 建立场景数据，支持 `--spec` 独立复测；作品保存还用第二个只读 SQLite 连接证明事务已提交且没有重复写入。

测试通过 DOM、`data-testid` 和受限 Tauri IPC 操作，不依赖中文文本、屏幕坐标或截图识别。E2E 构建强制使用 Mock Provider，WebView 在请求前阻断外部网络，Rust AI IPC 再做后端阻断；运行器必须从 `frontend-diagnostics.json` 证明无 console error、未处理异常和外部网络尝试。失败截图只用于诊断，且仅在 WebDriver 会话仍可访问时尽力生成。

详细分层、覆盖范围与静态检查边界见 [docs/technical/testing.md](docs/technical/testing.md)，桌面环境、隔离、失败产物和排障见 [docs/technical/desktop-e2e.md](docs/technical/desktop-e2e.md)。

---

## 12. 当前限制

- v2.1.1 安全门覆盖当前单章正文的目标、版本、保存与采用边界；通用多目标放置和正文锁定模型尚未实现。
- SQLite 与 LocalStorage 无法构成跨存储 ACID 事务；项目级本地缓存恢复失败时，前端会撤销刚导入的 SQLite 作品，撤销失败会明确报告。
- AI 请求仍以完整响应为主；流式输出、可靠网络取消和进程重启后的在途任务恢复尚未完成。
- 大文本全文校验、读取失败恢复与草稿引用之间的端到端原子性仍需后续专项收敛。
- v2.1.1 / v2.1.2 已引入前端与 Rust 动态测试，未发布工作区已接入首批 Windows 真实桌面 E2E；React 组件级并发覆盖和全量页面 E2E 仍不完整。
- 章节切换 Leave Guard 已有桌面 E2E；HashRouter 其他非按钮导航与 Tauri 原生窗口关闭尚未形成完整的可恢复离开保护。
- 产品当前没有崩溃恢复对话框，因此 `recovery-dialog` 和崩溃恢复流程尚未覆盖。
- 当前数据模型没有名为 `Artifact`、`PlacementProposal` 或 `ApplyPlan` 的持久化实体；桌面 E2E 验证现有草稿、AI 任务、目标绑定、基础正文哈希、采用状态和幂等约束，不把不存在的实体宣称为已覆盖。
- 参考小说导入暂未实现。
- 自动风格画像分析暂未实现。
- Multi-Agent 自主创作暂未开放，计划 v3.x。
- 势力库、地点库目前通过世界设定条目承载，后续版本可拆分为独立正式资产模块。

---

## 13. 文档索引

| 分类 | 入口 |
|------|------|
| 用户指南 | [docs/user/](docs/user/) |
| 项目管理 | [docs/project/](docs/project/) |
| 技术文档 | [docs/technical/](docs/technical/) |
| Windows 桌面 E2E | [docs/technical/desktop-e2e.md](docs/technical/desktop-e2e.md) |
| 设计文档 | [docs/design/](docs/design/) |
| 总索引 | [docs/README.md](docs/README.md) |
