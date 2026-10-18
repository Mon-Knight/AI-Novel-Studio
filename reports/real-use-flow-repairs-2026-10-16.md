# 三万字真实使用流程修复记录

日期：2026-10-16。版本：3.7.0，非版本发布任务。目标：修复实测分析中的九类问题。当前状态：定向检查与集成验证中；模型选择修复已打入中间 EXE，人物/章节保存与后续交接补丁仍需最终构建。源材料已校准 25/30 项，剩余 5 项及真实模型流程尚未收口。下列结果复用本批已经完成的执行记录；新增改动须另行验证，不把文档收口记为重新运行全部测试。

## 实测基线

历史依据：[三万字操作记录](desktop-real-novel-30000-2026-10-15.md)。十章正式稿 35043 字、34896 汉字，十章总结已应用，桌面 TXT 与采用稿一致。历史事实保持，不以本批代码覆盖旧失败记录。

只读核对隔离作品确认，启用规则《纸质物证初筛与司法保全规范》原先允许喷水醒纸、揭裱分层，而采用正文明确禁止。这个输入冲突已经证实；不能据此断言每次模型错误的具体来源。该规则已通过真实 UI 保存纠正，其他准备模板、世界背景、人物及大纲材料仍按逐项核对计划处理，不能因一条规则修改就宣称全部源材料一致。

## 实现与验收矩阵

| 问题                   | 当前修改                                                                                | 完成证据要求                                     | 状态                                    |
| ---------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------- |
| 正文改文与源设定脱节   | 编辑器核对入口、完整材料、既有影响预览/确认、事务内采用稿引用复验；正式章纲同步章节材料 | 真实编辑源设定及失效基线零写入                   | 定向前端与原生通过，桌面进行中          |
| 总结升级未知/计划      | 断言状态、原文摘录、字段覆盖、采用稿哈希与完整来源复验                                  | 新候选严格准入、旧记录兼容提示、真实模型总结审阅 | 定向前端与原生通过，真实模型/桌面待完成 |
| 失败恢复错误           | 按失败执行阶段恢复、宿主契约、能力隔离、历史来源复核                                    | 原失败回合与新故障回合可恢复，权限/预算不放宽    | 集成中                                  |
| 字数修订振荡           | 最近合格程度基稿、实测差额和历史、输入区有效范围预览                                    | 原区间内修正并形成候选，实际长度轨迹可查         | 预览定向通过，运行时待验收              |
| 模型默认不一致         | 按全项目持久模型选择时间继承、来源标识、总结进入来源任务                                | 新会话/总结/重试模型正确且可见                   | 定向通过，桌面待完成                    |
| 采用后交接繁琐         | 总结状态、精确来源导航、拒绝后重做与独立调度                                            | 多章待总结不互相阻塞，不自动发送或采用           | 定向通过，桌面待完成                    |
| 等待与错误误导         | 事件驱动的真实阶段、重试说明、原错误链                                                  | 超时/权限/校验错误对应真实状态                   | 集成中                                  |
| 导出缺章风险与重复标题 | 全正式稿校验、实测统计、保存阶段回执、规范章号及卷章排序                                | 原生保存与全文逐章核验，读取失败整本拒绝         | 22 项定向通过，桌面待完成               |
| 修订意图识别脆弱       | 依据绑定来源限定设定/大纲修订范围，核对章节引用和否定措辞                               | 真实复现指令不误入写章，矛盾指令仍拒绝           | 路由/发送定向通过，桌面待完成           |

## 已执行的定向验证

