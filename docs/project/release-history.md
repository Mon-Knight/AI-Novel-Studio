# 发布历史归档

> 本文档合并了原 `docs/release-notes-v*.md` 的 40 份历史快照；根目录
> [`CHANGELOG.md`](../../CHANGELOG.md) 是当前及未来版本唯一持续维护的变更入口。

历史正文用于追溯当时的范围、验证和已知边界，不代表当前实现状态。每份快照在合并前
记录源文件 SHA-256；为形成可读的单文档层级，仅下移 Markdown 标题层级，并把迁移后失效的
相对链接重定向到同一历史证据，正文内容保持原顺序。

## 维护规则

1. 新版本只在 [`CHANGELOG.md`](../../CHANGELOG.md) 顶部新增版本段落。
2. `npm run version:bump -- X.Y.Z` 只同步版本号并创建 CHANGELOG 骨架，不再创建逐版本文档。
3. 发布工作流从 CHANGELOG 精确提取当前版本段落，生成 GitHub Release 正文和 updater notes。
4. 本归档保持只读；历史勘误追加到 CHANGELOG，不回写归档快照。

## 快照索引

| 版本 | 原文件 | 字节数 | 合并前 SHA-256 |
|------|--------|-------:|-----------------|
| [v3.0.0](#v300) | `release-notes-v3.0.0.md` | 6461 | `3B0D8F14794735E01DF1DE49D0B828E6B5F5CE7AE4AE72C6C31E0777A35B5BC1` |
| [v2.5.0](#v250) | `release-notes-v2.5.0.md` | 3180 | `056E8E92673D0709DD1B8DFEB5FB6B436FBBEDB522DE7D7D3BB4235205ADAD8F` |
| [v2.4.0](#v240) | `release-notes-v2.4.0.md` | 3238 | `02910F397D97DC587A99F98C7C28824C7809B0C3BB2965F61F2B4C82B12CC332` |
| [v2.3.2](#v232) | `release-notes-v2.3.2.md` | 4179 | `4FDBD8004F84C60EFD25E31E791F0B16BE65B6BE9E9B356595105D4CB79AD7CF` |
| [v2.3.1](#v231) | `release-notes-v2.3.1.md` | 4052 | `31E4AC4FF558886B89E9E88729FF1D850EA027D6ADBA6E89598B6746628B072B` |
| [v2.3.0](#v230) | `release-notes-v2.3.0.md` | 4366 | `ED5BF537D949FEB2E8B2AA389B15B41C3D2A88C56D5EDB25EE92C280164F4689` |
| [v2.2.1](#v221) | `release-notes-v2.2.1.md` | 2852 | `26AA5AD4377547563B974B9B1419379D486D941154A3F69F49F5D27DB0B1D378` |
| [v2.2.0](#v220) | `release-notes-v2.2.0.md` | 2872 | `49AC693A486E21AFAB563D571E8B6A7A975B9091F785D0EA0BD7ED41C32D372F` |
| [v2.1.8](#v218) | `release-notes-v2.1.8.md` | 3764 | `A15A4B66A60B9EB46B0DA5E26D8A1E30E4773E7B152D60EBE52000EC9F17A6F0` |
| [v2.1.7](#v217) | `release-notes-v2.1.7.md` | 5474 | `A9EC41F3F786B8A25024884874D00E89C12E3FF897B3022ADB6BFF4A55997CF8` |
| [v2.1.6](#v216) | `release-notes-v2.1.6.md` | 4995 | `0C046001931039AC854B21484F536825100E31E6D79A1CC5EDB4427C3D347C35` |
| [v2.1.5](#v215) | `release-notes-v2.1.5.md` | 4501 | `EB6EFBB20D10F15F0BA916919BF5AE228ADA5B5219F8A2A47C8B88209E042D84` |
| [v2.1.4](#v214) | `release-notes-v2.1.4.md` | 3879 | `6D21B3554073CF17A8BE6F98205AE71D2A1300DC906680C2A583798CD68FA862` |
| [v2.1.3](#v213) | `release-notes-v2.1.3.md` | 6004 | `080BB00BAFE342D81EDC78EA7EF17919BD6FBA0EDDBCC4F2820005A65D23B390` |
| [v1.0.43](#v1043) | `release-notes-v1.0.43.md` | 4566 | `9B4C9E6937B8F6A795E5A53892422E5732997F515F1870CF9809A45EC02D8B52` |
| [v1.0.41](#v1041) | `release-notes-v1.0.41.md` | 2203 | `C2ADCD1EFE508B388F14273F0922594F23D5DC4CE37914A218C3CC8B58EFC72D` |
| [v1.0.39](#v1039) | `release-notes-v1.0.39.md` | 1523 | `B57F1633D08C0EEB8511EBF0ADC7B5EE4ECE8454581709B65FAE5E9EBD1C6171` |
| [v1.0.38](#v1038) | `release-notes-v1.0.38.md` | 1377 | `AEC86F153680FFF225C7CC90383F7220615DBDF3E9B6848660A83FA098230F34` |
| [v1.0.37](#v1037) | `release-notes-v1.0.37.md` | 3125 | `67C30B1A8F2A6648D46730D9EEDF4257773ED042A06B2262B6C648EDA63FC187` |
| [v1.0.36](#v1036) | `release-notes-v1.0.36.md` | 2897 | `E70C47EC86292F098CE73A61A16C37A530B22C05EB494028DC70DADB8A80B24F` |
| [v1.0.34](#v1034) | `release-notes-v1.0.34.md` | 2532 | `2FC56E23F53BF05DA785F7729C5CB520EEB6C66D08FE0273104795270499DC09` |
| [v1.0.33](#v1033) | `release-notes-v1.0.33.md` | 3792 | `8782CBACDE7C4843AC327E5D003F797F04DCE1546267AAF9FE64F5EFC9A3D916` |
| [v1.0.32](#v1032) | `release-notes-v1.0.32.md` | 3588 | `92796ABA71DBFC9F8C0515F319CACF7A181A44E39BAE614730B85FBE3F9EE244` |
| [v1.0.31](#v1031) | `release-notes-v1.0.31.md` | 2772 | `A1386EB7F9E77E1CBF05341575CD9D79A4F67E5B7EF3231D7F0663BCD23D1E79` |
| [v1.0.29](#v1029) | `release-notes-v1.0.29.md` | 2033 | `CE029861BDF51EE0791ABE5D7EA5F5F0D9DAA245CA6230A9F9AF22E07273FE89` |
| [v1.0.28](#v1028) | `release-notes-v1.0.28.md` | 3364 | `DC04A2355F8D6EDDBFEBE2E129CD771EDBA5ECC52C214E0B899370132996B03B` |
| [v1.0.27](#v1027) | `release-notes-v1.0.27.md` | 2243 | `81037E075137BF73FDDDBE8F40AD857DDFA7D4694DD301D97BC29CE5FC51AF52` |
| [v1.0.26](#v1026) | `release-notes-v1.0.26.md` | 2728 | `ADD30A08A4DEDAFD34FC32518000E69FC40C1EA477CFCDFD1DBF4969B660FDCF` |
| [v1.0.25](#v1025) | `release-notes-v1.0.25.md` | 4052 | `30684CC020220BBB6A73B1C6596C0C729792CAA81D0EE77FC54177CBE39189BA` |
| [v1.0.24](#v1024) | `release-notes-v1.0.24.md` | 3676 | `A53A6E1C35BDDA7BCA3DC3C274BBDC9F1EA358C6A06D7935A04A173B603F3AB0` |
| [v1.0.23](#v1023) | `release-notes-v1.0.23.md` | 1156 | `F2F479EF46B29DB9FBCF641C7B1A76471F2528AA1DAD3936803E99828E087D4B` |
| [v1.0.22](#v1022) | `release-notes-v1.0.22.md` | 3758 | `23E5D83E776FE0BE26A2BC857C94165C319D941A2762A082D66A4C5CF34A67C7` |
| [v1.0.21](#v1021) | `release-notes-v1.0.21.md` | 3848 | `D8C3D616B62E7E4313C71B7A4E117A4E39CB59A23CF7EDEAE0A595D47C0D222E` |
| [v1.0.20](#v1020) | `release-notes-v1.0.20.md` | 2184 | `4FAD9014D8C23389FED5875793E3D33108F94E2FF70EB2C437EDB89A2672AA15` |
| [v1.0.19](#v1019) | `release-notes-v1.0.19.md` | 1793 | `11289EC712439C8516502205865497EF1E8C73CACF77D37EFBECB541A3998DB8` |
| [v1.0.18](#v1018) | `release-notes-v1.0.18.md` | 1883 | `95EEB5EE9BD31B6659D4A9BA51A66571D7E0D263B765FCE0B86F477A41ECB67D` |
| [v1.0.17](#v1017) | `release-notes-v1.0.17.md` | 1805 | `7EE5EE57F631FF2B59AE44099220927D39920997A6B6299EA2D780EBBDA452CC` |
| [v1.0.16](#v1016) | `release-notes-v1.0.16.md` | 2013 | `DA9D0AF42EE6A1688511D67F17F7533C3D4CEBC2623E77342AD34469229E8FC3` |
| [v1.0.15](#v1015) | `release-notes-v1.0.15.md` | 2918 | `9F42CD8B3ED764A14638BC7D8EC12FA410463FC3CB782C93955ADF4F19171062` |
| [v1.0.0](#v100) | `release-notes-v1.0.0.md` | 2006 | `7EC7C81989E94B14D4D957689767001FDDF24A24D88E6BB2827BC91BBB71A424` |

---

<a id="v300"></a>
## v3.0.0

> 原标题：AI Novel Studio v3.0.0 Multi-Agent 自主创作闭环
> 原文件：`docs/release-notes-v3.0.0.md`
> 合并前 SHA-256：`3B0D8F14794735E01DF1DE49D0B828E6B5F5CE7AE4AE72C6C31E0777A35B5BC1`


发布日期：2026-07-28

### 版本目标

v3.0.0 将章节六专家评审扩展为可实际使用的长篇自主创作平台：从小说 Brief 生成全书计划，并同时收口可靠取消、真实流式预览、成本硬预算、参考资料与分层风格、混合语义 Memory、跨进程三档调度、多目标事务和势力/地点正式资产。默认流程仍由用户审核；只有显式选择 `full_auto` 且全部冻结门禁通过时才允许自动采用。

### 全书规划

- Plot Planner：生成故事圣经、故事弧和分卷结构。
- Character Evolution：生成角色约束、起止状态和跨章节成长节点。
- World Builder：生成地点、势力、规则、文化、技术和物件事实。
- Conflict Generator：生成冲突参与者、赌注、升级点、高潮和解决章节。
- Pacing Controller：为全书生成阶段节奏与逐章张力曲线。
- Chapter Batch Planner：按卷展开连续章节，支持 12～500 章。

世界、冲突和节奏维度并行生成；章节按卷保存检查点。中断或部分失败后，继续计划只补齐缺失结果。300 章验收计划会生成 5 个故事弧、10 卷和连续第 1～300 章。

### 逐章闭环

```text
生成下一章草稿候选
→ 六专家并行评审
→ accept / revise / regenerate（最多三轮）
→ 保持为未采用候选
→ 用户在写作工作台采用
→ 计划推进到下一章
→ 生成章节总结、人物变化和世界扩展候选
→ 用户确认后写入正式上下文
```

改采不同草稿时，旧章节分析和已确认人物节点会失效；既有章节总结与上下文由正文采用事务标记过期。页面重新打开时会使用权威采用稿恢复遗漏的计划进度和分析任务。

### 六专家评审

- `outline`：情节结构与大纲落实。
- `character`：人物动机和成长一致性。
- `setting`：世界规则和设定一致性。
- `logic`：因果、时间线与信息边界。
- `polish`：语言、视角与节奏表达。
- `quality`：整体完成度和读者体验。

共识同时要求最小成功专家数、接受率和平均分。Rust 会根据原始意见独立复算共识，单个专家失败不会阻塞其他专家，但不足 quorum 不能接受。

### 持久化与备份

- migration 021～023：`multi_agent_sessions / rounds / opinions`。
- migration 024：`autonomous_story_plans`，保存 request hash、revision、完整计划 hash、Agent 运行和逐章状态。
- migration 025～026：参考资料版本库与混合语义 Memory。
- migration 027：跨进程 `book_run / lease / attempt / checkpoint` 与三档调度策略。
- migration 028：多目标事务、势力、地点及九张正式资产/关系表。
- migration 029：应用级全局 AI 请求策略、跨进程 reservation、request-bound 哈希 lease、TTL 回收与幂等结算；不属于单个作品备份。
- 项目备份 schema 9：包含 Multi-Agent、自主计划、参考资料、Memory、scheduler 与正式资产；导入为新作品时重映射全部身份，收敛中断 lease/attempt 并按拓扑恢复地点。
- schema 2～8 继续按各自历史能力兼容。

全书计划只有在用户确认后才会物化。桌面端在同一 SQLite 事务中创建卷、章、角色、世界设定、章节冲突事件和章节角色关系；重放会验证这些目标仍完整一致。

### UI 入口

- 作品详情页：进入“自主创作规划”。
- 自主规划页：编辑 Brief、查看 Agent 进度、审核全书结构并应用计划。
- 逐章执行区：查看采用进度、生成下一章候选，或显式启动/暂停/继续进程内全书候选队列，并确认章节分析。
- 写作工作台“协作”面板：查看六专家历史、轮次、共识和候选草稿。
- 设定库 AI 推演：处理章节产生的地点与规则候选。
- 作品资产中心“势力与地点”：审核正式资产候选、显式批准跨章节子集并查看事务历史。
- 设置中心：手动 Light/Dark/System 主题、AI 速率/预算、脱敏诊断，以及 Stable/Beta 签名更新和回滚入口。

### 安全边界

- 不自动应用全书计划。
- `draft_night` 不采用候选，`quality_gate` 达标后仍需确认；`full_auto` 只有在预算、lease/CAS、六专家阈值和采用前目标复验全部通过时才采用。
- 不在用户确认前把章节分析写入正式上下文。
- 不把世界扩展候选直接写入正式设定库。
- API Key、Provider 原始响应和正文不写入普通协作日志。

### 验证命令

```powershell
npm test
npm run test:all
npm run test:coverage
npm run test:e2e:browser
npm run lint:ci
npm run build
npm run test:version-sync
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

本次 Windows 本地收口结果：

- 前端统一测试 316 项通过；全局覆盖率 lines/statements 34.32%、functions 44.13%、branches 64.05%，核心集合分别为 87.82%、85.89%、82.01%。
- Rust 常规全量测试 217 项通过、0 失败，另 1 项需要外部隔离迁移数据库的用例按设计忽略。
- 真实 Edge 浏览器开发模式 3/3 通过；真实 WebView2/Tauri 桌面 14 套独立 spec 全部通过，包含 StoryAssets 正式势力创建与 reviewed-partial 跨章节事务。
- `tauri:build` 成功生成全新的 v3.0.0 MSI 与 NSIS；普通本地构建不进入签名阶段，签名 MSI updater 由 `tauri:build:release` 和 release workflow 生成。
- 生产依赖 high/critical 门禁与全依赖 critical 门禁通过；剩余 2 个 production moderate 及 36 个 development high 均来自 React Router 6、Vite 5、ESLint 8 与 WDIO 上游约束，升级需在未来技术栈版本中单独处理。

### 当前限制

跨进程 scheduler 已支持无人值守候选和受门禁自动采用，但不是一次性生成整本正文；每章仍独立保存、评审与复验。跨章节正文批量改写不能绕过候选/草稿/采用边界。自动 embedding、固定召回评估集、PDF/EPUB、模型自主 Tool Calling、Provider 账单对账和跨平台桌面发布仍属于后续增强。

应用内更新只在签名 release workflow 注入公钥后启用；普通本地构建保持显式未配置状态，不携带私钥。当前 Tauri 1 Windows 发布格式为 MSI 与 `.msi.zip` updater。

Mock 模式用于确定性流程与 UI 验收，不代表真实模型的文学质量。真实 API 模式复用用户本地 Provider 配置，自动化测试不会读取 API Key 或发起付费请求。

---

<a id="v250"></a>
## v2.5.0

> 原标题：AI Novel Studio v2.5.0 发布说明
> 原文件：`docs/release-notes-v2.5.0.md`
> 合并前 SHA-256：`056E8E92673D0709DD1B8DFEB5FB6B436FBBEDB522DE7D7D3BB4235205ADAD8F`


发布日期：2026-07-26
主题：Chapter Readiness Planner Runtime

### 核心变化

v2.5.0 交付首个正式、持久、可恢复的产品内 Planner：`chapter_readiness_plan_v1`。它在写作工作台中依次读取作品上下文、章节大纲、章节上下文、风格方案与输出控制，最后通过 `verification.check_readiness@1` 输出准备度、缺失项与建议摘要。

整个计划只调用本地只读工具，不调用 AI Provider，不生成或修改正文。用户仍决定是否补齐信息以及何时进入正文生成。

### 持久执行与恢复

- Plan、六个 Step、八条依赖、每次 Attempt、execution lease 与 Checkpoint 全部保存到 SQLite。
- Plan 创建使用 `operationId + requestHash` 幂等；Step 冻结 Registry/schema/权限/scope/参数 hash。
- 每个 Plan 同时最多一个活动 lease；明文 token 只存在于 Executor 内存，SQLite 仅保存 SHA-256。
- 工具失败形成一个 failed Attempt 并进入 `waiting_retry`，不自动重试。
- 应用重启把 running Attempt 标为 `abandoned`，Plan/Step 恢复为 `waiting_retry`，活动 lease 标为 `expired`；用户必须明确点击继续。
- 浏览器开发模式不使用 LocalStorage 伪造持久 Planner。

### Tool Registry

生产 Registry 新增 `verification.check_readiness@1`，工具总数从八个增至九个，当前 hash 为：

```text
846a38c25bba33c843b56fa6583b334bae3364073fb7f0b6290be0c405aae871
```

所有工具仍为只读或本地验证；生产 Provider 策略继续保持 `allowedTools=[]`，模型不能自主调用工具。

### 工作台体验

AI 生成面板顶部新增紧凑“章节准备计划”卡片：

- 创建并检查；
- 展示六步进度与持久状态；
- completed 后显示准备度分数、摘要和缺失项；
- waiting_retry 时解释不会自动重放，并提供明确继续按钮；
- 终态可重新创建一次独立检查。

### 验证摘要

- Planner / Registry 专项：8/8。
- `npm test`：Node 16/16，tsx 67/67。
- Rust / SQLite：143/143，另 1 项真实隔离数据库迁移测试按设计 ignored。
- TypeScript + Vite production build：通过，236 modules。
- Windows Tauri E2E：13/13 独立桌面 spec 通过；Planner 2/2，既证明六个本地 Tool 各执行一次、SQLite 事实可读且外网请求为 0，也证明真实重启后不自动重放、显式继续产生 Attempt 2、再次重启不新增历史。
- 本版没有修改 Prompt、Provider messages 或 Provider Adapter，因此未调用真实 API。

### 安装包

| 产物 | 大小 | SHA-256 |
|------|------|---------|
| `AI Novel Studio_2.5.0_x64_en-US.msi` | 6,656,000 bytes（6.35 MiB） | `2c83cf3cabf391e63b00385430331ad3a43380473e5a62ebd317bede038ad9ba` |
| `AI Novel Studio_2.5.0_x64-setup.exe` | 4,771,641 bytes（4.55 MiB） | `639e6feb8ec7c86bae41c04fb0d9614ffc4be6eafbc380a7aecaf163ceabf19f` |

### 版本边界

v2.5.0 不实现长期 Memory、正文生成/应用副作用、动态 Planner、自动重试/续跑、Multi-Agent 或 Agent 自主写入。下一阶段按独立 v2.6.x 版本进入 Memory、连续性与受审核单 Agent 章节闭环。

---

<a id="v240"></a>
## v2.4.0

> 原标题：AI Novel Studio v2.4.0 发布说明
> 原文件：`docs/release-notes-v2.4.0.md`
> 合并前 SHA-256：`02910F397D97DC587A99F98C7C28824C7809B0C3BB2965F61F2B4C82B12CC332`


发布日期：2026-07-26
主题：Context / Constraint Compiler 与 Tool Registry

### 核心变化

v2.4.0 将首批生产 AI 请求升级为正式编译协议。连接测试和“设定补充”从 SQLite/request 来源、独立 Prompt 模板、固定预算、Provider identity 与工具策略生成同一份 `compiled_ai_execution_v1`；实际 Provider messages 与三类 Snapshot 不再由调用方分别拼接。

Context Snapshot 现在记录稳定来源 manifest、缺失来源、原文与包含片段 hash、确定性截断状态和完整预算。Constraint Snapshot 记录 Artifact/response schema、业务约束、Prompt identity、Provider options 和 Tool Registry identity。Rust 在 Task 创建前复算这些关系，任何篡改都失败关闭。

### Tool Registry

本版注册八个真实工具：作品上下文/设定、章节大纲/上下文、风格/输出控制读取，以及大纲/风格本地验证。所有生产工具都是只读或本地验证，具备冻结 schema、权限、scope、超时与 side-effect 声明。

当前连接测试和设定补充的 `allowedTools=[]`，模型不能调用工具。未来副作用工具即使携带调用方确认字段，也必须由定义方复验持久 ApplyPlan；本版没有新增业务写入工具。

### 安全与兼容性

- API Key 与 Base URL 仍只存在于瞬时 Provider Adapter 配置，不进入 Snapshot、Artifact 或普通日志。
- Rust 按生产 taskType 强制正式编译，不能通过改写预期 Artifact 绕过。
- Prompt 模板 hash 与 Registry hash 在 TypeScript/Rust 两侧冻结。
- 跨电脑排序不依赖区域设置；规则来源用 `createdAt + id` 稳定排序。
- 没有数据库 migration；既有 schema v1 Snapshot 仍可读，新入口创建 schema v2 Snapshot。
- v2.3.2 Safe Apply 的显式用户确认、事务副作用和重放边界保持不变。

### 验证摘要

- Compiler / Provider / Registry 专项：18/18。
- `npm test`：Node 16/16，tsx 64/64。
- Rust / SQLite：139/139，另 1 项真实隔离数据库迁移测试按设计 ignored。
- ESLint：0 error，保留 1 条既有 React Hooks warning。
- TypeScript + Vite production build：通过，231 modules。
- Windows Tauri 完整 E2E：12/12 独立桌面场景通过。
- 单次 8-token 真实 API 连接测试：Provider 返回空内容，形成一个不可重试 failed Attempt 和零 Artifact；没有重试，也没有用 Mock 替代。

### 安装包

| 产物 | 大小 | SHA-256 |
|------|------|---------|
| `AI Novel Studio_2.4.0_x64_en-US.msi` | 6,529,024 bytes（6.23 MiB） | `a56538eaf7bf37b03b84c6e96e07f96893511e1cf3078254788fa5354fe1f8fe` |
| `AI Novel Studio_2.4.0_x64-setup.exe` | 4,684,329 bytes（4.47 MiB） | `d3c289a5a178d5bf868ee2c4b0ae5eb440681f1465d260094442ae222a40c981` |

完整证据见 [`audit/phase-3/11-v2.4.0-compiler-tool-registry-acceptance.md`](../audit/phase-3/11-v2.4.0-compiler-tool-registry-acceptance.md)。

### 版本边界

v2.4.0 不实现 Planner、execution lease、checkpoint、自动续跑、跨重启计划恢复、长期 Memory、Agent Tool Calling、Multi-Agent 或 Agent 自主写入。下一阶段按独立 v2.5.x 版本进入 Planner 与可靠恢复链路。

---

<a id="v232"></a>
## v2.3.2

> 原标题：AI Novel Studio v2.3.2 发布说明
> 原文件：`docs/release-notes-v2.3.2.md`
> 合并前 SHA-256：`4FDBD8004F84C60EFD25E31E791F0B16BE65B6BE9E9B356595105D4CB79AD7CF`


发布日期：2026-07-26
阶段：Safe Apply 单目标安全应用

### 本版完成

v2.3.2 首次把只读 AI Artifact 接入正式业务数据的受控应用边界。`setting_candidates@1` 中每条有效候选会建立不可变 PlacementProposal 和等待确认的 ApplyPlan；用户点击确认前不写正式设定，确认后只在一个 SQLite 事务中创建一条世界设定、ArtifactTargetLink 并完成 Plan。

关键能力：

- Proposal 绑定 Artifact、候选 index/hash、预分配 targetId、目标 version/hash 和唯一 create effect。
- ApplyPlan 身份/effect 不可变，状态只允许 awaiting → applying → applied/conflict。
- 用户确认身份和时间进入持久事实；AI 不能绕过 UI 直接声明已确认。
- world_setting、TargetLink 与 Plan applied 同事务提交，任一步失败整体回滚。
- 相同 operationId/planHash 重放返回首次目标，不重复创建副作用。
- 目标 ID 碰撞进入 conflict，不覆盖已有数据。
- applied 重放重新校验完整目标 hash；目标修改、删除或来源异常时失败关闭。
- 浏览器 ephemeral 候选不伪造 Proposal/Plan/Link，也不显示正式采用按钮。

### 数据库迁移

新增迁移：

| ID | 作用 | SHA-256 checksum |
|----|------|-----------------|
| `012_placement_proposals` | 不可变候选到目标提案 | `44e81ec6116531691a4e6232e1f41889e0d40328ab3df735eeb48b1c470b937a` |
| `013_apply_plans` | 用户确认、状态边与单目标副作用计划 | `d4b213d255d1626648e42e672ffe50fe94793e3b027c406b397fa5a060b634e1` |
| `014_artifact_target_links` | Artifact 到正式目标的不可变来源链接 | `168fb1e5d289cd1a1fd0b4fdc01e2e229c54d7634762130789412d190207a4f0` |

迁移只增加表、索引和触发器，不改变既有 `world_settings` 或其他业务表形状。

### 版本边界

本版本只支持一条 `setting_candidates` 候选创建一条 `world_setting`。不实现 update/delete、批量或多目标 effect，不迁移其他生产 AI 入口，也不实现 Tool Registry、Planner、Memory、自动续跑、Multi-Agent 或 Agent 自主写入。

### 主要实现文件

- `src-tauri/src/domain/placement.rs`
- `src-tauri/src/repositories/placement_repository.rs`
- `src-tauri/src/services/placement_service.rs`
- `src-tauri/src/commands/placements.rs`
- `src/services/placements/placementRuntimeService.ts`
- `src/types/placement.ts`
- `src/components/right-dock/panels/SettingPanel.tsx`
- `tests/e2e/provider-pipeline-setting.spec.ts`
- `docs/architecture/safe-apply.md`

### 验证

- Node：16/16；tsx：53/53。
- Rust / SQLite：137/137，另 1 项真实用户数据库隔离副本测试按设计 ignored。
- ESLint：0 error，保留 1 条既有 React Hooks warning。
- TypeScript + Vite production build：通过，215 modules。
- Windows Tauri 完整 E2E：12/12；全部使用隔离 SQLite、Mock Provider、外网阻断和进程清理。
- Safe Apply 桌面 E2E：3 个 Proposal + 3 个 awaiting Plan；确认前正式设定不变，确认后仅 1 个 world_setting + 1 个 TargetLink；同 operation 重放数量保持不变。
- Tauri production build：通过，生成 MSI 与 NSIS。
- 版本同步、局部 rustfmt、凭据扫描和 `git diff --check`：通过。

本版本没有修改 Provider 网络协议、Prompt 或请求参数，因此没有再次调用真实 API。v2.3.1 已记录的一次低输出真实尝试仍是当前事实，不用 Mock 冒充真实 API 成功。

### Windows 发布产物

| 产物 | 大小 | SHA-256 |
|------|------|---------|
| `AI Novel Studio_2.3.2_x64_en-US.msi` | 6,488,064 bytes（6.19 MiB） | `7021db4d91b18ab9ccb1e185c84cbcf8733a1714cdbf0225d3487e7ccf83ef9f` |
| `AI Novel Studio_2.3.2_x64-setup.exe` | 4,654,131 bytes（4.44 MiB） | `32ecb5e54c3a7212b94664e0c084fda90a14743a88ed289ecc9f6ae472398017` |

完整验收证据见 [`audit/phase-3/10-v2.3.2-safe-apply-acceptance.md`](../audit/phase-3/10-v2.3.2-safe-apply-acceptance.md)。

### 下一阶段

v2.4.x 将实现正式 Context / Constraint Compiler 与 Tool Registry，为 Planner 提供可复现来源、预算、schema、权限和副作用边界。

---

<a id="v231"></a>
## v2.3.1

> 原标题：AI Novel Studio v2.3.1 发布说明
> 原文件：`docs/release-notes-v2.3.1.md`
> 合并前 SHA-256：`31E4AC4FF558886B89E9E88729FF1D850EA027D6ADBA6E89598B6746628B072B`


发布日期：2026-07-26
阶段：Provider Adapter 与统一执行管线

### 本版完成

v2.3.1 首次把生产 AI 调用接到 v2.3.0 执行事实层。设置中心连接测试与“设定补充”现在使用同一 Provider Adapter；桌面端每次执行都会形成 Task、三类 Snapshot、Attempt、Provider 响应身份和 ResultArtifact。

关键能力：

- Provider 网络调用最多派发一次；数据库提交未知只重放幂等 IPC。
- 已完成 operation 重放直接读取首次 Artifact，不再次消耗 Provider 额度。
- 继续复用现有 Tauri HTTP 超时、Abort 与迟到响应隔离。
- API Key 与 Base URL 不进入任何持久事实、普通日志或 E2E 产物。
- Tauri 字符串形式的 Provider 失败保留已脱敏消息；鉴权/权限错误和请求参数拒绝不再误分类为可重试网络错误。
- 浏览器开发回退不伪造 LocalStorage Task / Artifact。
- 连接测试只允许 `OK`，最大输出为 8 tokens。
- 设定补充只生成候选；未点击确认前，正式设定数据保持不变。

### 版本边界

本版本只迁移两个入口，不修改 SQLite schema，也不迁移质量检查、正文生成、润色、总结或大纲 Provider 流程。未实现 Placement / ApplyPlan、自动正式写入、Planner、Memory、Tool Registry、自动续跑或 Multi-Agent。

### 主要实现文件

- `src/services/ai/providerAdapter.ts`
- `src/services/ai/aiExecutionPipeline.ts`
- `src/services/ai/aiExecutionPipeline.test.ts`
- `src/services/ai/aiSettingsService.ts`
- `src/services/ai/settingExpandService.ts`
- `tests/e2e/provider-pipeline-setting.spec.ts`
- `docs/architecture/provider-execution-pipeline.md`

### 验证

- Provider 管线定向：7/7。
- Node：16/16；tsx：51/51。
- Rust / SQLite：133/133，另 1 项隔离外部数据库测试按设计 ignored。
- ESLint：0 error，保留 1 条既有 React Hooks warning。
- TypeScript + Vite production build：通过。
- Windows Tauri Provider 管线 E2E：1/1。
- Windows Tauri 完整 E2E：12/12；全部使用隔离 SQLite、Mock Provider、外网阻断和进程清理。
- 四组补充门禁：质量工作台、设定建议、AI Task 删除 2/2、项目备份 5/5 全部通过。
- Tauri production build：通过，生成 MSI 与 NSIS。
- 版本同步、生产凭据扫描与 `git diff --check`：通过。

#### 真实 API 手动验收

按约束只发起一次连接测试，没有重试：

- system Task，预期 `generic_text@1`；Constraint 记录 `maxTokens = 8`。
- 创建三类 Snapshot 和 1 个 Attempt；Provider 返回失败，Task / Attempt 均安全终结为 `failed`，Artifact 数量为 0。
- 持久事实中未出现 API Key、Authorization、Bearer、Base URL 或 DeepSeek 风格密钥标记。
- 本机 DNS/TCP 443 连通；DeepSeek 官方文档确认当前 Base URL 与 `deepseek-v4-pro` 模型标识有效。
- 本次失败暴露出旧错误字符串会丢失分类信息，代码已补充稳定鉴权/请求拒绝映射及无外网回归测试；为遵守单次调用限制，没有再次请求 Provider。

因此 PA-REAL 如实记录为**未通过**，不使用 Mock 结果替代；其余自动化与桌面 Provider 事实链路全部通过。

### Windows 发布产物

| 产物 | 大小 | SHA-256 |
|------|------|---------|
| `AI Novel Studio_2.3.1_x64_en-US.msi` | 6,443,008 bytes（6.14 MiB） | `1ce93749a9623da1145c9152e5a080deafddcd6deda7d873c61e8961403ee6c2` |
| `AI Novel Studio_2.3.1_x64-setup.exe` | 4,616,914 bytes（4.40 MiB） | `8938e4c3e5e8897311a5d7e2c93a4d16e5ab1ea40f3933a1ace18988337ce390` |

完整验收证据见 [`audit/phase-3/09-v2.3.1-provider-pipeline-acceptance.md`](../audit/phase-3/09-v2.3.1-provider-pipeline-acceptance.md)。

### 下一阶段

v2.3.2 将建立 PlacementProposal、ApplyPlan 与 ArtifactTargetLink，使候选结果在用户确认、目标 version/hash 校验和幂等副作用保护下安全进入正式业务数据。

---

<a id="v230"></a>
## v2.3.0

> 原标题：AI Novel Studio v2.3.0 发布说明
> 原文件：`docs/release-notes-v2.3.0.md`
> 合并前 SHA-256：`ED5BF537D949FEB2E8B2AA389B15B41C3D2A88C56D5EDB25EE92C280164F4689`


发布日期：2026-07-26
阶段：Agent 执行事实层 M1

### 本版完成

v2.3.0 建立后续 Agent 化与 Multi-Agent 共用的持久执行事实基础。新增 Task、Attempt、三类 Snapshot、ResultArtifact 和 ValidationIssue，使一次 AI 执行的目标、输入、上下文、约束、Provider 响应和校验结果在应用重启后仍可完整追踪和验证。

核心能力：

- Task + Input / Context / Constraint Snapshot 单事务创建。
- Rust canonical requestHash 与 operationId 幂等重放。
- Attempt 联合身份、state revision CAS、单 Task 单 live Attempt。
- queue / claim / success / failure / cancel / late response 的提交未知安全重放。
- Artifact 与 Task 预期契约、Attempt responseHash/length、持久 Input Snapshot 强绑定。
- 完整 raw / display / structured 结果使用大文本分片和 SHA-256 完整性层。
- Snapshot、Artifact、ValidationIssue 及其引用的大文本建立引用后不可篡改。
- Provider options / response metadata 白名单、凭据检测和普通日志正文脱敏。
- 关闭文件数据库后重新打开，可读取完整 Task、Attempts、Snapshots、Artifacts 和 Issues。

### 数据库升级

新增正式 migration：

```text
005_ai_tasks
006_ai_task_attempts
007_ai_input_snapshots
008_ai_context_snapshots
009_ai_constraint_snapshots
010_result_artifacts
011_artifact_validation_issues
```

升级只新增表、索引和触发器：

- 不删除、重命名或改变既有字段类型。
- 不修改 `chapter_drafts` 或 `quality_check_reports` 表形状。
- 不迁移、删除或伪造 `ai_task_records` / `generation_jobs`。
- 旧业务行数、采用指针和完整正文保持不变。
- 重复启动幂等，migration checksum 漂移时拒绝继续。

回退到 v2.2.1 时，旧程序会忽略新表；若需要物理移除新 schema，应恢复升级前数据库备份，不在生产库手工执行 `DROP`。

### 版本边界

本版本没有把现有 AI 面板迁移到新管线，也不包含：

- 生产 Provider Adapter 改造或真实 AI 调用；
- Planner、Memory、Tool Registry、execution lease / checkpoint；
- 自动续跑、Placement / ApplyPlan 或正式正文自动写入；
- Multi-Agent 编排、专业 Agent 或自主逐章创作；
- UI 重做。

因此 v2.3.0 代表“执行事实地基完成”，不代表 Autonomous 或 Multi-Agent 已完成。

### 主要实现文件

- `src-tauri/src/migrations.rs`
- `src-tauri/src/domain/`
- `src-tauri/src/repositories/ai_task_repository.rs`
- `src-tauri/src/repositories/artifact_repository.rs`
- `src-tauri/src/services/ai_fact_security.rs`
- `src-tauri/src/services/ai_task_service.rs`
- `src-tauri/src/services/artifact_service.rs`
- `src-tauri/src/commands/ai_tasks.rs`
- `src-tauri/src/commands/artifacts.rs`
- `src/types/ai-task.ts`
- `src/types/result-artifact.ts`
- `src/services/ai-tasks/aiTaskRuntimeService.ts`
- `docs/architecture/ai-execution-facts.md`

### 验证

- Rust / SQLite 常规全量：133/133。
- 真实用户数据库隔离副本升级：1/1；业务表行数/形状、外键错误数和 integrity 均保持。
- Node：16/16；tsx：44/44。
- ESLint：0 error，保留 1 条既有 React Hooks warning。
- TypeScript + Vite production build：通过。
- Windows Tauri 启动 smoke：1/1；隔离空库迁移到 `011_artifact_validation_issues`，M1 Task / Artifact 初始计数均为 0。
- Windows Tauri 完整 E2E：11/11；全部使用隔离 SQLite、Mock Provider、外网阻断和进程清理。
- Tauri production build：通过，同时生成 MSI 与 NSIS。
- 真实 API：未调用；Provider Adapter 本版本未修改。

安装包：

| 产物 | 大小 | SHA-256 |
|------|------|---------|
| `AI Novel Studio_2.3.0_x64_en-US.msi` | 6,434,816 bytes（6.14 MiB） | `74e584638ba888a69e8ac490b2049d39215f18e56e8842c810c23462e841ab68` |
| `AI Novel Studio_2.3.0_x64-setup.exe` | 4,612,694 bytes（4.40 MiB） | `c2b645b00239bafebb84d0c17b33b264fac560f8ea9d3b8309c45e02e7126ef8` |

完整验收证据见 [`audit/phase-3/08-v2.3.0-m1-acceptance.md`](../audit/phase-3/08-v2.3.0-m1-acceptance.md)。

### 下一阶段

v2.3.1 将接入统一 Provider Adapter：先迁移连接测试和一个只读 AI 入口，并只执行一次低输出真实 API 验收。随后再实现安全 Placement / Apply 边界。

---

<a id="v221"></a>
## v2.2.1

> 原标题：AI Novel Studio v2.2.1 发布说明
> 原文件：`docs/release-notes-v2.2.1.md`
> 合并前 SHA-256：`26AA5AD4377547563B974B9B1419379D486D941154A3F69F49F5D27DB0B1D378`


v2.2.1 是 v2.2.0 的定向可靠性热修，不新增 AI 创作能力。

### 修复内容

- 采用事务在保存前置读取之后提交时，Rust 原子保存以事务内权威状态派生新候选，并通过 `disposition` 向前端证明该 ID 变化合法；编辑器不再把已提交结果误报为失败。
- 冲突恢复候选使用快照身份派生的稳定 operationId；快照删除失败并重进工作区后，会复用相同正文/hash/note 的已提交候选，只重试快照清理。completed replay 返回前会权威重读目标；目标被删除、修改或损坏时拒绝陈旧成功，并保留首次 operation 与恢复快照。
- Tauri `appWindow.close()` 拒绝时撤销一次性 bypass；后续关闭仍进入 Leave Guard，goal-only 路径的拒绝也会被记录和收口。

### 安全边界

- 已采用草稿仍不可原地覆盖；新 ID 只有在后端明确返回 `forked_from_adopted` 且目标、版本、正文 hash、长度与 operationId 全部通过验证时才接受。
- v2.2.0 operation 只在 `disposition` 字段缺失时兼容升级；显式未知或伪造值失败关闭。
- recovery 候选匹配要求作品、章节、固定 note、完整正文和 SHA-256 全部一致。
- 已完成 operation 不会被重新开启或覆盖；replay 目标失效返回 `OPERATION_REPLAY_TARGET_INVALID`，不会用同一 operation 产生第二次副作用。
- 本版本不修改 Provider、Tool Calling 或 Agent handoff，因此不调用真实 AI API。

### 验证

| 命令 | 结果 |
|---|---|
| `npm run lint` | 通过；0 error，保留 1 条既有 React Hooks warning |
| `npm run build` | 通过；211 modules |
| `npm test` | 通过；Node 16/16、tsx 44/44 |
| `npm run test:components` | 通过；5/5 |
| `npm run test:workspace-reliability` | 通过；15/15 |
| `npm run test:workspace-recovery` | 通过；12/12，Rust 111/111 |
| `npm run test:large-text-integrity` | 通过；7/7，Rust 111/111；覆盖采用先提交与保存先提交 |
| `npm run test:migrations` | 通过；1/1，Rust 111/111 |
| `npm run test:workspace-safety` | 通过；5/5 |
| `npm run test:e2e` | 通过；Windows Tauri 11 个独立 spec 全部通过 |
| `npm run tauri:build` | 通过；MSI 与 NSIS 均成功生成 |

安装包：

```text
src-tauri/target/release/bundle/msi/AI Novel Studio_2.2.1_x64_en-US.msi
src-tauri/target/release/bundle/nsis/AI Novel Studio_2.2.1_x64-setup.exe
```

- MSI：6,275,072 bytes；SHA-256 `559A67AC1ABB1CB3A0D5C40E642ACD0C07C2D1D84C9323B6F7ADFC8FF9E225FC`
- NSIS：4,504,591 bytes；SHA-256 `8BDA75FAA8238E688B64BDD11EB65030F90A697C887C085EE9AEC440A8528F44`

验证使用隔离 SQLite、Mock Provider 和独立 WebView2 数据目录，没有调用真实 AI API，也没有读取用户正式数据库。

---

<a id="v220"></a>
## v2.2.0

> 原标题：AI Novel Studio v2.2.0 发布说明
> 原文件：`docs/release-notes-v2.2.0.md`
> 合并前 SHA-256：`49AC693A486E21AFAB563D571E8B6A7A975B9091F785D0EA0BD7ED41C32D372F`


> 版本主题：工作区可靠性与基础设施收口
> 目标平台：Windows Tauri 桌面端

### 核心结果

v2.2.0 在 v2.1.8 的正文、任务、质量历史和章节上下文安全基线上，补齐写作工作区的持久化与桌面生命周期闭环。本版本不扩展 AI 自动写入能力，重点保证长正文、未保存修改、异常退出和数据库故障场景可恢复、可验证。

### 正文原子保存与完整性读取

- 新增 `save_chapter_draft_atomic`，正文、长文本 document/chunks、草稿引用与 operation 结果在同一 SQLite `IMMEDIATE` 事务中提交。
- 相同 `operationId` 与请求哈希可安全重放；相同 operation 携带不同 payload 会被拒绝。
- 已采用草稿保持不可变，继续编辑会创建新候选版本。
- 读取完整正文时校验 document 状态、引用、分片数量和顺序、字符数、字节数、逐片及全文 SHA-256。
- 任一完整性校验失败均进入 `unavailable`，预览不会进入编辑器或 AI 上下文。

### 工作区恢复与离开保护

- 新增按作品和章节隔离的恢复快照，dirty 正文 debounce 持久化，不占用正式草稿版本。
- 基线一致时可恢复到编辑器并保持 dirty；基础草稿、版本或哈希冲突时只允许查看、复制、导出或另存候选。
- 章节切换、创建章节、草稿恢复/采用、Hash 路由、历史导航和 Tauri 窗口关闭共用可防重入的 Leave Guard。
- 保存成功后精确清理当前目标快照；保存失败、离开取消或数据库忙时保留恢复内容。

### 迁移与错误契约

- 新增带固定顺序和 checksum 的 `schema_migrations` 正式迁移账本。
- 新增恢复快照、草稿保存 operation 与长文本完整性迁移；旧数据库和旧正文继续兼容。
- Rust 与 TypeScript 共用结构化 `AppError`，包含稳定错误码、重试属性、traceId、operationId 和脱敏 details。
- checksum 冲突或迁移失败会停止后续启动写入，不伪造历史迁移，也不静默降级到 LocalStorage。

### 验证

- Vitest / React Testing Library 覆盖快速切章、Leave Guard 防重入、保存失败、正文不可用、恢复与冲突处理。
- Rust / SQLite 故障注入覆盖迁移账本、正文事务回滚、幂等重放、损坏读取和恢复快照隔离。
- 保留并通过 v2.1.8 的 Node 正文安全、项目备份、请求取消、质量历史和章节上下文动态回归。
- Windows Tauri E2E 与生产构建继续作为正式发布门禁。

### 版本边界

本版本不实现统一 AI Task / Artifact（含 ResultArtifact）、自动续跑、Planner、Memory、Verification、Multi-Agent 或 Agent 自主写入。浏览器 LocalStorage 仅用于开发回退，不替代桌面 SQLite 事务事实源。

---

<a id="v218"></a>
## v2.1.8

> 原标题：AI Novel Studio v2.1.8 发布说明
> 原文件：`docs/release-notes-v2.1.8.md`
> 合并前 SHA-256：`A15A4B66A60B9EB46B0DA5E26D8A1E30E4773E7B152D60EBE52000EC9F17A6F0`


> 版本主题：章节上下文持久化一致性闭环
> 目标平台：Windows Tauri 桌面端
> 数据结构：无表或字段变更

### 核心结果

v2.1.8 解决章节总结看似保存成功、实际只落到 LocalStorage，或在应用重启后与 SQLite 不一致的问题。桌面模式现在只以 SQLite 为权威；章节总结、上下文记录、角色状态、角色当前状态和章节 `summarized` 终态作为一个业务事务提交。

```text
确认章节总结
-> 校验作品 / 章节 / 已采用草稿 / 角色归属
-> 原子写入总结、上下文和角色状态
-> 更新章节 summarized
-> 提交后返回 SQLite authoritative DTO
```

任何一步失败都会回滚，并把错误显示给调用方。桌面端不再静默改写 LocalStorage 或报告虚假成功。

### 稳定读取与编辑

- 上下文记录使用调用方生成的稳定 UUID，Rust 不再替换 ID。
- 桌面端支持上下文按 ID 读取、完整更新、启停、过期和删除。
- 章节总结支持按作品稳定查询；同章存在历史记录时使用确定性次序选择最新结果。
- 章节总结的过期判断和 AI 生成都只读取当前采用稿；较新的未采用草稿不会参与总结，采用稿读取失败会在调用 AI 前直接返回错误。
- SQLite 列表命令返回非数组等无效契约数据时会明确失败，不再伪装成“没有总结或上下文”。
- 采用另一版正文时，正文指针、章节状态、旧总结与关联上下文在同一 SQLite 事务中切换和过期；不需要先打开总结面板，应用重启后仍保持过期，后续生成不再注入该记录。

### 旧数据迁移

启动迁移会读取旧版 LocalStorage 中的章节总结、上下文和角色状态：

1. 优先匹配相同 ID。
2. 旧双写 ID 不同时，只接受唯一、确定性的镜像匹配。
3. 无唯一候选的记录保留在 LocalStorage，并返回 warning。
4. SQLite 事务提交后，只清理迁移结果中已明确映射的缓存。
5. 缓存清理失败不回滚已提交的 SQLite；再次运行迁移保持幂等，不生成副本。
6. 已插入或匹配的角色状态按稳定的最新次序同步回 `characters.current_state`，修复旧双写留下的状态分裂。

这不是跨 SQLite 与 LocalStorage 的分布式事务。安全保证是 SQLite 先提交、清理范围可证明、失败可重试。

### 浏览器开发模式

浏览器模式仍以 LocalStorage 提供开发回退。保存上下文 bundle 及采用新正文触发旧上下文过期前会保存相关集合快照，任一分步写入失败时恢复全部快照；目标模块的单次写入失败也会向上传播，不再被工具层吞掉。该补偿只用于开发，不替代桌面 SQLite 事务或真实 Tauri 验收。

### 发布门禁

新增版本同步入口：

```powershell
npm run test:version-sync
```

它核对 npm、Cargo、Tauri、前端常量和当前版本文档。统一验证脚本还会运行 Node 动态测试、ESLint、前端构建、Rust / SQLite 完整测试、Windows 真实 Tauri E2E、Tauri 生产构建及 Git 状态。任何失败或脏工作树都会阻断发布建议。

发布前验收命令：

```powershell
npm run test:version-sync
npm run test
npm run lint
npm run build
npm run test:quality-workspace
npm run test:setting-suggestions
npm run test:ai-tasks-delete
npm run test:project-backup

cd src-tauri
cargo check
cargo test
cd ..

npm run test:e2e
npm run tauri:build
git status --short
```

### 版本边界

本版本没有增加或修改数据库列，不引入新依赖，不实现自动续跑、Planner、Memory、v2.2 / v2.3 功能或 Agent 自主写入，也不把浏览器回退声明为桌面发布事实源。

---

<a id="v217"></a>
## v2.1.7

> 原标题：v2.1.7 发布说明 - 章节质量历史不可变快照与原子重放
> 原文件：`docs/release-notes-v2.1.7.md`
> 合并前 SHA-256：`A9EC41F3F786B8A25024884874D00E89C12E3FF897B3022ADB6BFF4A55997CF8`


### 版本信息

- 版本号：v2.1.7
- 发布日期：2026-07-22
- 单一目标：让章节质量检查的每次结果可追溯、不可变、可稳定回放
- 数据库调整：启动时幂等补齐 `quality_check_items.sort_order` 与 `quality_issue_states`
- 完整备份：`schemaVersion: 3`，兼容导入 schema 2
- 新增第三方依赖：无

### 对用户的帮助

过去对同一章节重新质检时，重复出现的问题会被改挂到新报告，旧报告因此丢失当时的问题集合。v2.1.7 后，每次检查都拥有独立报告和独立问题行，不会因后续检查被改写。用户可在右侧质检面板选择历次报告，核对当时的评分、摘要、问题次序和原始证据。

“问题快照”与“当前处理状态”现在分开保存。历史报告始终只读；当前报告仍可标记待处理、已解决或已忽略。稍后才返回的旧请求可以保存自身历史，但不能把较新报告已处理的问题“复活”。

浏览器开发模式的 LocalStorage 回退也采用同一分离契约。状态修改只写独立的 `quality_issue_states` 回退集合，新报告的历史 item 保持生成时快照；升级前已经存在的 item 原样保留并合成当前状态。该集合会随项目补充缓存一起备份和恢复。

### 原子保存与追溯

一次质检的报告结果、所有问题行、当前问题状态和 `completed` 终态在同一 SQLite `IMMEDIATE` 事务中提交。如果第 N 条问题写入失败，报告仍保持 pending，已写入的问题和状态全部回滚，不再出现“报告显示完成，内容只有一部分”。

每份新报告必须绑定真正产生结果的 AI Task。Rust 会校验 Task 存在、作品和章节归属匹配、类型为 `quality_check` 且状态为 `succeeded`。缺少、运行中、错误类型或错误目标的 Task 都会整笔拒绝；幂等重试必须使用原报告已绑定的同一 Task。

已被 completed 质量报告引用的 AI Task 会作为追溯证据保留。单条删除、混合批量删除和清空任务在命中这类记录时都会在任何写入前整体拒绝，不会再把报告的 Task 绑定静默清空。

### 历史读取契约

- `list_quality_check_reports` 只列出 completed 报告，按 `created_at DESC, id DESC` 稳定排序。
- `get_quality_check_report_snapshot` 返回原始不可变问题，按 `sort_order, id` 稳定排序，不覆盖当前工作流状态。
- `get_quality_check_issues` 只选取最新 completed 报告，并把 `quality_issue_states` 覆盖到当前问题上。
- 对历史 item 执行单条或批量状态修改会返回 `quality_issue_history_read_only`。
- pending / failed 报告不遮挡最近完整报告；只有比当前保存目标更新的 completed 报告才能阻止它更新工作流状态。

### 备份兼容

schema 3 完整备份新增 `quality_issue_states`，因此恢复后的 ignored / resolved 状态不依赖再次启动 migration。schema 2 备份仍可导入；恢复事务会按每个 `(chapter_id, issue_key)` 的 item `updated_at DESC, rowid DESC` 合成旧模型最后保存的可变状态，并按报告分别补齐从 0 开始的 `sort_order`，再与其他项目数据一起提交。

### 自动化验证

Rust / SQLite 回归覆盖：

- 两次出现同 issue key 时，两份报告保有不同 item ID，旧快照完全不变。
- 第 N 条 item 和第 N 条状态写入的 trigger 故障都会整体回滚。
- pending / failed 不遮挡 completed，同时间戳仍按 ID 稳定选择。
- 旧报告迟到、新报告已 resolved、以及仅存在更新未完成报告的两种竞态。
- 重复保存幂等、重复 issue key 整笔拒绝、批量状态事务、AI Task 强绑定、migration 幂等和 schema 2 恢复。

前端动态测试使 LocalStorage 回退与桌面契约保持一致。真实 Windows Tauri `quality-history-replay.spec.ts` 通过 DOM 创建作品、卷章和正文，连续执行两次固定 Mock 质检，重启真实应用后分别回放两份报告，校验 report / draft / content hash / AI Task / item ID 与只读状态，并要求外部网络、console error、未处理异常和残留进程全部为 0。

### 测试发现并修复的真实缺陷

原实现分三步写入：先把报告改为 completed，再逐条 upsert 问题，同 issue key 还会把旧 item 的 `report_id` 改为新报告。结果是中途失败可留下部分数据，而成功复检又会让旧报告丢失成员。另外，查询不过滤 completed，新 pending 可遮挡旧完整结果。

发布复审还稳定复现了两个竞态：旧请求迟到会把新报告已 resolved 的同 key 问题重置；反过来，一份更新但始终 pending / failed 的报告又会错误阻止真正最新 completed 报告刷新状态。同时，省略 `aiTaskId` 可绕过追溯校验，删除任务会清空 completed 报告绑定，LocalStorage 状态操作会改写历史 item，完成后的迟到历史列表可在快速切章时串章，schema 2 多报告恢复则会跨报告累计次序。本版本均先补失败动态回归，再修复并通过真实桌面状态修改与重启回放。

### 版本边界

本版本只收敛现有章节质量链路、质量状态与对应备份数据。不自动续跑不确定步骤，不扩展旧 AI 面板和其他工具的通用取消，不新增 Planner、Memory、通用自动放置或 Agent 自主写入。

---

<a id="v216"></a>
## v2.1.6

> 原标题：v2.1.6 发布说明 - 章节工程真实 AI 请求取消闭环
> 原文件：`docs/release-notes-v2.1.6.md`
> 合并前 SHA-256：`0C046001931039AC854B21484F536825100E31E6D79A1CC5EDB4427C3D347C35`


### 版本信息

- 版本号：v2.1.6
- 发布日期：2026-07-21
- 单一目标：让章节工程任务的在途正文生成与质量检查请求可以真正停止
- 数据库迁移：无
- 新增第三方依赖：无

### 对用户的帮助

点击章节工程的“取消任务”后，应用不再只是把数据库状态改成 `cancelled`。仍在等待的真实 AI HTTP 请求、浏览器 fetch 或 Mock 请求会同步中止，连接和等待资源及时释放，也避免一个已经取消的请求继续产生费用或迟到结果。

取消终态仍由 SQLite 事务保护：任务状态与唯一取消 checkpoint 一起提交，迟到回调不能写入成功 step、生成草稿或把任务改回完成。已经成功提交的草稿或质量报告属于既成事实，不会因为稍后的取消而被删除。

### 请求取消契约

- `AiClient.generate` 接受可选 `AbortSignal` 与无业务内容的 request ID。
- 章节正文生成和质量检查共享 job controller，但各自使用独立 request ID。
- 桌面 API 模式使用异步 `reqwest`，Rust `cancel_ai_request` 通过 abort handle 丢弃整个发送与响应读取 future。
- 任务终态等待取消 IPC 确认；若 IPC 控制调用失败，前端只记录固定脱敏诊断并等待原请求结算。若取消 IPC 卡住但原命令已经安全结算，则调用方可以结束，不会被控制 Promise 永久阻塞。
- 用户取消固定为 `AI_REQUEST_CANCELLED`；网络超时保留原超时语义。
- 浏览器开发模式取消内部 fetch；Mock pause gate 和延迟会清除 timer、listener 与 waiter。
- 质量检查对应的旧 `ai_task_record` 结算为 `cancelled`，终态不会被迟到 success / failure 覆盖。
- 质量报告在 AI 成功返回后才创建，取消在途请求不会留下永久 `pending` 报告。

### 并发与资源保护

Rust 侧活动注册表最多保存 64 个请求；提前取消和近期完成 ID 各最多 128 个，并在 30 秒后清理。注册 token 防止旧请求误删复用 ID，两阶段 reserve / attach 处理取消先于 abort handle 建立的窗口，RAII guard 则在 command future 被丢弃时主动中止网络并移除注册。

请求 ID 只允许最长 128 字节的 ASCII 字母、数字、`-`、`_`、`.` 和 `:`。Rust 与浏览器错误路径都不记录 API URL、密钥、Authorization、provider body、完整 prompt、原始响应正文或底层 reqwest 错误；`2xx` 非法 JSON 也只返回固定解析错误。

### 自动化验证

Rust loopback 测试证明：

- 慢请求取消后快速返回稳定错误码，服务端观察到连接 EOF / reset。
- 提前取消不产生网络连接，重复活动 ID 不会发出第二个请求。
- 正常 JSON / usage 与超时语义保持，取消和超时不混淆。
- command future 被丢弃时仍会 abort，并清理活动注册。
- E2E 网络阻断先于 client 创建与 dispatch；tombstone 与 recently-settled 容量都有硬上限。
- 非法成功响应只返回固定错误，不泄露 provider body。

前端动态测试覆盖 Tauri 取消 IPC 的延迟确认、失败降级与永不 settle 边界，浏览器 caller abort / timeout 分类、错误和非法成功响应正文脱敏、Mock gate 与 delay 清理，以及质量旧任务的 `cancelled` 终态。

真实 Windows Tauri `generation-job-cancel.spec.ts` 从 UI 创建作品、卷、章，分别暂停正文生成和质量检查后点击取消。正文场景验证不新增草稿；质量场景验证已提交草稿保留、旧 AI task 为 `cancelled` 且不创建 pending 报告。两者都要求 5 秒内 waiter 归零、SQLite 只有一个取消 checkpoint、release gate 后没有迟到 step 或 completed 状态，且外部网络请求、console error、未处理异常和归属进程残留全部为 0。

### 测试发现并修复的真实缺陷

原实现使用同步 `reqwest::blocking::Client`。`generationJobService.cancel` 只写入持久化状态，无法触达正在执行的 HTTP 请求；请求可继续等待到配置上限 1800 秒。Mock pause gate 同样没有 abort listener，取消后 waiter 会一直保留到显式 release 或进程退出；浏览器端还会把所有 `AbortError` 误报为超时。发布审阅进一步发现，取消 IPC 曾被 fire-and-forget 且失败被吞掉，`2xx` 非法 JSON 的浏览器解析异常也可能夹带敏感正文片段；两条回归均已补齐并修复。

本版本把 transport、任务状态机和旧质量任务记录连接成同一个取消闭环，并用真实 socket、前端信号与桌面 SQLite 三层动态测试分别证明。

### 版本边界

本版本只覆盖章节工程 `generation_jobs` 中的正文生成和质量检查。旧 `AiGeneratePanel` 及其他独立 AI 工具仍按各自原有流程运行；本版本不宣称全产品 AI 均可取消，也不增加流式输出、自动续跑、质量历史重放、新 migration 或 Agent 自主写入。

---

<a id="v215"></a>
## v2.1.5

> 原标题：v2.1.5 发布说明 - 章节工程任务跨重启恢复闭环
> 原文件：`docs/release-notes-v2.1.5.md`
> 合并前 SHA-256：`EB6EFBB20D10F15F0BA916919BF5AE228ADA5B5219F8A2A47C8B88209E042D84`


### 版本信息

- 版本号：v2.1.5
- 发布日期：2026-07-21
- 单一目标：让章节工程生成任务在应用重启后得到确定、可审计且幂等的安全结算
- 数据库迁移：无
- 新增第三方依赖：无

### 用户获得的保护

应用重启后，章节工程任务不会再永久显示为运行中。启动流程会检查 `generation_jobs`，把上次退出前仍处于 `pending`、`running` 或 `retrying` 的任务原子结算为 `failed`，并显示恢复对话框。已完成步骤、进度、草稿、质量报告和 patch 结果均保留。

系统不会猜测一个 AI 步骤是否已经产生外部副作用，也不会自动重发请求、续跑步骤、采用草稿或覆盖正文。用户检查保留结果后，可以显式启动一个新任务。

### 恢复契约

- 恢复错误码固定为 `APP_RESTART_INTERRUPTED`，错误文案不包含提示词、密钥或账户信息。
- 一个 SQLite 事务同时完成任务终结和恢复 checkpoint；checkpoint 插入失败时任务更新整体回滚。
- current step、progress、既有 step outputs、草稿和报告不被改写。
- 第二次执行恢复返回 0，不重复修改终态任务，也不追加重复 checkpoint。
- `completed`、`failed`、`cancelled` 都是不可复活终态；进度限制在 `0..100` 且不能倒退。
- step ID 不再使用 `INSERT OR REPLACE` 覆盖旧记录；相同时间戳按 ID 稳定排序。
- step 保存会在同一事务内检查父任务状态；取消会原子写入终态和唯一取消 checkpoint，迟到成功结果无法再写入已取消任务。

### 桌面体验

- `recovery-dialog` 在启动检查发现中断任务时出现，显示结算数量并明确告知没有自动重发 AI 请求。
- 章节工程面板显示稳定恢复提示和 checkpoint 状态。
- 新任务按钮同时检查组件运行状态和 SQLite 中最新任务状态，避免重新打开面板后重复启动。
- runner 在每个异步 action 后及最终完成前复核取消状态；迟到完成回调不能覆盖取消或恢复写入的终态。

### 自动化验证

Rust 测试覆盖：

- `pending` / `running` / `retrying` 一次性恢复，终态任务保持不变。
- 二次恢复返回 0 且不增加 checkpoint。
- checkpoint 插入失败时整个事务回滚。
- 终态复活、非法状态跳转和进度倒退被拒绝。
- 重复 step ID 不可覆盖，等时间戳读取顺序稳定。
- 取消与迟到 step 写入竞争时，取消 checkpoint 只写一次，迟到 `succeeded` step 被拒绝。

真实 Windows Tauri E2E 使用仅限测试构建的 Mock AI pause gate，把任务稳定停在 AI 生成步骤，然后执行真实应用进程重启并复用同一个隔离 SQLite。测试验证恢复对话框、同一任务的错误码与保留进度、唯一恢复 checkpoint、第二次重启幂等、外部网络请求为 0，以及测试后应用与驱动进程无残留。截图只在失败后保存，不参与定位或断言。

### 为什么不自动续跑

当前 schema 没有 execution lease、attempt / operation ID、基础正文 revision / hash 和跨副作用幂等键。崩溃可能发生在 AI、草稿或报告已经提交，但 checkpoint 尚未写入的窗口；自动续跑会带来重复计费、重复草稿或重复报告风险。

因此 v2.1.5 选择“安全终结并保留事实”，不把不确定执行伪装成可恢复执行。真正的自动续跑需要在后续独立版本先补齐上述协议。

### 测试发现并修复的产品缺陷

真实桌面重启用例首次运行时稳定复现：Rust 已保存章节生成上下文快照，但前端归一化器没有读取 serde 返回的 `compiledContextJson` / `sourcesJson`，任务因此在 `compile_context` 24% 被误判为失败。补齐 camelCase DTO 兼容后，同一真实测试才能继续到暂停 AI 和进程重启阶段。

最终差异审查还发现 step DTO 的 `inputSnapshotJson` / `outputJson` 没有在生产服务层反序列化，以及取消后的迟到回调仍可能追加成功 checkpoint。现已补齐 JSON 归一化、父任务终态事务检查和原子取消 checkpoint，并增加动态竞态回归测试。

### 版本边界

本版本只覆盖具有持久化步骤的章节工程 `generation_jobs`。旧 `ai_task_records`、真实 HTTP 取消、质量历史不可变重放、安装程序 UI、原生文件选择器、托盘、通知和 Agent 自主写入均未扩展。

---

<a id="v214"></a>
## v2.1.4

> 原标题：v2.1.4 发布说明 - 大文本正文安全闭环
> 原文件：`docs/release-notes-v2.1.4.md`
> 合并前 SHA-256：`6D21B3554073CF17A8BE6F98205AE71D2A1300DC906680C2A583798CD68FA862`


### 版本信息

- 版本号：v2.1.4
- 发布日期：2026-07-21
- 单一目标：让章节大文本正文具备全文强校验、草稿引用同事务、失败关闭读取和安全旧文档生命周期
- 数据库迁移：无
- 新增第三方依赖：无

### 用户获得的保护

超过 100KB 的章节正文不再依赖“先保存分片、再单独关联草稿”的两段式流程。应用会先完整验证缓存分片，再在一个 SQLite 事务内提交文档、分片和草稿引用。事务任一步失败都不会留下半成品或孤儿正文。

重新打开章节时，Rust 会校验文档元数据、片数、片序、每片字符数 / 字节数 / SHA-256，以及最终全文的字符数、字节数和 SHA-256。任何损坏都会阻止目标章节进入编辑器；工作台保留切换前的安全正文，提供重试，并禁用可能覆盖目标正文的操作。

### 关键实现

#### 原子保存

- 前端先通过 `uploadLargeTextChunks` 创建 UUID session 并上传固定边界分片。
- `commit_large_text_draft_create` / `commit_large_text_draft_update` 在单个事务中写入 document、chunks 和 draft。
- 大文本更新会切换到新 document，并在同一事务中删除不再被任何草稿引用的旧 document。
- 大文本转小文本和删除草稿同样事务化清理旧引用；chunks 由外键级联删除。
- 提交后的缓存清理失败只返回 warning，不会把已经提交的数据库事务伪装成保存失败。

#### 完整性与路径安全

- 整文与每个分片都必须携带 SHA-256。
- Rust 重新计算 Unicode scalar 字符数、UTF-8 字节数和 hash，不信任前端元数据。
- session ID 必须是合法 UUID，缓存路径只由规范化 UUID 构造。
- SQLite `chapter_drafts.content` 只保留 500 字预览，完整字数始终按全文计算。

#### 失败关闭读取

- 所有带 `largeTextRefId` 的草稿读取都必须成功水合完整正文。
- 服务层不再捕获错误并返回预览。
- 章节切换在目标全文验证成功后才提交；失败目标不会成为 active chapter。
- 加载中或当前目标损坏时，编辑器禁止保存、采用、排版和应用 AI 输出。

### 自动化验证

Rust / SQLite 测试覆盖：

- 整文 hash 不匹配时 document、chunks、draft 均不写入。
- 缺片、错误片 hash、错误元数据和损坏已存分片均被拒绝。
- draft create / update 的后半段故障会回滚此前写入的 document 和 chunks。
- 成功更新、大文本转小文本和删除草稿会回收旧 document。
- 中文、emoji 和 CRLF 的全文、字符数、字节数与字数一致。

真实 Windows Tauri E2E 使用固定的 184KB 正文，通过 DOM 输入并验证：

```text
保存 -> 离开 -> 重开 -> 逐值比较全文 -> 采用 -> 核对 SQLite 状态
```

故障场景只在隔离 E2E 数据库中破坏一个 chunk，随后验证错误提示、安全章节保持激活、编辑器内容不变、预览和引用未被写回。E2E 不使用坐标、截图识别或真实 Provider，外部网络尝试保持为 0。

### 一并修复的稳定性问题

- struct command IPC 参数统一为 `{ input }`。
- E2E suite 自动选择空闲 driver 端口，避免连续执行时固定端口冲突。
- 大文本只读探针和损坏注入命令使用 Cargo `e2e` feature 编译期隔离，生产前端、主 EXE 与安装包不包含相关桥接或故障注入标记。
- 候选采用成功使用独立 Toast，不再让测试偶然依赖生成完成提示的剩余显示时间。

### 后续范围

v2.1.4 不处理任务跨重启恢复、真实 HTTP 取消、质量历史不可变重放、`Artifact` / `PlacementProposal` / `ApplyPlan` 新模型或其他实体的通用大文本原子提交。这些能力在正文事实源稳定之后按独立版本继续推进。

---

<a id="v213"></a>
## v2.1.3

> 原标题：v2.1.3 发布说明 - Windows 真实桌面 E2E 与稳定性
> 原文件：`docs/release-notes-v2.1.3.md`
> 合并前 SHA-256：`080BB00BAFE342D81EDC78EA7EF17919BD6FBA0EDDBCC4F2820005A65D23B390`


### 版本信息

- **版本号**：v2.1.3
- **发布日期**：2026-07-21
- **上一版本**：v2.1.2
- **目标平台**：Windows 10 / 11

### 版本定位

本版本不扩展新的 AI 自动写入范围，重点建立可重复验证真实 Windows Tauri 应用的桌面自动化基础，并发布自动化过程中稳定复现的产品缺陷修复。

测试直接操作真实 Tauri 窗口中的 DOM，通过稳定 `data-testid`、HashRouter 状态和受限 Tauri IPC 验证 React、Rust command、SQLite 事务与 Mock AI 流程。截图只作为失败诊断，不参与定位、点击或通过判定。

### 新增内容

#### Windows 真实桌面 E2E

- 接入 WebdriverIO 9.29.1、`tauri-driver 0.1.5` 和 Microsoft Edge WebDriver。
- 新增 `npm run test:e2e:smoke`、`npm run test:e2e` 和 `--spec <name>` 定向复测入口。
- 覆盖应用启动、作品创建与打开、作品信息保存、卷章正文保存、Mock AI 候选审查采用和未保存离开保护六条流程。
- 每个 spec 使用独立临时 SQLite、WebView2 profile、单实例状态、窗口状态、driver 端口和进程树。
- E2E feature、运行时标志、绝对临时路径和随机 run-id marker 必须全部匹配，否则 Rust 在打开数据库前拒绝启动。
- 作品保存通过独立只读 SQLite 连接验证事务已经提交，并检查同一作品不存在重复行。

#### Mock 与网络隔离

- E2E 前端构建强制使用 Mock Provider，不读取隔离 profile 中可能存在的真实 AI 设置。
- WebView 在业务模块加载前拦截外部 fetch、XHR、WebSocket、EventSource 和 beacon。
- Rust AI IPC 在创建或发送 HTTP 请求前再次阻断真实 Provider。
- 每个场景必须证明网络 guard 已安装、外部请求尝试为零，否则运行器改判失败。

#### 失败诊断与清理

- 始终输出脱敏的 `frontend-diagnostics.json`、WebdriverIO、Tauri Driver 和 Rust 日志。
- 失败时追加当前路由、DOM 摘要和截图；诊断不记录 API Key、Authorization、完整 prompt 或用户正式数据。
- 运行器只清理本轮拥有的 Node、Driver、应用和 WebView 子进程；残留 PID 或清理无法确认时停止后续 spec。

#### Windows GitHub Actions

- Pull Request 与 `main` 推送运行前端、Rust、生产构建和真实 Tauri smoke。
- `v*` tag、每周定时和手动完整模式运行六条桌面流程；手动 `full-three` 连续运行三轮。
- CI 自动读取 WebView2 Runtime 版本，下载精确版本 EdgeDriver，并在执行前再次校验前三段版本号。
- 依赖准备完成后，E2E 构建和执行使用 Cargo / npm offline 模式；失败诊断保留 7 天。

### 修复内容

- 修复 `create_novel` / `update_novel` 已持有 SQLite Mutex 时再次获取同一锁，导致作品创建或保存永久等待的问题。
- 修复同步 `reg query` 读取 Windows 强调色可能阻塞 Tauri command 的问题，增加 750 ms 上限和子进程终止。
- 统一编辑器与 Rust 草稿保存的中英文计字语义，避免页面与数据库字数不一致。
- 为旧 `style_profiles` 表幂等补充 `description` 列，修正风格列表可选参数和上下文日志 `{ input }` IPC 包装。
- 修复 Windows 运行器启动 `.cmd` 的 `EINVAL`、Edge 150 capability 和旧 E2E 可执行文件选择问题。
- 修复 GitHub Windows runner 错用 `tauri-driver --version` 校验 0.1.5 的问题，改为从 Cargo 安装清单确认精确版本并兼容 CRLF 输出。
- 修复候选采用 E2E 对 SQLite CRLF 与 HTML textarea LF 进行逐字节比较造成的 Windows 误报；断言仅标准化换行，仍验证正文字符完整一致。

### 主要文件变更

- `.github/workflows/windows-desktop-e2e.yml`
- `scripts/e2e/run-e2e.ts`
- `tests/e2e/`
- `src-tauri/src/runtime.rs`
- `src/services/tauri/e2eBridge.ts`
- `src/services/tauri/e2eNetworkGuard.ts`
- `src/components/common/E2eDialogHost.tsx`
- `docs/technical/desktop-e2e.md`
- `docs/technical/testing.md`

核心页面与组件只在关键业务节点增加稳定选择器，没有为普通展示元素批量添加测试属性。

### 验证结果

| 验证 | 结果 |
|------|------|
| `npm run test` | 14 / 14 通过 |
| `npx tsc --noEmit` | 通过 |
| `npm run lint` | 0 error；保留 1 条既有 Hook warning |
| `cargo check` | 通过 |
| `cargo check --features e2e` | 通过 |
| `cargo test` | 33 / 33 通过 |
| `npm run test:e2e:smoke` | 1 / 1 通过 |
| `npm run test:e2e` 连续三轮 | 18 / 18 通过 |
| `npm run tauri:build` | 通过；MSI 与 NSIS 均生成 |
| 文档同步检查 | 通过 |
| Windows workflow 静态验证 | YAML、9 个 PowerShell block、actionlint 全部通过 |

生产 bundle 已确认不包含 E2E bridge；桌面测试结束后未发现本轮应用、Node、Tauri Driver、EdgeDriver 或 WebView 子进程残留。

### 已知边界

- 产品当前没有崩溃恢复流程，因此不伪造 `recovery-dialog`。
- 当前数据模型没有名为 `Artifact`、`PlacementProposal` 或 `ApplyPlan` 的持久化实体；候选测试验证现有草稿、AI Task、目标绑定、基础哈希、采用状态和幂等约束。
- GitHub-hosted Windows runner 的缓存、桌面会话、WebView2 / EdgeDriver 下载和 artifact 服务可能随 runner 镜像变化；本版本以 `main` smoke 与 `v2.1.3` tag full workflow 的实际结果作为线上验收。
- React 组件级并发覆盖、安装程序 UI、原生文件选择器、系统托盘、Windows 通知和多显示器不在本版本范围。

### 后续计划

1. 为 v2.1.2 完整备份与恢复补充固定临时路径的真实桌面往返 E2E。
2. 收敛大文本全文校验、读取失败恢复和草稿引用之间的端到端事务边界。
3. 再处理任务跨重启恢复、真实网络取消和质量历史稳定重放。
4. 在正文安全门与动态回归稳定后，单独设计 `Artifact`、`PlacementProposal`、`ApplyPlan` 与更高自主度 Agent 能力。

---

<a id="v1043"></a>
## v1.0.43

> 原标题：v1.0.43 发布说明 — Agent 基础设施建设
> 原文件：`docs/release-notes-v1.0.43.md`
> 合并前 SHA-256：`9B4C9E6937B8F6A795E5A53892422E5732997F515F1870CF9809A45EC02D8B52`


### 版本信息
- **版本号**：v1.0.43
- **发布日期**：2026-05-26
- **上一版本**：v1.0.41

### 版本定位

本次版本是 AI Novel Studio 从 **AI 小说生成工具** 升级为 **AI Autonomous Creative Platform** 的关键一步。

**不新增任何小说业务功能**，专注于建立 Agent 工程化开发基础设施。

### 新增内容

#### 核心规则文件
- `AGENTS.md` — AI Agent 总入口规则，所有 Agent 必读

#### Instructions（6 个分领域开发指令）
- `frontend.instructions.md` — 前端 React/TypeScript 开发规范
- `tauri.instructions.md` — Tauri 桌面壳开发规范
- `database.instructions.md` — SQLite 数据库开发安全规范
- `testing.instructions.md` — 测试验证流程规范
- `documentation.instructions.md` — 文档维护规范
- `agent-behavior.instructions.md` — Agent 行为约束规范

#### Prompts（4 个标准 Prompt 模板）
- `next-version.prompt.md` — 让 Agent 自动制定版本计划
- `fix-bug.prompt.md` — 让 Agent 系统化分析修复 Bug
- `release-report.prompt.md` — 让 Agent 生成发布报告
- `verify-build.prompt.md` — 让 Agent 执行构建验证

#### Skills（5 个多步骤 Agent 工作流）
- `plan-version/SKILL.md` — 版本规划（读取状态→分析差距→输出计划）
- `implement-feature/SKILL.md` — 功能实现（读约束→分析→修改→验证）
- `verify-build/SKILL.md` — 构建验证（环境→编译→构建→报告）
- `review-ui/SKILL.md` — UI 审查（加载标准→逐项检查→输出报告）
- `release-package/SKILL.md` — 版本发布（验证→版本号→CHANGELOG→Tag）

#### Cursor Rules（5 个 IDE 规则）
- `project-architecture.mdc` — 项目架构与模块边界
- `ui-rules.mdc` — UI 风格与布局约束
- `database-rules.mdc` — 数据库安全与 Schema 约束
- `agent-safety.mdc` — Agent 行为安全红线
- `testing-rules.mdc` — 测试验证与构建要求

#### Docs（4 个新文档）
- `module-boundaries.md` — 各模块职责边界与禁止事项
- `project-architecture.md` — 项目技术架构与分层设计
- `agent-workflow.md` — Agent 标准开发工作流与交互模式
- `ai-agent-roadmap.md` — AI Agent 能力演进长期路线图

### 修改内容
- `README.md` — 更新项目定位、新增 Agent 化路线、更新版本号
- `docs/development-rules.md` — 新增 Agent 基础设施引用
- `docs/version-roadmap.md` — 新增 Agent 化阶段规划
- `package.json` — 版本号 1.0.41 → 1.0.43
- `src-tauri/Cargo.toml` — 版本号 1.0.41 → 1.0.43
- `src-tauri/tauri.conf.json` — 版本号 1.0.41 → 1.0.43

### 新增文件清单（共 27 个）

```
AGENTS.md
CHANGELOG.md
.github/instructions/frontend.instructions.md
.github/instructions/tauri.instructions.md
.github/instructions/database.instructions.md
.github/instructions/testing.instructions.md
.github/instructions/documentation.instructions.md
.github/instructions/agent-behavior.instructions.md
.github/prompts/next-version.prompt.md
.github/prompts/fix-bug.prompt.md
.github/prompts/release-report.prompt.md
.github/prompts/verify-build.prompt.md
.github/skills/plan-version/SKILL.md
.github/skills/implement-feature/SKILL.md
.github/skills/verify-build/SKILL.md
.github/skills/review-ui/SKILL.md
.github/skills/release-package/SKILL.md
.cursor/rules/project-architecture.mdc
.cursor/rules/ui-rules.mdc
.cursor/rules/database-rules.mdc
.cursor/rules/agent-safety.mdc
.cursor/rules/testing-rules.mdc
docs/module-boundaries.md
docs/project-architecture.md
docs/agent-workflow.md
docs/ai-agent-roadmap.md
docs/release-notes-v1.0.43.md
```

### 测试结果

| 步骤 | 状态 |
|------|------|
| cargo check | 待执行 |
| npm run build | 待执行 |
| npm run tauri build | 待执行 |
| git status | 待执行 |

### 本次禁止事项（严格执行）

- ❌ 不新增小说功能
- ❌ 不修改数据库结构
- ❌ 不修改正文生成逻辑
- ❌ 不新增世界推演功能
- ❌ 不新增 UI 页面业务逻辑
- ❌ 不重构现有前后端
- ❌ 不删除旧路由
- ❌ 不修改现有数据结构

### 后续计划

- **v1.0.44+**：继续 Agent 基础设施完善（如需要）
- **v2.x**：进入 Agent 化阶段（Planner / Tool Calling / Memory）
- **v3.x**：进入 Autonomous 阶段（Multi-Agent / 自主创作）

---

> 详细路线图见 `docs/ai-agent-roadmap.md`

---

<a id="v1041"></a>
## v1.0.41

> 原标题：AI Novel Studio v1.0.41 发布说明
> 原文件：`docs/release-notes-v1.0.41.md`
> 合并前 SHA-256：`C2ADCD1EFE508B388F14273F0922594F23D5DC4CE37914A218C3CC8B58EFC72D`


### 版本信息
- **版本号**: v1.0.41
- **发布日期**: 2026-05-18
- **类型**: 写作工作台链路修复

### 核心修复

#### 1. 本章目标可编辑并参与生成
- 大纲查看面板中的「本章目标」改为可编辑 textarea。
- 本章目标复用 `chapters.goal` 字段，按章节独立保存。
- 保存本章目标接入全局 Loading 弹窗，保存失败保留用户输入。
- 切换章节、关闭面板或返回时会提示未保存的本章目标修改。
- 章节大纲生成和正文生成都会读取当前章节目标，并在 prompt 中明确写入【本章目标】。

#### 2. 主角同步到角色库并可选本章出场
- 进入角色栏时同步作品主角到 `characters` 表，不重复创建主角。
- 右侧角色栏新增「主角快捷项」，可一键设置主角本章出场/不出场。
- 主角同时显示在角色库中，并带有「主角」标识。
- 主角加入本章后写入 `chapter_characters`，移除后本章不再强制主角出场。
- 正文生成上下文会读取主角档案、本章出场角色和主角本章出场状态。

#### 3. 数据库兼容与防重复
- 旧数据库自动补齐 `chapters.goal`、`chapter_characters` 等兼容字段。
- `chapter_characters(chapter_id, character_id)` 增加唯一索引，并在建索引前清理旧重复记录。

### 修改文件
- `src/components/right-dock/panels/OutlinePanel.tsx`
- `src/components/right-dock/panels/CharactersPanel.tsx`
- `src/components/right-dock/panels/AiGeneratePanel.tsx`
- `src/components/right-dock/RightPanel.tsx`
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx`
- `src/services/ai/outlineGenerateService.ts`
- `src/services/ai/promptBuilder.ts`
- `src/services/characters/characterService.ts`
- `src/services/characters/chapterCharacterService.ts`
- `src/services/prompt/contextBuilder.ts`
- `src/services/prompt/promptOrchestrator.ts`
- `src-tauri/src/commands.rs`
- `src-tauri/src/db.rs`
- `prompts/chapter_generate.md`

### 验证结果
- `npm run build` → 通过
- `npm run lint` → 0 errors, 49 warnings
- `cd src-tauri && cargo test` → 通过
- `npm run tauri dev` → 开发模式启动成功

---

<a id="v1039"></a>
## v1.0.39

> 原标题：AI Novel Studio v1.0.39 发布说明
> 原文件：`docs/release-notes-v1.0.39.md`
> 合并前 SHA-256：`B57F1633D08C0EEB8511EBF0ADC7B5EE4ECE8454581709B65FAE5E9EBD1C6171`


### 版本信息
- **版本号**: v1.0.39
- **发布日期**: 2026-05-18
- **类型**: 工程修复

### 修复内容

#### 1. ESLint 配置补充
- 新增 `.eslintrc.cjs` 配置文件
- 修复 `npm run lint` 因缺少配置而无法执行的问题
- 规则策略：只保留推荐规则，warning 为主，不阻塞开发
- 修复 4 个 error（2 个 React Hooks 条件调用 + 2 个无用 eslint-disable 指令）
- 当前状态：0 errors, 56 warnings（全部为预先存在的）

#### 2. 数据库迁移顺序修复
- `db.rs` 重构为三段式初始化：`create_base_tables` → `run_migrations` → `create_indexes`
- 确保 `idx_characters_protagonist` 索引创建前 `is_protagonist` 字段已通过迁移补齐
- 新增 `column_exists` / `ensure_column` 通用迁移工具函数
- 新增 `migrate_characters_table` 自动补齐所有缺失字段
- 旧数据库启动不再因缺字段而崩溃

#### 修改文件
- `.eslintrc.cjs` — 新增 ESLint 配置
- `package.json` — 版本号 1.0.39，lint 脚本优化
- `src-tauri/tauri.conf.json` — 版本号 1.0.39
- `src/components/right-dock/RightPanel.tsx` — 修复 Hooks 条件调用
- `src/utils/debugSeed.ts` — 移除无用 eslint-disable
- `src-tauri/src/db.rs` — 数据库迁移顺序修复（已有改动）
- `docs/release-notes-v1.0.39.md` — 发布说明

#### 验证结果
- `npm run lint` → 0 errors, 56 warnings ✅
- `npm run build` → ✅
- `cargo check` → ✅

---

<a id="v1038"></a>
## v1.0.38

> 原标题：AI Novel Studio v1.0.38 发布说明
> 原文件：`docs/release-notes-v1.0.38.md`
> 合并前 SHA-256：`AEC86F153680FFF225C7CC90383F7220615DBDF3E9B6848660A83FA098230F34`


### 版本信息
- **版本号**: v1.0.38
- **发布日期**: 2026-05-18
- **类型**: 数据库兼容性修复

### 核心修复
- 修复旧 SQLite 数据库中的 `characters` 表缺少 `is_protagonist` 字段时，启动阶段创建 `idx_characters_protagonist` 索引导致后端崩溃的问题。
- 在创建依赖新字段的索引前，先执行 `characters` 表字段迁移。
- 补齐角色库和主角同步功能需要的兼容字段，包括 `role_type`、`source_type`、`gender`、`ability`、`relationship_notes` 等。
- 保持迁移幂等，重复启动不会重复添加字段，也不会清空旧作品、章节或角色数据。

### 修改文件
- `src-tauri/src/db.rs` - 拆分基础建表、迁移、索引创建顺序，并新增角色表迁移测试
- `package.json` - 版本号更新到 1.0.38
- `package-lock.json` - 版本号更新到 1.0.38
- `src-tauri/tauri.conf.json` - 版本号更新到 1.0.38
- `src-tauri/Cargo.toml` - 版本号更新到 1.0.38
- `src-tauri/Cargo.lock` - 版本号更新到 1.0.38
- `src/constants/version.ts` - 应用显示版本更新到 v1.0.38

### 验收重点
- 旧数据库启动时自动补齐 `characters.is_protagonist`
- `idx_characters_protagonist` 在字段迁移后创建
- 已有作品、章节、角色数据不删除、不清空
- 主角同步角色库功能继续可用

---

<a id="v1037"></a>
## v1.0.37

> 原标题：AI Novel Studio v1.0.37 发布说明
> 原文件：`docs/release-notes-v1.0.37.md`
> 合并前 SHA-256：`67C30B1A8F2A6648D46730D9EEDF4257773ED042A06B2262B6C648EDA63FC187`


### 版本信息
- **版本号**: v1.0.37
- **发布日期**: 2026-05-18
- **类型**: 功能修复

### 核心修复：目标字数同步与应用

#### 问题背景
AI 章节生成面板中的"目标字数"始终显示 4000 字，即使用户在输出控制/章节配置中修改了目标字数也无法生效。AI 生成的 prompt 也未使用用户配置的真实目标字数。

#### 根本原因
1. `chapterRepository.ts` 在规范化章节数据时，将未设置的目标字数强制默认为 4000
2. `contextBuilder.ts` 的目标字数优先级错误（输出控制 > 章节，应为章节 > 输出控制）
3. `AiGeneratePanel.tsx` 的上下文摘要显示用 `|| 4000` 兜底
4. `ChapterFormModal.tsx` 新建章节时强制默认 4000

#### 修复内容

##### 1. 数据层修复（chapterRepository.ts）
- 章节未设置目标字数时不再强制默认 4000，保留 `undefined`
- 允许上层（输出控制方案/上下文构建器）按优先级链补全
- 只有显式设置且 > 0 的值才会被保留

##### 2. 上下文构建器修复（contextBuilder.ts）
- 目标字数优先级修正为：**章节单独设置 > 输出控制方案 > 系统默认 4000**
- 章节明确设置的目标字数可覆盖输出控制方案的默认值

##### 3. AI 生成面板修复（AiGeneratePanel.tsx）
- 目标字数解析器优先级修正为：章节 > 输出控制 > 4000
- 上下文摘要显示使用已解析的实际字数，不再硬编码 4000
- 当前章节区域正确显示解析后的目标字数

##### 4. 章节表单修复（ChapterFormModal.tsx）
- 新建章节目标字数默认 0（表示未设置，由输出方案决定）
- 保存时如果为 0 则传 `undefined`，不强制写入

##### 5. 大纲生成修复（outlineGenerateService.ts）
- AI 生成的章节大纲不再强制默认 4000 字目标

#### 目标字数优先级
```
章节单独设置的目标字数 (最高优先级)
  ↓ 章节未设置时
输出控制方案的目标字数 (chapterWordRange.default 或 targetWordCount)
  ↓ 输出方案也未设置时
系统默认值 4000 (最终降级)
```

#### 修改文件
- `src/services/database/chapterRepository.ts` — 章节目标字数规范化修复
- `src/services/prompt/contextBuilder.ts` — 优先级修正
- `src/components/right-dock/panels/AiGeneratePanel.tsx` — 显示与解析修复
- `src/components/outline/ChapterFormModal.tsx` — 默认值修复
- `src/services/ai/outlineGenerateService.ts` — 大纲生成默认值修复
- `package.json` — 版本号 1.0.37
- `src-tauri/tauri.conf.json` — 版本号 1.0.37

#### 验收标准
- ✅ 输出控制中修改目标字数后，写作工作台能显示新值
- ✅ 当前章节单独设置目标字数后，优先使用章节字数
- ✅ 章节未设置时，继承输出控制方案的目标字数
- ✅ 切换章节时目标字数按配置正确变化
- ✅ contextBuilder 使用正确的优先级链
- ✅ 默认 4000 只在没有任何配置时使用
- ✅ 项目正常构建（npm run build + cargo check）

---

<a id="v1036"></a>
## v1.0.36

> 原标题：AI Novel Studio v1.0.36 发布说明
> 原文件：`docs/release-notes-v1.0.36.md`
> 合并前 SHA-256：`E70C47EC86292F098CE73A61A16C37A530B22C05EB494028DC70DADB8A80B24F`


### 版本信息
- **版本号**: v1.0.36
- **发布日期**: 2026-05-18
- **类型**: 功能修复

### 核心修复：主角同步角色库与本章出场角色

#### 问题背景
写作工作台右侧栏"角色管理"面板中，角色库无法显示已设定的主角信息，导致：
- 角色库显示为 0
- 无法将主角加入本章出场角色
- AI 生成无法稳定读取主角档案

#### 修复内容

##### 1. 数据库迁移
- `characters` 表新增 `is_protagonist` 列（INTEGER, 默认 0）
- 新增 `idx_characters_protagonist` 索引
- 自动迁移已有数据库（`ensure_character_columns`）

##### 2. Rust 后端新命令
- `sync_protagonist_to_character_library` — 从 protagonists/novels 表同步主角到 characters 表（upsert）
- `get_protagonist_character` — 从 characters 表读取主角角色
- `list_characters` — 列出作品所有角色（主角优先排列）
- `create_character` — 创建角色
- `update_character` — 更新角色
- `delete_character` — 软删除角色
- `add_chapter_character` — 添加章节出场角色（防重复）
- `list_chapter_characters` — 列出章节出场角色
- `remove_chapter_character` — 移除章节出场角色

##### 3. 前端服务层更新
- `characterService` 重写为 Tauri/SQLite 优先，localStorage 降级
- `chapterCharacterService` 重写为 Tauri/SQLite 优先，localStorage 降级
- 新增 `syncProtagonist()` 和 `getProtagonist()` 方法
- localStorage 回退支持从 novels/protagonists 同步主角

##### 4. CharactersPanel 面板优化
- 面板打开时自动同步主角到角色库
- 主角以 ⭐ 图标特殊标识
- 显示主角详细信息（身份、性格、目标、行为限制）
- "⭐ 加入本章"按钮（主角自动分配 `main` 角色）
- AI 候选角色自动过滤与主角同名角色
- 角色去重检查（已在本章的角色不再显示添加按钮）
- 章节未选择时禁用添加按钮

#### 修改文件
- `src-tauri/src/db.rs` — characters 表 is_protagonist 列 + 迁移
- `src-tauri/src/commands.rs` — 9 个角色管理命令
- `src-tauri/src/main.rs` — 新命令注册
- `src/services/characters/characterService.ts` — Tauri 优先重写
- `src/services/characters/chapterCharacterService.ts` — Tauri 优先重写
- `src/components/right-dock/panels/CharactersPanel.tsx` — 主角同步与 UI
- `package.json` — 版本号 1.0.36
- `src-tauri/tauri.conf.json` — 版本号 1.0.36

#### 验收标准
- ✅ 角色库不再无故显示 0
- ✅ 作品已有主角时，角色库必须显示主角
- ✅ 主角可以加入本章出场角色
- ✅ 本章出场角色区域能显示主角
- ✅ 主角不会被重复同步出多条
- ✅ AI 推荐候选角色不会覆盖主角
- ✅ 项目正常构建（npm run build + cargo check）

---

<a id="v1034"></a>
## v1.0.34

> 原标题：AI Novel Studio v1.0.34 发布说明
> 原文件：`docs/release-notes-v1.0.34.md`
> 合并前 SHA-256：`2FC56E23F53BF05DA785F7729C5CB520EEB6C66D08FE0273104795270499DC09`


### 发布时间
2026-05-18

### 版本概述
本次更新修复了风格方案的核心持久化问题：风格方案不再只停留在 localStorage 临时状态，而是真实写入 SQLite 数据库。同时新增 active 风格方案机制，确保 AI 生成正文、大纲时自动读取当前采用风格方案。

### 关键修复

| 问题 | 修复 |
|---|---|
| 风格配置离开页面后恢复默认 | ✅ 数据真实保存到 SQLite |
| 没有"当前采用"风格概念 | ✅ 新增 active 机制（唯一激活） |
| AI 生成不读取风格方案 | ✅ 正文+大纲生成均自动加载 |
| 大纲生成缺少风格约束 | ✅ outlineGenerateService + outline_commands 均已接入 |
| 风格删除/切换不同步 | ✅ 删除 active 自动激活下一个 |

### 后端新增

#### 5 个新 Tauri 命令
| 命令 | 说明 |
|---|---|
| `list_style_profiles` | 列出作品所有风格方案 |
| `get_active_style_profile` | 获取当前采用方案 |
| `save_style_profile` | 保存/更新（所有字段完整写入） |
| `set_active_style_profile` | 设置为唯一当前采用 |
| `delete_style_profile` | 删除（自动转移 active） |

#### 上下文增强
- `build_outline_context` (Rust) 现在读取完整风格字段（叙事人称/文风/节奏/对话比例/描写比例/禁用写法）
- `outlineGenerateService` (TS) 现在自动加载 active 风格方案

### 前端改动

#### styleProfileService 全面重写
- 优先使用 Tauri/SQLite，浏览器模式 fallback 到 localStorage
- 新增 `getActive()` / `setActive()` / `remove(projectId, id)`
- DTO ↔ StyleProfile 类型转换

#### AI 生成链路
| 生成类型 | 风格接入方式 |
|---|---|
| 章节正文 (AiGeneratePanel) | contextBuilder → buildStyleSummary → prompt |
| 总纲/分卷/章节大纲 (OutlineManager) | outlineGenerateService.buildOutlineContext → prompt |
| 大纲编辑器 (OutlineEditor) | 同上 |
| 章节总结 (ChapterSummaryPanel) | 间接通过 contextBuilder |

### 修改文件
```
修改:
  src-tauri/src/commands.rs         +200行 (5个新命令)
  src-tauri/src/outline_commands.rs 更新风格读取
  src-tauri/src/main.rs             注册5个新命令
  src/services/styles/styleProfileService.ts 重写 (Tauri+fallback)
  src/services/ai/outlineGenerateService.ts  接入active风格
  package.json / Cargo.toml / tauri.conf.json / version.ts → 1.0.34

新增:
  docs/release-notes-v1.0.34.md
```

---

<a id="v1033"></a>
## v1.0.33

> 原标题：AI Novel Studio v1.0.33 发布说明
> 原文件：`docs/release-notes-v1.0.33.md`
> 合并前 SHA-256：`8782CBACDE7C4843AC327E5D003F797F04DCE1546267AAF9FE64F5EFC9A3D916`


### 发布时间
2026-05-18

### 版本概述
本次更新实现了总纲、分卷大纲、章节大纲的可编辑化与完整上下文驱动推演系统。大纲不再是 AI 一次性输出的只读文本，而是支持编辑、保存、版本管理、设置为采用版本，并且 AI 推演时会自动加载主角背景、世界设定、风格画像等完整创作上下文。

### 核心改动

#### 🗄️ 数据库新增
- `master_outlines` — 作品总纲表（支持多版本、active 标记）
- `volume_outlines` — 分卷大纲表
- `chapter_outlines` — 章节大纲表
- 3个对应索引

#### 🔧 后端新增（13个 Tauri 命令）
| 命令 | 说明 |
|---|---|
| `build_outline_context` | 读取完整创作上下文（主角/世界/规则/风格/已有大纲） |
| `save_master_outline` | 保存总纲（支持覆盖/新版本） |
| `get_master_outline` | 获取当前采用总纲 |
| `get_master_outline_versions` | 获取总纲历史版本列表 |
| `set_active_master_outline` | 设置为采用版本 |
| `save_volume_outline` | 保存分卷大纲 |
| `get_volume_outline` | 获取当前采用分卷大纲 |
| `get_volume_outline_versions` | 获取分卷大纲历史版本 |
| `set_active_volume_outline` | 设置为采用版本 |
| `save_chapter_outline` | 保存章节大纲 |
| `get_chapter_outline` | 获取当前采用章节大纲 |
| `get_chapter_outline_versions` | 获取章节大纲历史版本 |
| `set_active_chapter_outline` | 设置为采用版本 |

#### 🎨 前端新增
- **OutlineEditor 组件** (`src/components/outline/OutlineEditor.tsx`)
  - 手动编辑大纲内容（标题 + 正文）
  - AI 生成大纲（自动加载完整上下文）
  - 保存 / 保存为新版本
  - 设为采用版本
  - 查看生成上下文摘要（主角、世界、风格）
  - 版本历史显示
  - Ctrl+S 快捷键保存
  - 未保存提醒
- **OutlineEditorPage** (`src/pages/OutlineEditor/`)
  - 三级大纲选择（总纲/分卷/章节）
  - 分卷/章节下拉选择器
  - 路由：`/novels/:novelId/outline`
- **outlineService** (`src/services/outlines/outlineService.ts`)
- **大纲类型定义** (`src/types/outline.ts`)

#### 🧠 上下文驱动推演
AI 生成大纲时自动加载：
- 作品名称、题材、简介
- 世界背景设定
- 世界规则体系
- 主角名称、身份、性格、目标
- 主角特殊能力及限制
- 已采用总纲
- 已有分卷/章节列表
- 风格画像摘要
- 输出控制配置

#### 🔗 加载弹窗与防重复
- AI 生成过程接入 LoadingModal（进度 + 阶段文案）
- 保存操作接入 LoadingModal
- 生成期间按钮禁用，防止重复点击

### 修改文件
```
新增:
  src-tauri/src/outline_commands.rs    - 大纲后端命令（~550行）
  src/types/outline.ts                 - 大纲类型定义
  src/services/outlines/outlineService.ts - 大纲服务层
  src/components/outline/OutlineEditor.tsx - 大纲编辑器组件
  src/pages/OutlineEditor/OutlineEditorPage.tsx - 大纲编辑器页面
  docs/release-notes-v1.0.33.md

修改:
  src-tauri/src/main.rs       - 注册 outline_commands 模块 + 14个命令
  src-tauri/src/db.rs         - 调用 create_outline_tables
  src/App.tsx                 - 添加 /novels/:novelId/outline 路由
  src/types/index.ts          - 导出 outline 类型
  package.json / Cargo.toml / tauri.conf.json / version.ts → 1.0.33
```

### 版本管理规则
| 操作 | 处理 |
|---|---|
| 第一次 AI 生成 | version = 1, status = draft |
| 用户直接保存 | 覆盖当前版本 |
| 用户保存为新版本 | version + 1 |
| 用户设为采用 | is_active = 1, 同 project 下其他版本 is_active = 0 |

---

<a id="v1032"></a>
## v1.0.32

> 原标题：AI Novel Studio v1.0.32 发布说明
> 原文件：`docs/release-notes-v1.0.32.md`
> 合并前 SHA-256：`92796ABA71DBFC9F8C0515F319CACF7A181A44E39BAE614730B85FBE3F9EE244`


### 发布时间
2026-05-18

### 版本概述
本次更新实现了长时间异步操作的统一加载弹窗提示与防重复点击机制。所有 AI 生成、数据保存、大文本保存、文件导入/导出等耗时操作，现在都会显示全局加载弹窗，包含阶段文案、进度条、成功/失败状态，并自动禁用重复操作。

### 核心改动

#### 🎨 新增 LoadingModal 组件
- 全局居中弹窗，浅色桌面软件风格
- 三种状态：loading（旋转动画 + 进度条）、success（✅ 自动关闭）、error（❌ 可重试/关闭）
- 确定进度条与不确定进度动画
- 可取消任务支持取消按钮
- 成功自动关闭（默认 1200ms），不打断写作流

#### 🔧 新增 useLoadingTask Hook
- `src/hooks/useLoadingTask.ts` - 组件级异步任务管理
- 提供 `run()` 方法自动管理 loading/success/error 状态
- `helpers` 对象：setMessage / setStage / setPercent / setCancelable

#### 📦 新增 runWithLoading 全局工具
- `src/lib/runWithLoading.ts` - 全局事件驱动的异步任务包装器
- 通过 CustomEvent 机制触发 LoadingModal，组件无需直接引入弹窗
- `useGlobalLoadingModal()` hook 在 App 根组件订阅
- 支持 AbortSignal 取消机制

#### ✅ 已接入功能（10个调用点）

| 功能 | 组件 | 弹窗提示 |
|---|---|---|
| AI 章节正文生成 | AiGeneratePanel | 「正在请求 AI 生成正文……」 |
| AI 正文润色 | PolishPanel | 「AI 正在润色正文……」 |
| AI 质量检查 | CheckPanel | 「AI 正在检查逻辑、设定和文笔……」 |
| AI 章节总结生成 | ChapterSummaryPanel | 「正在分析章节内容……」 |
| AI 章节总结保存 | ChapterSummaryPanel | 「正在保存总结和上下文……」 |
| AI 作品总大纲生成 | OutlineManager | 「正在分析世界观和角色……」 |
| AI 分卷大纲生成 | OutlineManager | 「正在分析分卷结构……」 |
| AI 章节大纲生成 | OutlineManager | 「AI 正在规划章节结构……」 |
| 正文保存（Ctrl+S） | EditorArea | 「正在保存草稿」 |
| TXT 导入 | ImportTxtDialog | 「正在导入章节 X/Y……」 |
| JSON 导入 | ImportJsonDialog | 「正在导入风格方案/作品……」 |

#### 🛡️ 防重复点击
- 所有接入按钮在任务执行期间自动禁用
- 全局 `runWithLoading` 内部检测重复执行
- 异常情况 finally 恢复按钮状态
- 失败后保留用户输入内容，不清空表单/正文

#### 🎯 与大文本保存衔接
- 大文本保存进度自动通过 `runWithLoading` helper 同步到弹窗
- 分片保存阶段显示：「正在缓存正文：3 / 20」
- finalize 阶段显示：「正在写入数据库……」

### 修改文件
```
新增:
  src/components/common/LoadingModal.tsx
  src/components/common/LoadingModal.css
  src/hooks/useLoadingTask.ts
  src/lib/runWithLoading.ts
  docs/release-notes-v1.0.32.md

修改:
  src/App.tsx                    - 集成全局 LoadingModal
  src/components/right-dock/panels/AiGeneratePanel.tsx
  src/components/right-dock/panels/PolishPanel.tsx
  src/components/right-dock/panels/CheckPanel.tsx
  src/components/right-dock/panels/ChapterSummaryPanel.tsx
  src/components/outline/OutlineManager.tsx
  src/components/workspace/EditorArea.tsx
  src/components/import/ImportTxtDialog.tsx
  src/components/import/ImportJsonDialog.tsx
  package.json
  src-tauri/Cargo.toml
  src-tauri/tauri.conf.json
  src/constants/version.ts
```

---

<a id="v1031"></a>
## v1.0.31

> 原标题：AI Novel Studio v1.0.31 发布说明
> 原文件：`docs/release-notes-v1.0.31.md`
> 合并前 SHA-256：`A1386EB7F9E77E1CBF05341575CD9D79A4F67E5B7EF3231D7F0663BCD23D1E79`


### 发布时间
2026-05-18

### 版本概述
本次更新实现了大文本异步/流式保存 + 临时 JSON 缓存 + 批量入库机制，彻底解决大文本保存时的页面卡顿、超时和数据库写入失败问题。

### 核心改动

#### 🚀 新增大文本分片保存管道
- **后端 `large_text_save` 模块**：新增保存会话管理、分片接收、完整性校验、事务批量入库、缓存清理等完整能力
- **前端 `largeTextSave` 工具**：自动检测文本大小，超过 100KB 自动使用分片保存
- **临时 JSON 缓存**：大文本先写入 `save_cache/` 目录下的临时分片文件，校验通过后批量写入 SQLite
- **事务安全**：数据库写入使用 SQLite 事务，任意分片写入失败则回滚，不破坏旧数据

#### 🔧 数据库新增
- `large_text_documents` 表：记录大文本文档元数据
- `large_text_chunks` 表：存储大文本分片内容
- 为 `chapter_drafts`、`chapter_summaries`、`context_records`、`style_profiles`、`output_profiles`、`world_settings`、`rule_systems` 表增加 `large_text_ref_id` 列

#### 📋 新增 Tauri 命令
- `create_large_text_save_session` - 创建保存会话
- `append_large_text_chunk` - 追加文本分片
- `finalize_large_text_save` - 校验并批量写入数据库
- `abort_large_text_save` - 取消保存并清理缓存
- `cleanup_expired_large_text_save_sessions` - 清理过期缓存
- `read_large_text_content` - 从分片拼装读取完整内容
- `update_large_text_ref` - 更新记录的大文本引用

#### 🔄 前端适配
- `draftVersionService` 的 `create()` 和 `update()` 已接入大文本保存
- `getByChapterId()` 和 `getLatestByChapterId()` 自动检测并加载大文本完整内容
- 保存过程支持进度回调（creating → uploading → finalizing → done）
- `AbortSignal` 支持取消保存

#### 🛡️ 兼容性
- 旧数据完全兼容：小文本继续走原有保存路径
- 旧章节正常读取
- 不影响现有 UI 布局
- SQLite 数据库自动迁移（新增表和列）

### 修改文件
```
修改:
  src-tauri/Cargo.lock
  src-tauri/Cargo.toml
  src-tauri/src/commands.rs
  src-tauri/src/db.rs
  src-tauri/src/main.rs
  src/services/database/draftVersionService.ts
  src/types/ai.ts
  src/types/index.ts
  package.json
  src-tauri/tauri.conf.json
  src/constants/version.ts

新增:
  src-tauri/src/large_text_save.rs
  src/services/largeTextSave.ts
  src/types/largeTextSave.ts
```

### 技术亮点
- 分片大小：64KB（默认）
- 大文本阈值：100KB
- 过期缓存清理：24小时
- SHA-256 完整性校验
- SQLite WAL 模式 + 事务
- 前端 AbortController 支持取消

---

<a id="v1029"></a>
## v1.0.29

> 原标题：AI Novel Studio v1.0.29 发布说明
> 原文件：`docs/release-notes-v1.0.29.md`
> 合并前 SHA-256：`CE029861BDF51EE0791ABE5D7EA5F5F0D9DAA245CA6230A9F9AF22E07273FE89`


### 版本信息
- 版本号：v1.0.29
- 发布日期：2026-05-18
- 平台：Windows 桌面端

### 本次更新

#### 🔧 修复：主角设定保存链路

##### 根因
v1.0.28 引入双主角功能时，`handleSave` 函数末尾缺少 `}` 关闭函数体，导致 TypeScript 编译失败，主角设定无法保存。

##### 修复内容

| 修复项 | 文件 | 内容 |
|--------|------|------|
| 缺少 `}` | `NovelDetailCards.tsx` | `handleSave` 函数 `finally` 块后补充 `};` |
| 类型不匹配 | `NovelDetailCards.tsx` | `onSave` 回调中 `protagonistMode` 从 `string` 改为 `ProtagonistMode` |
| 新字段类型 | `novel.ts` | `UpdateNovelInput` 新增 `protagonistMode`、`protagonists`、`dualProtagonistRelation` |
| null→undefined | `novelRepository.ts` | `update` 函数中 `dualProtagonistRelation: null` 转为 `undefined` |
| normalizer 增强 | `novelNormalizer.ts` | 主角数组不再按 `name` 过滤，逐字段 reconstruct 确保所有属性保留 |
| 导入缺失 | `NovelDetailCards.tsx` | 新增 `ProtagonistMode` 类型导入 |
| 保存调用 | `NovelDetailPage.tsx` | 移除 `@ts-ignore` + `as any`，使用正确类型 |
| 错误提示 | `NovelDetailCards.tsx` | `catch` 显示具体错误信息而非笼统"保存失败" |

#### 📦 修改文件清单

| 文件 | 修改 |
|------|------|
| `src/types/novel.ts` | `UpdateNovelInput` 新增 3 字段 |
| `src/features/novels/novelNormalizer.ts` | 主角数组 robust reconstruct |
| `src/services/database/novelRepository.ts` | `dualProtagonistRelation` null→undefined |
| `src/components/novel-detail/NovelDetailCards.tsx` | `handleSave` 缺 `}` 补全 + 类型修复 + 错误提示 |
| `src/pages/NovelDetail/NovelDetailPage.tsx` | 移除 `@ts-ignore`，try/catch 错误处理 |
| `src/constants/version.ts` | v1.0.28 → v1.0.29 |

#### 📦 构建
- 正式 EXE：`src-tauri\target\release\AI Novel Studio.exe`
- npm run build：✅
- npm run tauri build：✅

---

<a id="v1028"></a>
## v1.0.28

> 原标题：AI Novel Studio v1.0.28 发布说明
> 原文件：`docs/release-notes-v1.0.28.md`
> 合并前 SHA-256：`DC04A2355F8D6EDDBFEBE2E129CD771EDBA5ECC52C214E0B899370132996B03B`


### 版本信息
- 版本号：v1.0.28
- 发布日期：2026-05-18
- 平台：Windows 桌面端

### 本次更新

#### 👥 新增：小说详情页主角设定支持双主角

##### 数据模型扩展
- `Novel` 类型新增 `protagonistMode`（`single` / `dual`）
- `Novel` 类型新增 `protagonists: ProtagonistProfile[]`
- `Novel` 类型新增 `dualProtagonistRelation?: DualProtagonistRelation`
- 新增 `ProtagonistProfile` 接口：姓名、性别、身份、性格、目标、动机、特殊能力、能力限制、禁止行为、背景经历、人物成长线、备注
- 新增 `DualProtagonistRelation` 接口：关系类型（伙伴/恋爱/竞争/绑定/师徒/亲属/敌对转盟友/平行双线/自定义）、关系说明、核心冲突、合作方式、关系推进、叙事权重

##### 小说详情页 UI
- 主角设定卡片支持切换「单主角」/「双主角」模式
- 双主角模式下显示主角A表单、主角B表单、双主角关系表单
- 关系类型和叙事权重支持下拉选择
- 展示模式区分单/双主角，双主角显示两位主角摘要和关系信息
- 保存通过 `novelService.updateNovel` 持久化，重启后不丢失

##### 旧数据兼容
- 旧 `protagonistRepository` 中的单主角数据自动迁移到 `novel.protagonists`
- 旧 `protagonistName`/`mainCharacter` 字段自动构造单主角对象
- 缺少 `protagonistMode` 时默认为 `single`

##### AI Prompt 集成
- `ChapterGenerationContext` 新增 `protagonistMode`、`protagonistsSummary`、`dualProtagonistSummary`
- `contextBuilder` 自动从 `novel.protagonists` 和 `novel.dualProtagonistRelation` 构建主角摘要
- `prompts/chapter_generate.md` 新增「主角详细设定」和「双主角关系」区块
- 双主角模式下 prompt 包含：必须同时考虑两位主角、不要把第二主角写成路人、推进关系冲突或合作、叙事权重约束
- `promptBuilder.ts` 和 `promptOrchestrator.ts` 同步更新

#### 📦 修改文件清单（12 个文件）

| 文件 | 修改 |
|------|------|
| `src/types/novel.ts` | 新增 ProtagonistMode、ProtagonistProfile、DualProtagonistRelation 类型；Novel 新增 3 字段 |
| `src/types/ai.ts` | ChapterGenerationContext 新增 3 字段 |
| `src/features/novels/novelNormalizer.ts` | 新增 protagonist 相关归一化 + 旧数据兼容 |
| `src/features/novels/mockNovels.ts` | 三篇 mock 添加新字段 |
| `src/services/database/novelRepository.ts` | create 新增默认 protagonist 字段 |
| `src/services/prompt/contextBuilder.ts` | 构建 protagonistsSummary + dualProtagonistSummary |
| `src/services/ai/promptBuilder.ts` | 类型 + 构建函数新增双主角提示词 + 双主角约束 |
| `src/services/prompt/promptOrchestrator.ts` | DEFAULT_TEMPLATE 新增双主角区块 |
| `prompts/chapter_generate.md` | 新增「主角详细设定」+「双主角关系」区块及约束 |
| `src/components/novel-detail/NovelDetailCards.tsx` | ProtagonistCard 重写：模式切换 + 双主角表单 + 关系表单 |
| `src/pages/NovelDetail/NovelDetailPage.tsx` | 更新 onSave 调用链 |
| `src/constants/version.ts` | v1.0.27 → v1.0.28 |

#### 📦 构建
- 正式 EXE：`src-tauri\target\release\AI Novel Studio.exe`
- npm run build：✅
- npm run tauri build：✅

---

<a id="v1027"></a>
## v1.0.27

> 原标题：AI Novel Studio v1.0.27 发布说明
> 原文件：`docs/release-notes-v1.0.27.md`
> 合并前 SHA-256：`81037E075137BF73FDDDBE8F40AD857DDFA7D4694DD301D97BC29CE5FC51AF52`


### 版本信息
- 版本号：v1.0.27
- 发布日期：2026-05-18
- 平台：Windows 桌面端

### 本次更新

#### 📋 新增：模板中心自定义上传与管理

- **上传模板**：支持 TXT / Markdown / JSON 文件上传
  - TXT/MD：文件名作为模板名，内容作为模板正文
  - JSON：自动解析 name/type/description/content/tags/variables 字段
- **新建模板**：手动创建自定义模板，支持填写名称、类型、说明、标签、正文
- **编辑模板**：支持修改自定义模板的所有字段
- **删除模板**：二次确认后删除，不可恢复
- **复制使用**：一键复制模板内容到剪贴板
- **模板类型**：支持 12 种模板分类（作品设定/总大纲/分卷大纲/章节大纲/章节正文/角色/事件/世界背景/风格方案/输出控制/润色/质量检查）
- **筛选**：按「全部」「系统内置」「我的模板」筛选
- **持久化**：自定义模板存储到本地 localStorage，重启不丢失

#### 🗑️ 新增：AI 任务记录删除/清空

- **单条删除**：每条记录右侧 🗑️ 按钮，二次确认后删除
- **多选删除**：点击「多选」进入选择模式，支持全选/反选，批量删除
- **清空全部**：一键清空所有 AI 任务记录（二次确认）
- **按筛选删除**：筛选类型/状态后，「删除当前筛选的 N 条记录」
- **安全边界**：只删除 ai_task_records，不影响作品、章节、草稿、大纲、角色或设定
- **反查验证**：删除/清空后验证数据确实移除

#### 📦 修改文件清单

| 文件 | 修改 |
|------|------|
| `src/services/templates/templateService.ts` | 新增用户模板服务（CRUD + 类型枚举） |
| `src/pages/Templates/TemplatesPage.tsx` | 重写：上传/新建/编辑/删除 + 我的模板列表 |
| `src/services/ai/aiTaskService.ts` | 新增 deleteOne/deleteMany/clearAll |
| `src/pages/AiTasks/AiTasksPage.tsx` | 重写：多选/批量删除/清空 + 按筛选删除 |
| `src/constants/version.ts` | v1.0.26 → v1.0.27 |

#### 📦 构建
- 正式 EXE：`src-tauri\target\release\AI Novel Studio.exe`
- 大小：约 10.5 MB

---

<a id="v1026"></a>
## v1.0.26

> 原标题：AI Novel Studio v1.0.26 发布说明
> 原文件：`docs/release-notes-v1.0.26.md`
> 合并前 SHA-256：`ADD30A08A4DEDAFD34FC32518000E69FC40C1EA477CFCDFD1DBF4969B660FDCF`


### 版本信息
- 版本号：v1.0.26
- 发布日期：2026-05-18
- 平台：Windows 桌面端

### 本次更新

#### 🗑️ 新增：删除作品功能（级联删除）

- **首页作品卡片**：鼠标悬停时左上角显示 🗑️ 删除按钮
- **二次确认**：弹出确认框，明确告知将删除所有关联数据
- **级联删除**：删除作品同时清理分卷、章节、草稿、角色、事件、设定、上下文总结、AI 任务记录等关联数据
- **反查确认**：删除后自动验证作品是否已从列表中彻底移除
- **错误处理**：删除失败时显示明确错误信息

#### 📋 新增：Novel `outline` 字段（作品总大纲独立字段）

- `Novel` 类型新增 `outline` 字段，与 `description`（作品简介）区分
- `CreateNovelInput` / `UpdateNovelInput` 新增 `outline` 可选字段
- `novelNormalizer` 支持 `outline` 的归一化和旧数据兼容
- `novelRepository.create` 默认为 `''`
- AI 生成正文优先使用 `novel.outline`（为空时降级到 `novel.description`）
- prompt 模板中区分显示「作品简介」和「作品总大纲」

#### 🎨 新增：AI 生成面板风格方案与输出控制下拉选择

- AI 生成面板新增「风格方案」和「输出控制」两个下拉选择框
- 自动加载当前作品可用的风格方案和输出控制配置
- 选中后显示方案摘要（视角、基调、节奏、对话/描写比例等）
- 生成正文时将选择传入 `buildChapterContext`，注入到 prompt 中
- `ai_task_records` 的 `inputSummary` 记录所选方案名称

#### 📦 修改文件清单

| 文件 | 修改 |
|------|------|
| `src/types/novel.ts` | Novel 新增 `outline`；CreateNovelInput/UpdateNovelInput 新增 `outline` |
| `src/features/novels/novelNormalizer.ts` | normalizeNovel 新增 outline 字段处理 |
| `src/services/database/novelRepository.ts` | create 包含 outline；新增 `deleteCascade` |
| `src/services/novels/novelService.ts` | 新增 `deleteNovelCascade` |
| `src/components/novel-card/NovelCard.tsx` | 新增 `onDelete` 回调 + 删除按钮 |
| `src/pages/Home/HomePage.tsx` | 集成级联删除逻辑 + 二次确认 |
| `src/styles/home.css` | `.novel-card` 增加 position:relative + 删除按钮样式 |
| `src/services/prompt/contextBuilder.ts` | 优先使用 novel.outline；传递 novelDescription |
| `src/components/right-dock/panels/AiGeneratePanel.tsx` | 新增风格/输出下拉选择 + 传入 buildChapterContext |
| `src/constants/version.ts` | v1.0.25 → v1.0.26 |

#### 📦 构建
- 正式 EXE：`src-tauri\target\release\AI Novel Studio.exe`
- 大小：约 10.5 MB

---

<a id="v1025"></a>
## v1.0.25

> 原标题：AI Novel Studio v1.0.25 发布说明
> 原文件：`docs/release-notes-v1.0.25.md`
> 合并前 SHA-256：`30684CC020220BBB6A73B1C6596C0C729792CAA81D0EE77FC54177CBE39189BA`


### 版本信息
- 版本号：v1.0.25
- 发布日期：2026-05-17
- 平台：Windows 桌面端

### 本次更新

#### 🔧 修复：AI 生成正文必须结合大纲、设定、角色、事件与风格配置

修复了 AI 生成正文时上下文构建不完整的问题。之前生成正文时只传入了基础信息（章节标题、大纲），未充分注入作品总大纲、分卷大纲、本章设定、风格方案、输出控制等已保存的规划数据，导致 AI 自由发挥偏离规划。

#### ✨ 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/types/ai.ts` | `ChapterGenerationContext` 新增 `novelOutline`、`volumeOutline`、`novelDescription`、`chapterSettings` 字段 |
| `src/services/prompt/contextBuilder.ts` | `buildChapterContext` 新增读取作品总大纲（novel.description）、分卷大纲（volume.summary+goal）、本章可用设定（最近6条激活设定） |
| `src/services/ai/promptBuilder.ts` | `ChapterGeneratePromptContext` 同步扩展新字段；`buildChapterGeneratePrompt` 提示词新增作品总大纲、分卷大纲、本章设定区块，并增加「不得凭空新增角色」「必须体现大纲中的场景/道具」的约束 |
| `prompts/chapter_generate.md` | 提示词模板新增「作品总大纲」「分卷大纲」「本章可用设定」区块；强化核心要求为「严格围绕章节大纲展开」；新增约束禁止凭空添加角色、必须如实写入大纲中的场景/道具 |
| `src/services/prompt/promptOrchestrator.ts` | DEFAULT_TEMPLATE 同步新增所有新字段的条件渲染 |
| `src/components/right-dock/panels/AiGeneratePanel.tsx` | 新增「上下文摘要预览」功能：点击「查看上下文摘要」展示所有将传入 AI 的配置项状态；缺失章节大纲时弹出警告确认；inputSummary 记录详细上下文统计 |
| `src/constants/version.ts` | 版本号更新到 v1.0.25 |

#### 📋 AI 生成正文现在会注入的完整上下文

| # | 上下文项 | 数据来源 |
|---|----------|----------|
| 1 | 作品总大纲 | `novel.description` |
| 2 | 世界背景 | `settingRepository.getWorldSettings` → 激活的世界设定 |
| 3 | 规则体系 | `settingRepository.getRuleSystems` → 激活的规则 |
| 4 | 主角 / 特殊能力 / 限制 / 禁止行为 | `protagonistRepository` |
| 5 | 分卷大纲 | `volume.summary` + `volume.goal` |
| 6 | 分卷主要冲突 | `volume.mainConflict` |
| 7 | 章节大纲 / 章节目标 | `chapter.outline` / `chapter.goal` |
| 8 | 本章可用设定 | 最近 6 条激活的世界设定 |
| 9 | 本章出场角色 + 性格/目标/限制 | `chapterCharacterService` + `characterService` |
| 10 | 本章事件建议 + 必须发生标记 | `chapterEventService` |
| 11 | 前文上下文摘要 | `contextRecordService` |
| 12 | 风格方案（叙事人称/文风/节奏/对话比/描写比/禁用写法） | `styleProfileService` |
| 13 | 输出控制（目标字数/节奏/战斗强度/情绪倾向/禁止项） | `outputProfileService` |
| 14 | 用户额外要求 | UI 输入框 |

#### 🛡 降级策略

- 缺少章节大纲 → 弹出确认警告，允许继续但提醒可能偏离
- 缺少作品总大纲 → 正常生成，提示中使用 `novel.description` 替代
- 缺少分卷大纲 → 正常生成，基于章节大纲和总大纲
- 缺少角色/事件/设定 → 正常生成，提示中留空
- 缺少风格方案 → 使用默认小说风格
- 缺少前文总结 → 第一章正常，非第一章提示连续性可能下降

#### ⚠ 关键约束

提示词中新增了以下约束：
1. 不得凭空添加未在出场角色列表中列出的重要角色
2. 如果章节大纲中描述了具体场景/道具/对话，必须如实写入正文
3. 严格围绕章节大纲展开正文（最高优先级）
4. 不得违反世界规则和主角能力限制

#### 📦 构建
- 正式 EXE：`src-tauri\target\release\AI Novel Studio.exe`
- 大小：约 10.5 MB

---

<a id="v1024"></a>
## v1.0.24

> 原标题：AI Novel Studio v1.0.24 发布说明
> 原文件：`docs/release-notes-v1.0.24.md`
> 合并前 SHA-256：`A53A6E1C35BDDA7BCA3DC3C274BBDC9F1EA358C6A06D7935A04A173B603F3AB0`


### 版本信息
- 版本号：v1.0.24
- 发布日期：2026-05-17
- 平台：Windows 桌面端

### 本次更新

#### 🔧 修复 1：写作工作台右侧栏点击即自动收回问题

**根因**：
1. `--z-overlay: 300` > `--z-right-panel: 160`，overlay 的 z-index 高于 panel，透明 overlay 覆盖在 panel 上方拦截所有点击事件
2. overlay 与 panel 是兄弟 DOM 元素，panel 的 `stopPropagation` 无法阻止兄弟 overlay 的 `onClick={onClose}`
3. overlay 的 z-index (300) 同时高于 toolbar (150)，导致 toolbar 图标被遮挡无法点击

**修复**：
1. 交换 z-index：`--z-right-panel: 350` > `--z-overlay: 300`
2. DOM 重构：panel 嵌套到 overlay 内部，使 `stopPropagation` 正确生效
3. 添加 `pointer-events: none` 到 overlay，`pointer-events: auto` 到 panel，确保 toolbar 可点击
4. 新增全局 `document.addEventListener('mousedown')` 精确判断 click-outside
5. panel 所有区域（header/body/close button）添加 `onMouseDown` + `onClick` stopPropagation

#### ✨ 新增功能：工作台右侧面板 AI 功能补全

修复了写作工作台右侧面板中缺失 AI 生成按钮的问题，三个面板现已具备完整的 AI 功能链路。

#### ✨ 新增功能

##### 1. 大纲面板（OutlinePanel）- AI 大纲生成
- 新增「生成作品总大纲」按钮，基于作品背景、角色、规则等调用 AI 生成完整总大纲
- 新增「生成本卷大纲」按钮，基于当前分卷信息生成卷级大纲
- 新增「生成章节大纲」按钮，AI 生成 3 个章节大纲候选
- 支持采用章节大纲候选直接保存到当前章节
- 支持复制作品总大纲到剪贴板
- 显示 AI 模式状态（Mock / 真实 API）

##### 2. 风格面板（StylePanel）- AI 风格分析
- 新增「风格分析」区域，支持粘贴参考文本或使用当前章节正文
- 新增「使用当前章节正文」快捷加载按钮
- 新增「开始风格分析」按钮，调用 AI 分析叙事视角、基调、节奏、句式、对话描写比等
- 分析结果可视化展示
- 支持「保存为风格方案」将分析结果一键保存

##### 3. 章节总结面板（ChapterSummaryPanel）- AI 生成总结
- 新增「生成章节总结」按钮，自动获取已采用正文调用 AI 生成总结
- 结果预览：摘要、关键事件、下章建议
- 支持「确认保存」将总结写入数据库（含上下文记录、角色状态）
- 已有总结的章节支持「重新生成总结」
- 显示 AI 模式状态

##### 4. 类型扩展
- `StyleSourceType` 新增 `'ai_analyzed'` 来源类型

#### 📋 完整的 AI 功能按钮矩阵

| 面板 | 按钮 | 状态 |
|------|------|------|
| AI 生成 | 生成新稿 / 重新生成 | ✅ |
| 大纲 | 作品总大纲 / 分卷大纲 / 章节大纲 | ✨ 新增 |
| 角色 | 生成本章候选角色 | ✅ |
| 事件 | 生成本章事件建议 | ✅ |
| 设定 | 生成本章设定建议 | ✅ |
| 风格 | 开始风格分析 | ✨ 新增 |
| 检查 | 开始质量检查 | ✅ |
| 润色 | 开始润色 | ✅ |
| 总结 | 生成章节总结 | ✨ 新增 |

#### 🔗 技术实现
- 所有新按钮均调用已有的 AI service（outlineGenerateService、analyzeStyle、chapterSummarizeService）
- 通过 createAiClient 统一走 Tauri 后端 ai_chat_completion 调用真实 API
- loading/error/result 状态完整
- ai_task_records 写入完整
- API 模式失败时显示明确错误，不自动 fallback 到 Mock

#### 📦 构建
- 正式 EXE：`src-tauri\target\release\AI Novel Studio.exe`
- 大小：约 10.5 MB

---

<a id="v1023"></a>
## v1.0.23

> 原标题：AI Novel Studio v1.0.23 发布说明
> 原文件：`docs/release-notes-v1.0.23.md`
> 合并前 SHA-256：`F2F479EF46B29DB9FBCF641C7B1A76471F2528AA1DAD3936803E99828E087D4B`


### 版本主题

全局 AI API 调用链路修复：所有 AI 生成、推荐、检查、润色、总结与大纲能力统一接入设置中心配置的 OpenAI-Compatible API。

### 核心变更

- 新增 Tauri 后端 `ai_chat_completion` 命令，正式 EXE 中通过 Rust/reqwest 请求真实模型，降低 CORS 与 WebView fetch 差异风险。
- 统一 `createAiClient(settings)` 调用入口，API 模式严格校验 Base URL、API Key、模型名称、temperature、maxTokens、timeoutSeconds。
- API 请求统一使用 `/v1/chat/completions` 拼接规则，发送 `max_tokens`，不发送 `top_p`。
- AI 任务记录写入 SQLite `ai_task_records`，记录 runtime/provider/model/status/duration/tokens/error，不记录 API Key。
- 补齐章节总结、风格分析、设定补充、作品总大纲、分卷大纲、章节大纲的真实 AI 调用链路。
- 设置中心测试连接改为真实模型请求，并记录 `connection_test` 任务。

### 验证

- `npm run build` 通过。
- `npm run tauri build` 通过。
- 正式 EXE `src-tauri\target\release\AI Novel Studio.exe` 启动检查通过。

---

<a id="v1022"></a>
## v1.0.22

> 原标题：AI Novel Studio v1.0.22 发布说明
> 原文件：`docs/release-notes-v1.0.22.md`
> 合并前 SHA-256：`23E5D83E776FE0BE26A2BC857C94165C319D941A2762A082D66A4C5CF34A67C7`


### 版本主题
真实 API 调用端到端修复 + 正式 EXE 版本同步 + 新建作品卡死回归修复

### 一、版本概况
- 版本号：v1.0.22
- 基础版本：v1.0.21
- 技术路线：Tauri + React + TypeScript + SQLite / localStorage

### 二、用户反馈问题（已修复）

#### 1. 正式 EXE 版本不正确
- 问题：用户截图显示 v1.0.8，但实际应为 v1.0.22
- 修复：统一 package.json / tauri.conf.json / version.ts / Cargo.toml 为 1.0.22

#### 2. 新建作品卡在"创建中..."
- 问题：窗口显示"未响应"，弹窗永久卡在"创建中..."
- 修复：`dbCall` 已有 3 秒 Tauri 超时 + localStorage 降级机制
- 原因分析：极可能是用户运行了旧版 EXE（v1.0.8），该版本缺少降级机制
- 本次确保重新构建 EXE

#### 3. Invalid Date
- 已有 `toValidDate()` / `formatDate()` 安全日期工具
- 所有 Novel 都有 `normalizeNovel` 确保日期字段合法
- 原因分析：旧版数据缺乏归一化

### 三、真实 API 调用修复（核心）

#### 1. RealAiClient 重写
- URL 拼接：支持多种 Base URL 格式（`/v1`、`/v1/chat/completions`、裸域名）
- 移除 `top_p` 参数（不再发送，避免兼容性问题）
- 增强错误处理：
  - `401` → 提示检查 API Key
  - `403` → 提示检查模型权限/令牌授权
  - `429` → 提示降低频率
  - `5xx overloaded` → 提示服务过载
  - 超时 → 提示检查网络和超时时间
  - 网络失败 → 具体提示

#### 2. aiSettingsService.testConnection 重写
- 使用与 RealAiClient 相同的 URL 构建逻辑
- 校验必填字段（baseUrl / apiKey / modelName）
- 详细的错误分类和可读提示
- 连接成功显示延迟和返回内容摘要

#### 3. AI 任务记录增强
- AiTaskRecord 新增 `runtimeMode` 和 `provider` 字段
- 所有 AI 服务调用 `aiTaskService.create()` 时传递 runtimeMode 和 provider
- 5 个调用点全部更新：characterGenerate / eventSuggest / qualityCheck / polish / chapterGenerate

#### 4. AiGeneratePanel 修复
- `mockMode` → `runtimeMode` 统一切换
- 4 处遗留引用全部修复

#### 5. SettingsPage 修复
- `settings.mockMode` → `settings.runtimeMode === 'mock'` 统一
- 4 处遗留引用全部修复

### 四、新增/修改文件

| 文件 | 变更 |
|------|------|
| `package.json` | version 1.0.22 |
| `src-tauri/tauri.conf.json` | version 1.0.22 |
| `src-tauri/Cargo.toml` | version 1.0.22 |
| `src/constants/version.ts` | v1.0.22 |
| `src/types/ai.ts` | AiTaskRecord 新增 runtimeMode/provier |
| `src/services/ai/realAiClient.ts` | 重写 URL 构建、错误处理、移除 top_p |
| `src/services/ai/aiSettingsService.ts` | 重写 testConnection |
| `src/services/ai/aiTaskService.ts` | create() 新增 runtimeMode/provider |
| `src/services/ai/characterGenerateService.ts` | 传递 runtimeMode/provider |
| `src/services/ai/eventSuggestService.ts` | 传递 runtimeMode/provider |
| `src/services/ai/qualityCheckAiService.ts` | 传递 runtimeMode/provider |
| `src/services/ai/polishAiService.ts` | 传递 runtimeMode/provider |
| `src/components/right-dock/panels/AiGeneratePanel.tsx` | mockMode→runtimeMode |
| `src/pages/Settings/SettingsPage.tsx` | mockMode→runtimeMode |

### 五、API 调用策略

- 不发送 `top_p` 参数
- maxTokens 默认 8000
- 连接测试 max_tokens=100
- 所有错误信息对用户可读
- API Key 不进入日志、任务记录、错误提示

### 六、构建说明

```powershell
cd F:\ai-novel-studio
npm install
npm run build
npm run tauri build
```

正式 EXE 路径：`F:\ai-novel-studio\src-tauri\target\release\AI Novel Studio.exe`

---

<a id="v1021"></a>
## v1.0.21

> 原标题：AI Novel Studio v1.0.21 发布说明
> 原文件：`docs/release-notes-v1.0.21.md`
> 合并前 SHA-256：`D8C3D616B62E7E4313C71B7A4E117A4E39CB59A23CF7EDEAE0A595D47C0D222E`


### 版本主题
工作台稳定性收口与右侧 AI 功能统一修复

### 一、版本概况
- 版本号：v1.0.21
- 发布日期：2025-07-10
- 技术路线：Tauri + React + TypeScript + SQLite / localStorage

### 二、核心更新

#### 1. 统一 AI Client 架构
- 所有 AI 功能（章节生成、角色生成、事件推荐、质量检查、润色）统一走 `createAiClient()` 工厂
- 新增 `promptBuilder.ts` 统一管理所有任务类型的提示词构建
- MockAiClient 增强：根据系统提示词自动检测任务类型，返回对应的模拟数据（JSON/文本）
- RealAiClient：统一 OpenAI-Compatible Chat Completions 格式请求

#### 2. AI 服务重构
- `characterGenerateService`：重写为使用统一 aiClient + 结构化 JSON 输出
- `eventSuggestService`：重写为使用统一 aiClient + 结构化 JSON 输出
- `qualityCheckAiService`：重写为使用统一 aiClient + 结构化 JSON 输出
- `polishAiService`：重写为使用统一 aiClient

#### 3. 右侧 AI 面板完善
- 所有 AI 面板（角色、事件、检查、润色）新增 AI 模式状态显示（Mock/API）
- 面板显示当前模式、模型名称
- API 模式但未配置时显示警告提示

#### 4. AI 设置优化
- 默认 maxTokens 从 4000 提升至 8000
- maxTokens 上限从 32000 提升至 64000
- Mock/API 互斥逻辑：切换 runtimeMode 时自动同步 mockMode
- 设置页面实时同步两种模式标记

#### 5. AI 任务记录
- 所有 AI 功能调用均记录 aiTaskRecords
- 记录包含 runtimeMode / provider / modelName / taskType / status
- API Key 不进入日志和任务记录

#### 6. 最小调用次数策略
- 页面加载不自动触发 AI
- 一次用户点击对应一次 API 请求
- 角色、事件、设定推荐一次返回多个候选
- Mock 模式同样走统一接口，不绕过

#### 7. 版本号更新
- package.json → 1.0.21
- tauri.conf.json → 1.0.21
- version.ts → v1.0.21

### 三、新增/修改文件

#### 新增
- `src/services/ai/promptBuilder.ts` — 统一 Prompt 构建器，支持 6 种任务类型

#### 重要修改
- `src/services/ai/mockAiClient.ts` — 增强为支持所有任务类型
- `src/services/ai/characterGenerateService.ts` — 重构为使用统一 aiClient
- `src/services/ai/eventSuggestService.ts` — 重构为使用统一 aiClient
- `src/services/ai/qualityCheckAiService.ts` — 重构为使用统一 aiClient
- `src/services/ai/polishAiService.ts` — 重构为使用统一 aiClient
- `src/services/ai/aiSettingsService.ts` — 默认 maxTokens 提升至 8000
- `src/pages/Settings/SettingsPage.tsx` — maxTokens 上限提升，mockMode 同步
- `src/components/right-dock/panels/CharactersPanel.tsx` — 新增 AI 模式显示
- `src/components/right-dock/panels/EventsPanel.tsx` — 新增 AI 模式显示
- `src/components/right-dock/panels/CheckPanel.tsx` — 新增 AI 模式显示
- `src/components/right-dock/panels/PolishPanel.tsx` — 新增 AI 模式显示
- `src/constants/version.ts` — v1.0.21
- `package.json` — 1.0.21
- `src-tauri/tauri.conf.json` — 1.0.21

### 四、构建说明

执行以下命令构建：
```powershell
cd F:\ai-novel-studio
npm install
npm run build
npm run tauri build
```

正式 EXE 路径：`F:\ai-novel-studio\src-tauri\target\release\AI Novel Studio.exe`

### 五、Mock 模式验证

Mock 模式下所有 AI 功能可用：
1. AI 生成正文 — 返回示例章节正文
2. 角色 AI 生成 — 返回 4 个候选角色（JSON）
3. 事件 AI 推荐 — 返回 4 个候选事件（JSON）
4. 设定 AI 补充 — 返回 3 个候选设定（JSON）
5. 质量检查 — 返回检查报告（JSON）
6. 润色 — 返回润色后正文

每个功能都记录 aiTaskRecords。

---

<a id="v1020"></a>
## v1.0.20

> 原标题：AI Novel Studio v1.0.20 Release Notes
> 原文件：`docs/release-notes-v1.0.20.md`
> 合并前 SHA-256：`4FAD9014D8C23389FED5875793E3D33108F94E2FF70EB2C437EDB89A2672AA15`


### 版本主题
统一章节创建服务：真实落库 + 反查验证 + UI 闭环

### 用户反馈问题
- 作品详情页「创建章节」提示成功但页面空白
- 工作台「创建第一卷并新建第一章」仍不可用

### 根因分析
1. **「创建成功」提前显示**：`OutlineManager` 在 `createChapter()` 返回后立即 flash("章节创建成功")，未验证数据是否持久化
2. **无草稿创建**：详情页创建章节时只创建 chapter，不创建 draft，导致工作台打开时无正文编辑区
3. **无统一服务**：详情页和工作台各自写创建逻辑，容易出现存储 key 不一致

### 本次修复

#### 新增 `chapterCreationService.ts`（统一章节创建服务）
- `createFirstVolumeAndChapter(novelId)`：创建第一卷 + 第一章 + 空草稿，每步反查验证
- `createChapterInVolume(novelId, volumeId, title)`：在已有分卷中创建章节 + 空草稿，每步反查
- 创建失败抛出明确错误，不会假成功

#### OutlineManager 修复
- 创建章节时调用统一服务
- 无分卷时自动创建第一卷 + 第一章
- 创建后反查验证成功才显示「✅ 创建成功」
- 失败显示「❌ 创建失败：具体原因」

#### WritingWorkspacePage 修复
- `handleCreateFirstChapter` 调用 `createFirstVolumeAndChapter`
- `handleCreateChapter` 调用 `createChapterInVolume`
- 创建后直接设置 state，不再依赖 refreshKey

### 存储 key（已验证一致）
| 数据类型 | 写入 key | 读取 key |
|---|---|---|
| volumes | `ai_novel_studio_volumes` | `ai_novel_studio_volumes` |
| chapters | `ai_novel_studio_chapters` | `ai_novel_studio_chapters` |
| drafts | `ai_novel_studio_drafts_list_{chapterId}` | `ai_novel_studio_drafts_list_{chapterId}` |

### 修改文件
- `src/services/chapters/chapterCreationService.ts` — 新增
- `src/components/outline/OutlineManager.tsx` — 使用统一服务
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx` — 使用统一服务
- `src/constants/version.ts` — v1.0.20
- `package.json` — v1.0.20
- `src-tauri/tauri.conf.json` — v1.0.20

---

<a id="v1019"></a>
## v1.0.19

> 原标题：AI Novel Studio v1.0.19 Release Notes
> 原文件：`docs/release-notes-v1.0.19.md`
> 合并前 SHA-256：`11289EC712439C8516502205865497EF1E8C73CACF77D37EFBECB541A3998DB8`


### 版本主题
工作台单一数据源重构 — 彻底修复创建后 UI 不更新

### 根因分析
之前 VolumeTree 维护独立的 useState(volumes/chapters)，通过 useEffect 加载数据。父组件创建数据后只更新自身状态，VolumeTree 不重新渲染（即使用 refreshKey 补丁也不彻底）。

### 本次重构

#### VolumeTree 改为完全受控组件
- 删除内部 `volumes`/`chapters`/`loading` 状态和 useEffect
- 所有数据由父组件通过 props 传入
- VolumeTree 只保留 UI 状态（expandedVolumes、弹窗状态）
- 创建操作通过 `onCreateVolume(title)` / `onCreateChapter(volumeId, title)` 回调父组件

#### WritingWorkspacePage 单一数据源
- 新增 `volumes` 状态
- 新增 `reloadWorkspaceData()` — 统一从 service 重载所有数据
- 新增 `handleCreateVolume` / `handleCreateChapter` — 父组件执行写入+重载
- `handleCreateFirstChapter` — 创建后直接 setState（不再依赖 refreshKey）
- 初始加载同时获取 volumes、chapters、novel

#### 数据流
```
用户点击创建 → 父组件写入 service → 反查验证 → setVolumes/setChapters
→ VolumeTree 通过 props 立即刷新 → 空状态消失 → 章节树显示
```

### 存储 key
- volumes: `ai_novel_studio_volumes` (localStorage)
- chapters: `ai_novel_studio_chapters` (localStorage)
- drafts: `ai_novel_studio_drafts_list_{chapterId}` (localStorage)
- 写入/读取完全一致

### 修改文件
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx` — 单一数据源
- `src/components/workspace/VolumeTree.tsx` — 完全受控组件
- `src/constants/version.ts` — v1.0.19
- `package.json` — v1.0.19
- `src-tauri/tauri.conf.json` — v1.0.19

---

<a id="v1018"></a>
## v1.0.18

> 原标题：AI Novel Studio v1.0.18 Release Notes
> 原文件：`docs/release-notes-v1.0.18.md`
> 合并前 SHA-256：`95EEB5EE9BD31B6659D4A9BA51A66571D7E0D263B765FCE0B86F477A41ECB67D`


### 版本主题
修复首卷首章创建后数据不落库的问题

### 用户反馈
点击「创建第一卷并新建第一章」后按钮短暂显示「创建中...」然后恢复原状，但未实际创建任何分卷/章节。

### 根因分析
**VolumeTree 独立状态未刷新**：VolumeTree 组件有独立的 `useState(volumes/chapters)`，通过 `useEffect([novelId])` 加载。父组件 `handleCreateFirstChapter` 成功后虽然更新了父组件的 `chapters` 状态（使空状态 overlay 消失），但 VolumeTree 的 **useEffect 不会重新触发**（因为 `novelId` 未变），导致章节树仍显示旧的空数据。

### 本次修复

#### 1. 新增 `treeRefreshKey` 刷新机制
- `WritingWorkspacePage` 新增 `treeRefreshKey` 状态
- 创建数据成功后 `setTreeRefreshKey(k => k + 1)` 递增令牌
- `VolumeTree` 接受 `refreshKey` prop，`useEffect` 监听 `[novelId, refreshKey]`
- 令牌变化时强制 VolumeTree 重新加载数据

#### 2. 新增写入后验证
- `handleCreateFirstChapter` 中 create 完成后立即调用 `getByNovelId` 验证数据可读
- 验证失败抛出明确错误（「分卷/章节创建后无法读取」）
- 阻止创建"成功"但实际无数据的情况

#### 3. 版本号
- 所有版本引用统一到 v1.0.18

### 修改文件
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx` — treeRefreshKey + 写入验证
- `src/components/workspace/VolumeTree.tsx` — refreshKey prop + useEffect 依赖
- `src/constants/version.ts` — v1.0.18
- `package.json` — v1.0.18
- `src-tauri/tauri.conf.json` — v1.0.18

### 构建产物
- Release EXE: `F:\ai-novel-studio\src-tauri\target\release\AI Novel Studio.exe` (18:35:58)
- MSI: `bundle\msi\AI Novel Studio_1.0.18_x64_en-US.msi`
- NSIS: `bundle\nsis\AI Novel Studio_1.0.18_x64-setup.exe`

---

<a id="v1017"></a>
## v1.0.17

> 原标题：AI Novel Studio v1.0.17 Release Notes
> 原文件：`docs/release-notes-v1.0.17.md`
> 合并前 SHA-256：`7EE5EE57F631FF2B59AE44099220927D39920997A6B6299EA2D780EBBDA452CC`


### 版本主题
修复工作台首章创建按钮 + 统一版本号显示

### 用户反馈问题
1. 工作台「创建第一卷并新建第一章」按钮点击后无作用
2. 右上角版本号仍显示 v1.0.13

### 根因分析
1. **版本号硬编码**：`TopBar.tsx` 和 `Sidebar.tsx` 中直接写了 `v1.0.13` 字符串，导致即使打包更新，UI 仍显示旧版本
2. **无调试日志**：按钮处理函数缺少日志，无法判断是未触发还是执行失败

### 本次修复

#### 版本号统一
- 新增 `src/constants/version.ts`：统一管理 `APP_VERSION` 和 `APP_PLATFORM_LABEL`
- `TopBar.tsx`：引用 `APP_VERSION` 常量（替换硬编码 `v1.0.13`）
- `Sidebar.tsx`：引用 `APP_VERSION` 常量（替换硬编码 `v1.0.13`）
- `SettingsPage.tsx`：引用 `APP_VERSION` 常量（替换硬编码 `v1.0.16`）
- 所有版本号统一到 `v1.0.17`

#### 按钮链路增强
- `handleCreateFirstChapter` 添加完整 `console.info/error` 日志链
- 可追踪：create volume → create chapter → create draft → reload tree → set state 每一步

#### 版本号更新
- `package.json`: 1.0.16 → 1.0.17
- `src-tauri/tauri.conf.json`: 1.0.16 → 1.0.17

### 修改文件
- `src/constants/version.ts` — 新增
- `src/components/topbar/TopBar.tsx` — 版本号引用
- `src/components/sidebar/Sidebar.tsx` — 版本号引用
- `src/pages/Settings/SettingsPage.tsx` — 版本号引用
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx` — 调试日志
- `package.json` — 版本号
- `src-tauri/tauri.conf.json` — 版本号

### 构建验证
- `npm run build` ✅
- `npm run tauri build` ✅（清理旧 dist + EXE 后重新生成）
- Release EXE: LastWriteTime 2026/5/17 18:26:23

---

<a id="v1016"></a>
## v1.0.16

> 原标题：AI Novel Studio v1.0.16 Release Notes
> 原文件：`docs/release-notes-v1.0.16.md`
> 合并前 SHA-256：`DA9D0AF42EE6A1688511D67F17F7533C3D4CEBC2623E77342AD34469229E8FC3`


### 版本主题
写作工作台内直接创建分卷与章节

### 新增功能

#### 1. 无章节作品可在工作台直接开始创作
- 无章节作品进入工作台后，显示「📖 创建第一卷并新建第一章」按钮
- 点击后自动：创建第一卷 → 创建第1章 → 创建空草稿 → 进入编辑状态
- 不再需要返回作品详情页手动创建

#### 2. 左侧章节树内嵌新建分卷/章节
- 章节树标题栏新增「+ 章节」「+ 分卷」按钮
- 点击「+ 分卷」弹出表单，输入分卷名称即可创建
- 点击「+ 章节」弹出表单，可选择所属分卷并输入章节标题
- 无分卷时新建章节会自动创建第一卷

#### 3. 每个分卷内可新建章节
- 展开分卷后底部有「+ 在本卷新建章节」入口
- 创建后章节树立即刷新，新章节自动选中

#### 4. 创建章节自动生成空草稿
- 新建章节时自动创建空草稿（content=""）
- 正文编辑区立即可用，显示空状态提示

### 修复内容
- 版本号统一更新到 v1.0.16
- 修复 TypeScript 类型错误（refreshChapters 返回类型）

### 技术实现
- `WritingWorkspacePage.tsx`：新增 `handleCreateFirstChapter`、`refreshChapters`、`handleChapterCreated`
- `VolumeTree.tsx`：重写，新增 `handleCreateVolume`、`handleCreateChapter`、`handleOpenNewChapter`、内联弹窗

### 修改文件
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx`
- `src/components/workspace/VolumeTree.tsx`
- `package.json`
- `src-tauri/tauri.conf.json`
- `src/pages/Settings/SettingsPage.tsx`

### 测试建议
1. 新建作品 → 进入工作台 → 点击「创建第一卷并新建第一章」→ 验证章节树和正文区
2. 有作品 → 进入工作台 → 点击「+ 分卷」→ 创建第二卷 → 验证
3. 展开分卷 → 点击「+ 在本卷新建章节」→ 创建→验证自动选中和刷新
4. 关闭软件重开 → 数据仍存在

---

<a id="v1015"></a>
## v1.0.15

> 原标题：AI Novel Studio v1.0.15 Release Notes
> 原文件：`docs/release-notes-v1.0.15.md`
> 合并前 SHA-256：`9F42CD8B3ED764A14638BC7D8EC12FA410463FC3CB782C93955ADF4F19171062`


### 版本主题
作品详情 → 写作工作台链路修复

### 用户反馈问题
从作品详情页点击「进入写作工作台」后无法进入、渲染失败、卡死或空白。

### 根因分析
1. **无章节作品进入工作台无保护**：当作品没有任何章节时，WorkspacePage 的 `activeChapter` 为 undefined，虽然 EditorArea 内部有 `!chapter` 保护，但整体页面结构仍可能因缺少显式空状态导致异常。
2. **novel 未找到时无保护**：`novelRepository.getById` 返回 null 时，页面缺少显式的「作品不存在」状态。
3. **版本号不一致**：`tauri.conf.json` 仍为 v1.0.13。

### 本次修复内容

#### 1. WorkspacePage 加载状态机
- 新增 `WorkspaceLoadState` 类型：`'loading' | 'ready' | 'novel_not_found' | 'error'`
- 替代原来单一的 `pageLoading/pageError` 布尔组合

#### 2. 无章节空状态
- 当 `loadState === 'ready' && chapters.length === 0` 时显示友好空状态
- 提示用户返回作品详情页创建章节
- 不会崩溃、不会白屏

#### 3. 作品未找到状态
- 当 `novelRepository.getById` 返回 null 时显示「作品不存在或本地数据已损坏」
- 提供「返回首页」和「修复本地数据」按钮

#### 4. 初始草稿加载
- 页面加载时自动加载第一个章节的草稿（如有章节）
- 避免用户手动点击章节后才加载草稿

#### 5. 版本号更新
- `package.json`: 1.0.13 → 1.0.15
- `src-tauri/tauri.conf.json`: 1.0.13 → 1.0.15
- 设置中心显示: v1.0.13 → v1.0.15（已在 v1.0.14 中更新）

#### 6. 路由验证
- 路由：`/novels/:novelId/workspace` ✅
- 详情页按钮跳转：`/novels/${novel.id}/workspace` ✅
- WorkspacePage 参数：`useParams<{ novelId: string }>()` ✅
- 三者完全一致

### 安全格式化验证
- `EditorArea.tsx`: 使用 `formatDateTime`、`formatNumber` ✅
- `StatusBar.tsx`: 使用 `formatNumber` ✅
- `NovelCard.tsx`: 使用 `formatDate`、`formatNumber` ✅
- 全项目 `.toLocaleString(` 搜索：仅出现在 `src/utils/` 中 ✅

### 测试建议

#### 无章节作品测试
1. 新建作品（不创建章节）
2. 进入作品详情页
3. 点击「进入写作工作台」
4. 应显示「当前作品还没有章节」空状态
5. 不崩溃、不白屏

#### 有章节作品测试
1. 选择有章节的作品
2. 进入作品详情页
3. 点击「进入写作工作台」
4. 应显示章节树和正文区
5. 重复进入 3 次不卡死

#### 打包版验证
```bash
npm run build
npm run tauri build
# 双击最新 exe 验证
```

### 修改文件
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx` — 加载状态机、空状态
- `src-tauri/tauri.conf.json` — 版本号
- `package.json` — 版本号（v1.0.14 已更新）
- `docs/release-notes-v1.0.15.md` — 本文件

---

<a id="v100"></a>
## v1.0.0

> 原标题：AI Novel Studio v1.0.0 发布说明
> 原文件：`docs/release-notes-v1.0.0.md`
> 合并前 SHA-256：`7EC7C81989E94B14D4D957689767001FDDF24A24D88E6BB2827BC91BBB71A424`


### 版本定位

v1.0.0 是 AI Novel Studio 的第一个基础可用版本。它整合了前 9 个开发阶段的所有功能，形成了一个从作品创建到导出成品的完整创作闭环。

### 已实现功能

- 作品管理（创建、编辑、删除）
- 世界背景与规则体系设定
- 主角设定（性格、能力、限制）
- 分卷与章节管理
- 写作工作台（三栏布局 + 右侧 AI 控制台）
- AI 正文生成（Mock / 真实 API）
- 多版本草稿管理（初稿、重生成、编辑、润色）
- 草稿历史与确认采用
- 风格方案（8 维文风控制）
- 输出控制方案（字数、节奏、视角）
- 角色库（手动创建 + AI 候选推荐）
- 本章出场角色关联
- 章节事件管理（必须/禁止标记）
- AI 事件建议
- 章节总结自动生成
- 上下文记录沉淀与调用
- 多维度质量检查（逻辑/设定/角色/连续性/语言/节奏）
- 正文润色（8 种模式，不覆盖原文）
- 导出 TXT / Markdown（章节 + 整本）
- AI 设置（Mock 模式、API Key 脱敏、参数配置）
- 首次使用引导
- 全局错误边界
- 404 页面

### 未实现功能

以下功能计划在后续版本中实现：

- 完整安装包发布
- Word / PDF / EPUB 导出
- 数据备份与恢复
- 云同步
- 多模型智能路由
- 向量数据库 / 全文语义检索
- 角色关系图谱可视化
- 插件系统

### 已知限制

- 浏览器模式下使用 LocalStorage 存储，清除浏览器数据会丢失
- Tauri 桌面模式下使用 SQLite，数据更持久
- 导出使用浏览器下载，Tauri 文件保存对话框待实现
- 完整数据备份恢复功能待后续版本增强

### 后续规划

- v1.1.0：稳定性增强与桌面端体验优化
- v1.2.0：导出格式增强（Word / PDF）
- v1.3.0：数据备份恢复与迁移
- v1.4.0：长篇创作效率优化
- v1.5.0：多作品跨作品资产复用

---
