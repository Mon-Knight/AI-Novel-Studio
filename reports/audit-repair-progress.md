# v3.7.0 审计修复进行记录

## 边界

- 用户授权完整修复本轮已确认缺陷，明确选择生产持续学习另项实施。
- 保持 3.7.0，不改已发布迁移、不新增依赖、不升级 DSH、不提交/推送/tag/发布。
- 用户允许必要的真实模型测试；已告知上限为一个验收回合、6 次上游请求（含重试）。目前真实模型调用 **0**。所有实际云调用由父代理统一安排，子代理不得调用。
- 不访问正式用户数据库；桌面验收使用隔离配置/SQLite，最终按 AGENTS 更新仓库 release EXE。
- 开工已有修改：CHANGELOG、docs/README、docs/ai-agent-roadmap、docs/feature-gap-analysis-v3.7.0、docs/version-roadmap；已有多个未跟踪 reports。均须保留。

## 并行所有权

- 数据：89020b80-4aba-4373-90d7-c03edf4ce7b9，备份恢复授权/请求号映射、purge 全作品依赖及临时 SQLite 回归。仅 project_backup 子域与 project_service。
- 写章：35e2d02c-3669-4003-b16c-3e2661b2cfea，taskSessionAdapter、writingSubAgentContract、taskRuntimeService、原生 dsh/task_runtime*。方案为原生复验前章 + draft/admit 两阶段候选（共享原生 3 次候选、480 秒预算，不复制 TS 启发式）。必须复核取消/重启/幂等/跨作用域/总预算。
- 工作台：40942407-c270-4bb1-a5fd-ccb0054982eb，分页 IPC、taskConversationService UI window API、工作台刷新/忙锁/冲突目标；已授权窄改 commands/conversations.rs 与 main.rs。保留完整 get 给安全操作；新 get_task_conversation_window 与 list_running_task_targets。
- 检索：c1059356-822c-4555-b99a-64fc197788e5，Gateway tools + shared/memory_lexical_retrieval.rs + memory_service 窄改与双入口 SQLite 对照。
- 安全：9371adde-2fb5-48a5-a2ca-c7d362c5ba38，Tauri CSP/静态 FS scope、scopedDesktopFs 与最小导入/导出联动。Tauri dialog 自动授予所选文件动态 scope 已核对。
- R4：c81efbd9-d674-48dd-8950-74588725b9c3，真实 Canonical-only cloud opt-in 执行载体，显式预算/凭据隔离/取消/脱敏；禁止实际 cloud。新增测试/脚本接线由父检查。
- 父：采用 warning 门、quality/CI/完整验证脚本、离线故障 runner、生产性能测试接线、文档/CHANGELOG、最终集成与验证/EXE。

## 父已落实现

- 采用门只对 severity=error 拒绝；warning 仍由作者显式采用；桌面/浏览器回归覆盖 warning-only 和 warning+error。
- 完整 Rust 命令增加 --workspace（selector、Windows CI、verify_project），不再漏 Gateway。
- 删除 native source size 泛兜底，给现有遗漏原生模块显式行为归属，未知 Rust 失败关闭。
- Ubuntu CI 改 test:all；Windows main 与大型 PR 执行校准的 coverage，Windows Node=24。
- 新 scripts/e2e/run-writing-fault-injection.mjs 与测试：零凭据、隔离生产 EXE、复用 .e2e-tools/target 依赖缓存、固定 loopback 规格，不调 cloud；新 npm test:e2e:writing-faults。
- selector 新 faultInjection 标记，DSH/写章契约/完整与打包门禁执行；Windows CI PR 用 selector，非 PR 显式执行；完整 verify_project 接入。
- check_docs_sync/test_docs_sync/PR 模板已同步 --workspace 的关键命令字符串。

## 已执行验证