- `npx vitest run src/test/components/ChapterSourceReview.test.tsx`：扩展后 9/9 通过，包含冲突刷新保留输入、切章、迟到响应、停用资产与离开未保存提示。初轮 3 项测试合跑时，其中 2 项因测试使用了未安装的 Chai DOM matcher 失败；改用原生 disabled/value 断言后通过，未改变产品门禁。
- `npx tsx --test src/components/novel-detail/SettingEditForm.test.tsx src/pages/NovelDetail/NovelDetailPage.test.tsx`：9/9 通过，覆盖共用编辑表单与人物/主角/章纲导航。源设定相关文件 ESLint、Prettier 与差异检查通过。
- 总结依据：既有本批交接记录为相关 TypeScript 测试 56/56、候选卡与总结 UI 合跑 19/19；去除重复确定性标签后，`npx vitest run src/test/components/SummaryGroundingReview.test.tsx` 7/7 通过，相关 ESLint、格式与差异检查通过。前两项仅保留已有执行结果，没有在本次文档收口时重跑。
- `src/test/components/WorkbenchWordPreview.test.tsx`：3/3 通过，覆盖持久任务设置、本次覆盖、章节回退及读取失败提示。
- `npx vitest run src/test/export/manuscriptExport.test.ts`：22/22 通过，覆盖完整正文、作用域、改采、统计、取消及缺章零导出；补充多卷各自从 0 开始的章序、卷名/卷序变化、稳定排序与分卷归属拒绝，并覆盖采用指针恢复为相同草稿 ID、但正文已经改变的情况。相同导出文件的 ESLint `--max-warnings 0` 通过。
- `npx tsx --test src/services/worldRules/chapterSourceReference.test.ts src/services/worldRules/localRuleGovernance.test.ts`：9/9 通过。
- Composer 与字数策略：11/11 通过；既有行为映射测试5/5通过。
- `npx tsx --test --test-concurrency=1 src/services/conversation/taskGoalRouting.test.ts src/services/conversation/workbenchRetryTarget.test.ts src/services/dsh/taskSessionAdapter.test.ts src/services/dsh/taskRuntimeService.test.ts src/services/conversation/taskRuntimeAdapter.test.ts`：131/131 通过。`npx tsx --test src/pages/Workbench/hooks/useWorkbenchTaskRunner.test.tsx`：19/19 通过；保留绑定修订来源、否定正文和章节引用的边界。
- 模型与总结交接：`chapterWorkflowService.test.ts` 9/9、`useWorkbenchChapterHandoff.test.tsx` 8/8；总结状态提示所在组件合跑 6/6。未再改动的 `projectTaskModel.test.ts` 5/5、`useWorkbenchTaskCreator.test.tsx` 5/5、`chapterSummaryOrchestration.test.ts` 9/9 沿用本批已有结果。交接测试的 Props 推断问题修正后通过，不以运行测试代替类型检查。
- 后续模型选择反例修复：`projectTaskModel.test.ts` 扩展为 12/12，与创建会话 5/5 合跑共 17/17 通过。按持久 `capturedAt` 比较并遍历项目全部分页，旧缺失时间固定回退原会话 `createdAt`，继承不刷新选择时间，后台任务状态更新不抢默认。本轮 `npx tsc --noEmit`、相关 ESLint/Prettier 和差异检查通过。此前 5/5 是旧范围，不覆盖这一轮新增行为；桌面结果另行收口。
- 人工章纲联动：`outline_commands::chapter_source::tests` 6/6 通过（657 filtered），覆盖长内容、未采用版本、切换采用、编辑当前采用版本、同步失败整体回滚、跨作品/删除章节和未关联章节；断言章节目标、标题、字数目标与正文状态不变。`npx vitest run src/services/outlines/outlineService.test.ts` 2/2 通过，覆盖浏览器拒绝及单原生命令失败向上传播。相关 ESLint、Prettier、Rust 文件体积和目标差异检查通过。
- 本批单次 `npx tsc --noEmit` 通过；模型/交接/路由/运行服务相关源文件与测试 ESLint 通过。`node --test scripts/quality/verification-scopes.test.mjs` 8/8，组件体积、测试归属与目标差异检查通过。后续桌面故障载体兼容调整不由这些已有结果覆盖。
- 本轮文档收口：`npm run test:docs-sync` 完整 fixture 回归通过；报告及改动用户指南/数据模型 Prettier 检查通过，CHANGELOG 仅本批段落的 Prettier API 检查通过，目标 `git diff --check` 通过。未全仓库格式化或重跑不受影响的业务测试。
- 本段只是已完成检查，不代表全部集成、Rust、桌面或真实云端通过。其他并行改动的结果在收口后补记。

## 本次复核补充

- 已确认旧 TXT 的章标题重复；旧十章正文内容和顺序核验通过，没有把缺章风险写成该次发生过缺章。
- 多卷读取改为同批获取卷章材料，按卷序和卷内顺序排列；未分卷/分卷信息缺失的正式章保留在独立分组。结束前重新读取采用稿全文，并复核卷标题、排序和章节采用指针，TXT/Markdown 共用这份已校验材料。这是导出读取复验，不是跨多次请求的 SQLite 原子快照。
- 源设定保存冲突后可保留输入刷新正式版本，撤销旧预览确认并显式更新基线；正式采用正文变化仍拒绝沿用旧来源。9项组件回归与9项共用表单/作品详情回归通过，包含切章、迟到响应、停用资产和关闭/跳转未保存提示；真实桌面待验证。
- 上一轮已启动的固定载体准备完成（exit 0），Gateway SHA-256 `30e5bd5f6aa03ee7fdf33b5556f5fb1dd7bf4ff38e91bc1b0ab9317bf458b2b7`；这不是本批 EXE 已构建或桌面已复验的证据。
- 完整原生检查：`cargo check --locked --manifest-path src-tauri/Cargo.toml`通过；`cargo test --locked --workspace --manifest-path src-tauri/Cargo.toml -- --test-threads=1`完成726 PASS、4 ignored、0 FAIL（主应用646、Gateway79、进程级Gateway1）。首次全测试因总结负例fixture缺少错误码导入而编译失败、未执行测试，补全限定路径后全套通过，两个日志分别保留。R4真实云端等显式opt-in未由此验证。
- 上述原生结果包含 4 项采用正文来源复验、5 项总结依据/完整读取测试和 3 项总结事务应用测试。正式总结保存仍记录 `validation_status: pending`、`semanticValidation: not_checked` 与作者已审阅；逐字引句和字段覆盖不等于语义证明。
- 后续补充同 Turn、章节、模型及原冻结范围约束下的历史失败稿全文恢复。`rust-length-history-check.log` 记录后续 `cargo check` 通过；`rust-length-history-domain.log` 记录工作台领域 116 PASS、1 ignored、0 FAIL；显式指定本次隔离库的只读历史核验另有 1/1 通过，见 `rust-existing-length-history-readonly.log`。这些结果证明当时的全文归属、哈希和恢复条件，不证明旧剧情与当前全部源材料一致。
- 后续补齐历史章纲、工程状态、人物及前章正文基线复验：工作台领域 119 PASS、1 ignored、0 FAIL（`rust-length-source-domain.log`），`cargo check` 通过（`rust-length-source-check.log`，保留 16 项既有 warning）。只读历史 probe 1/1（`rust-existing-length-history-stale-readonly.log`）确认原第10章失败稿因后来正式采用及来源变化被安全弃用，不能记成恢复成功。同来源合格基稿重启恢复由 fixture 覆盖；旧回执缺前章全文或完整主角基线、被截断、正式来源变更时均不沿用。字段与类型另与当前 Gateway 实现交叉审查，未发现阻塞；不据此宣称真实模型恢复通过。原始日志均保留在忽略目录 `test-results/real-use-flow-repairs-2026-10-16/`。
- 桌面故障载体支持规划先进入 `chapter_write`、故障仅施加于正文；固定响应子集 25/25、失败证据分类 8/8、归属回归最终 9/9 通过。归属首轮因缺少 safety scope 失败，补齐后通过；acceptance 类型检查与相关 ESLint/Prettier 通过。这些是载体与证据检查，不是真实 API 模型结果。
- `tauri-build-final.log` 记录本轮 `npx tauri build --bundles none` 成功；桌面故障回合日志 `writing-faults-desktop-port24480.log` 仍失败，长度场景未进入候选阶段即出现 `TRANSPORT`，候选尝试为 0，不能当作字数门禁验证。后续模型选择时间修复晚于该 EXE，最终构建与桌面复验仍须收口。

## 源材料校准范围

- 已只读核验采用稿全文及哈希，制作 30 个当前生产字段的桌面修正建议，覆盖准备模板、核心背景/规则、主角能力与限制、人物行为边界、正式总纲/分卷纲/章纲以及独立章节目标。建议保存在忽略目录，未由脚本写入 SQLite；是否已保存须逐项读取正式字段核对，十章正文与采用指针另对照原基线。
- revision 2 首轮只读核验为 1 项已匹配（已通过 UI 保存的纸规则，正文与 `structured.statement` 一致）、29 项待保存、0 个读取错误；8 章的 active 章纲和章节投影仍待校准。十章采用稿 ID、顺序、全文哈希及 35043 字统计均与原基线一致。这是当前进度快照，不是 30 项已完成。
- 当前 Gateway 主角资料按人物档案、作品主角 JSON、旧主角表依次补空。主角设定 UI 保存能力和限制后可覆盖当前空缺字段的旧表回退，但人物档案已有的行为边界仍需独立修正；作品兼容能力概括随主角保存联动。旧主角表未被主角 UI 改写，保留为 informational，不能宣称三份表已自动一致；旧大纲/质量服务仍可能直接读取该表，本批不扩大到旧面板同步。
- 正式章纲采用与 `chapters.outline` 已补同事务联动；章纲正文不能替代独立 `goal` 的作者编辑。新版本仅保存不采用时，不改变正式章节材料。浏览器章纲采用改为明确不支持，避免报告假成功。