- `npm run test:coverage`：全量 lines/statements 62.6%、branches 80.46%、functions 67.57%；核心 lines/statements 87.77%、branches 82.27%、functions 82.14%；关键组件覆盖率通过。
- `cargo test --locked --workspace --manifest-path src-tauri/Cargo.toml -- --test-threads=1`：主应用588 passed / 3 ignored；Gateway 74 passed + 1跨进程 passed。
- `npm run test:e2e`：真实Windows Tauri、隔离SQLite、固定Mock，24/24规格通过；写作冒烟证据包含 warningOnlyAdoption=true、sameLibraryBackupCopy=true。
- `npm run test:e2e:browser`：Edge/WebView compatibility 8/8规格、72/72用例通过。
- `npm run test:e2e:writing-faults -- --skip-build --app .e2e-tools/target/release/AI Novel Studio.exe`：隔离生产载体8/8故障场景通过；初次失败原因为缺少显式Gateway路径，补 `DSH_GATEWAY_BIN` 后重测通过。
- `npm run test:docs-sync`、`npm run test:version-sync`、`tsc --noEmit`、`npm run lint:ci`、体积门禁、bundle-size和`git diff --check`通过。
- `npm run test:agent-runtime:real` 的受控R4入口已实现并有离线负例；本轮按用户选择不运行真实云端，真实模型调用0次。

## 安全专项收口

- sidecar helper 已收紧为唯一固定文件名 `.ai-novel-studio-local-model-lifecycle.json`；单文件对话框路径支持本地盘、UNC和扩展UNC，路径穿越/邻近路径/目录/多选仍失败关闭。scoped FS 8项、CSP契约3项、model lifecycle 12项通过。
- 真实WebView2 CSP响应头和原生picker/save专门攻击/响应证据仍未建立，但普通生产桌面流程已通过。
- 最终安全EXE已重建：`src-tauri/target/release/AI Novel Studio.exe`，26,574,336 bytes，SHA-256 `16C361479401D2FFDA9C7FFA674A75847D869189F6561A16105B781791AF0276`，2026-09-27 15:55:02 +08:00。

## 保留限制

- 生产持续学习/策略持久化/晋升回滚未实施，按用户选择另项处理。
- R4 live provider未运行，因此Canonical只读真实云端自主工具调用仍不能标VERIFIED；loopback、离线载体和静态契约不能替代真实云证据。
- 现有Rust dead-code警告和Vite dynamic import提示保留，未影响门禁；浏览器和桌面日志中的预期warning不等于测试失败。

## Git与范围

- 分支：`codex/v3.7.0-writing-subagent`；未提交、未推送、未创建PR、未打tag、未发布。
- 用户原有文档修改和未跟踪reports全部保留；工作区仍dirty，未执行清理或重置。
- 未改应用版本、已发布migration、备份schema、依赖或DSH固定提交；没有读取正式用户数据库、正文或凭据。

## 2026-10-13 追加：Router v7 与上下文覆盖故障

本节是后续任务的独立证据，不改写上方 2026-09-27 批次的验证范围。保持应用 v3.7.0；本轮依用户要求升级 Router 主版本，DSH 固定提交仍为 `47f943859bef60e4160492346772ded9b24f765a`。

### 本轮修复