## 边界与交付状态

### 2026-10-16 续修核验

- 中间生产 EXE 已于 16:32:57 构建成功，26,960,896 bytes，SHA-256 `D62B1405273898E8F25D2A7D674C62609A9D4B216515F33AD24F75E31354A7B0`，包含按 `capturedAt` 继承模型的修复。构建日志为忽略目录中的 `tauri-build-captured-at-final.log`；后续人物/章节保存及总结交接变更不由该 EXE 覆盖。
- S5 单项桌面复验通过：3 次候选请求、3 次候选工具事件、3 次长度拒绝，0 产物、0 草稿及 0 正文字数变化。证据为 `writing-faults-s5-scoped-result.json`。本次只跑 S5，完整八场景未重跑；原 `TRANSPORT` 未复现，根因仍未知，不将定向通过写为完整套件通过。
- 会话恢复时原桌面进程已经退出；当前会话未发现可用的 Computer Use 插件文件，插件目录查询也未返回该能力。改用仓库已有 WebDriver 依赖与生产 Tauri 驱动，重定向到原隔离配置，通过真实页面控件执行。没有使用浏览器回退、注入领域写入或直接修改 SQLite。
- 通过真实界面保存和解规则及准备模板，总纲、卷纲和第 2/3/4/5/7/8/9/10 章章纲均另存新版本并显式设为采用。只读核验返回 25 个字段匹配、5 个待保存、0 错误；8/8 章纲投影与采用版本一致。待处理项为人物行为限制和第 5/7/9/10 章独立目标。章纲桌面元数据回执为 `outline-ui-save-receipts.json`。
- 本次只读正文核验仍为十章 35043 字、34896 汉字；采用稿 ID、章节顺序和全文哈希与原基线一致。新入口只校准源材料，不把候选自动采用为正文。
- 独立审查新增三项明确修复：旧 DSH 重试不受当前载体开关切换、上下文阶段失败的手动总结可精确定位、章节资料差量保存及版本冲突保护。各补丁的定向结果和最终 EXE/真实桌面结果须分别补记，当前不宣称全部完成。
- 上述续修定向结果：旧载体开关重试与缺失契约拒绝 25/25；导出全宽章号及连续前缀修复后 32/32（修复前 6 项失败）；人物原生 9/9、章节资料原生 7/7；总结作用域 5/5、重试域 6/6；前端人物/章节等合跑 45/45、追加绑定角色回归后人物相关 15/15，作品详情路由 9/9；总结交接 43/43、Artifacts 26/26。最终类型、目标 lint/格式、尺寸及验证归属检查通过。各测试针对不同改动，不相加为未执行的全仓库验收。
- 章节大纲第一次桌面脚本等待成功弹窗自动消失而超时。重新读取真实窗口确认已显示“章节大纲已保存”，点击“完成”后继续采用已保存 v2，没有再次保存同一份内容；后续脚本明确处理完成按钮并做编辑框全文回读。该问题是操作脚本的等待条件错误，没有把它记录为产品保存失败。
- 文档同步一次在临时 fixture 文件写入时遇到占用异常，原命令完整复跑通过；保留首次失败事实，未更改文档门禁。

未新增 migration、依赖或升级固定载体。未提交、推送、打 tag 或发布；保留大量会话开始前已有改动。正文/凭据/正式数据库不提交。桌面复验沿用隔离配置并保留旧失败记录，模型候选不自动写为正式正文。

本地 `src-tauri/target/release/AI Novel Studio.exe` 已包含模型选择时间修复；后续人物/章节保存及总结交接补丁仍须打入，并完成受影响真实桌面和真实模型场景。当前不声称可交付完成。