- `package.json` / `package-lock.json`：生产路由依赖锁定 `react-router-dom` / `react-router` 7.18.4；保留现有 HashRouter 和路由功能，不引入新的技术栈。
- `src/test/routerExports.ts` 与路由测试：Vite SSR 测试使用同一模块图，移除 v6 专属 future flags。
- `src/pages/Workbench/hooks/useWorkbenchIntent.ts` 与新回归：Router v7 transition 清理意图前，按 history entry 一次消费；修复搜索/新建任务意图重入的同步更新循环。这是全量 Vitest 原先 OOM 的确定根因，不通过关闭 transition 或降低门禁规避。
- `scripts/dsh/carrier-freshness.mjs`、`prepare-bundle-assets.mjs`、`unpack-payload.mjs` 及回归：旧载体补当前 Gateway 哈希，独立打包解压脚本不再导入未随包发布的模块；验证新载荷之后才替换，失败保留原副本。
- 标准故障 runner 同步使用独立解包验证后保留的 `.payload-verify/dsh-runtime`，不再错误校验可能过期的 `.payload-staging`；skip-build 仍复验固定提交、矩阵记录和当前 Gateway，不通过就不启动桌面。
- `src-tauri/build.rs`、`src-tauri/src/services/dsh/config.rs` / `config_tests.rs`：当前 Gateway 哈希编入 EXE；旧 AppData 副本即使自身矩阵与二进制一致，也不能冒充当前构建。保留上下文覆盖失败关闭，未把旧读结果当作完整上下文。
- 解包中断恢复：验证所有 Junction manifest 相对路径和关键入口的实际目标；带 Junction 的暂存载体保留并交给独立解包器重建，无链接载体原生恢复使用备份/失败恢复，拒绝根与暂存父目录 symlink。大载体不在每次 health 中遍历全部 pnpm 实际目标；本次校验不声称第三方包内容全量完整性。
- `src/services/conversation/workbenchFailure.ts` 与回归：`DSH_CONTEXT_INCOMPLETE` 明确提示本回合重新读取或补全/缩小材料，不再误提示只检查 API Key。已存在的失败回合与候选不删除、不自动采用。
- `CHANGELOG.md`、README、桌面构建与用户工作流文档同步实际行为；不升级应用版本、不改 migration 或备份 schema。

### 已验证与证据边界

- `npm ls react-router-dom react-router`：两者均为 7.18.4。
- `npm audit --omit=dev --audit-level=moderate`：2026-10-13，0 个生产依赖漏洞；不等于开发工具依赖或所有软件漏洞清零。
- `npm audit --json`：2026-10-13，全依赖仍报告 40 项（3 moderate / 35 high / 2 critical）；这些开发工具依赖问题未在本轮擅自扩展升级。
- `npm test`：本批依赖变更后 568 passed / 0 failed。
- `npm run test:vitest -- --maxWorkers=4 --minWorkers=1`：修复意图循环后 63 个文件、325 用例全部通过；此前失败的 OOM 不列作通过。
- `npm run test:workbench`：Node 53 passed、TSX 428 passed，0 failed。
- 其余依赖影响检查：`npm run test:discovered` 106 个补充文件，Node 119 / TSX 315 / Vitest 121，共 555 passed；`npm run test:ai-panels` 7 passed；`npm run test:performance` 7 passed，GC 内存用例未跳过。各命令 exit 0；SSR/内部 HMR 端口 warning 保留，不等于生产桌面或真实浏览器通过。
- `cargo test --locked --workspace --manifest-path src-tauri/Cargo.toml -- --test-threads=1`：主应用 590 passed / 3 ignored，Gateway 74 passed + 1 跨进程 passed。使用已核验固定载体和当前 Gateway；ignored 的真实云端等 opt-in 项不宣称通过。
- 上述完整 Rust 检查后追加的中断恢复修补：`node scripts/quality/run-cargo-tests.mjs --filter services::dsh::config::tests::` 明确发现 18 项，17 passed / 1 只读 timing opt-in ignored；随后显式指定隔离 carrier，执行该 timing exact / `--ignored`，1 passed，真实 5452 个 manifest 路径和 116 个关键实际目标校验耗时 141 ms。
- `cargo check --locked --manifest-path src-tauri/Cargo.toml`、`npm run lint:ci`、生产 Tauri 构建中的 TypeScript / Vite 构建通过。
- `npm run test:ownership`、`npm run test:component-size`、`npm run test:rust-file-size`、文档/版本同步通过。未对整个 dirty 工作区执行重置、清理或全仓格式化。
- 未设置 `DSH_RUNTIME_ROOT` / `DSH_GATEWAY_BIN` 的隔离生产桌面复测：`router-v7-dsh-bundled-final-2026-10-13T05-09-32-938Z`，8/8 passed，命令 exit 0。真实 Tauri、隔离 SQLite、当前 EXE 自行解包、固定 loopback 响应；覆盖越权/跨作品拒绝、上游失败与显式重试、短候选拒绝、字数设置持久化、超长修订及强杀后的失败关闭/重试恢复。启动时一次 `DevToolsActivePort` 驱动 warning 经既有重试恢复，未忽略失败或放宽行为断言。
- 首次生产桌面运行：`router-v7-dsh-bundled-2026-10-13T04-58-01-387Z`，3 passed / 5 failed；默认解包得到当前 Gateway（SHA-256 `49d21e75068082e2df07920280a7786c331b836bdfec5184f83b75ebf8ce337a`），覆盖凭据与候选链通过。后五项点击失败的只读证据为可用视口仅 132×23、无弹窗遮挡、按钮未禁用，最终截图仅标题栏；不能归为已证明的模型或 DSH 重试失败，也不计作通过。
- `tests/real-acceptance/production-carrier-viewport.ts` 与回归：仅隔离测试载体恢复并校验不可用窗口，保留真实点击与全部行为断言；正常可用窗口不改变。夹具 5/5、目标 ESLint/Prettier、生产测试 TypeScript 与行为归属通过，实际复测为上方 8/8。
- 标准 runner 缓存修补的 Node 回归 12/12、Prettier、`node --check` 与 diff 检查通过；再次运行 `npm run dsh:assets` 并对真实 `.payload-verify` 执行 `verifyWritingFaultCarrier`，固定提交/三方 Gateway 哈希及计划运行路径一致，通过。仅实际前置检查，没有重复启动标准 runner 的八场景；默认 AppData 的八场景证据见上方。
- 对三个 Node `.mjs` 直接执行原始 ESLint CLI exit 1：仓库配置为浏览器全局，Node 的 `process` / `Buffer` 及脚本 console 报错；未改配置或关掉规则。正式 `lint:ci` 的 TypeScript 范围通过；上述脚本以实际 Node 语法与行为回归验证，不将这次额外手工 lint 失败写成通过。
- 路由升级的真实桌面 `ux-round2.spec.ts` 首次 3 passed / 1 failed；Ctrl+K / 专注退出、读取分组与世界规则流程通过。第一项失败为布局测试在侧面板既有入场动画结束前返回稳定矩形。只修改测试 fixture：相邻两个样本均无布局动画才认定稳定，保留采样间隔、产品 CSS 和最终断言；纯函数回归 4/4、目标 lint/格式/类型及归属通过。
- 复用同一批刚构建的 E2E EXE 后，`router-v7-desktop-final-2026-10-13T05-22-48-568Z` 的 `ux-round2.spec.ts` 4/4 passed，exit 0；真实 Tauri、隔离 SQLite、固定 Mock，包含 Ctrl+K 和 1024/1440 布局检查。1024 窄窗按产品规则使用 overlay，日志明确不声称该尺寸覆盖不适用的 docked 列；1440 场景单独检查。未重复编译或把首次失败改写为通过。

### 当前本地 EXE

- `npm run dsh:assets` 与 `npx tauri build --bundles none` 已执行；追加原生恢复修补后再次执行生产 Tauri 构建，未生成安装包或 updater。
- `F:\ai-novel-studio-hotfix-v321\src-tauri\target\release\AI Novel Studio.exe`：26,554,368 bytes，2026-10-13 13:09:02 +08:00，SHA-256 `D4C36BF738B263AF25705BA57530FCA4271A9AB01142E1898629CB8EC8DCF2F5`；上述默认 bundled 桌面 8 场景使用这个产物。

### 保留边界

- 正式用户库和正文未读取、未改写；本地响应不等于真实云模型验收，R4 live 仍 NOT VERIFIED，真实云调用 0 次。
- 未执行完整发布矩阵、安装包签名或发布；未提交、推送、建 PR 或打 tag。原有用户修改和未跟踪资料保留。
- 上方“未改依赖”和旧 EXE 哈希仅描述原批次；本节 Router 升级与最终 EXE 使用后续终态记录。
