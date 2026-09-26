# 第二轮体验优化与统一验证跟踪

> 2026-09-18 收尾更新：本文件保留前一轮实施记录；后续统一检查、失败修复及 EXE 证据见 [收尾报告](closeout-2026-09-18.md)，不要将下方原 NOT_RUN 或历史日志当成本轮最终结果。

> 非版本任务，保持 3.7.0。用户要求结合优秀案例继续优化，并通过问题工具明确选择新增正式兼容 migration。当前仅实现收口中；未开始第二轮统一验收。第一轮的口头通过声明不作为本轮证据。

## 设计目标

- 主对话仍是中心：成功读取过程渐进折叠，错误/警告/运行中不可隐藏。
- 参考面板默认临时，只有作者明确固定才占参考列；标题栏动作始终可达。
- 专注是可逆的会话布局，不改持久侧栏偏好、不丢草稿或停止任务。
- 候选首屏显示可识别名称、来源与下一步；版本标签不是采用授权。
- 世界背景与单条规则按需填写，事实和角色认知分开；预览不等作者批准。

## 案例依据与证据等级

参考 VS Code 布局/专注工作方式、Scrivener 无干扰写作/Inspector、Windows flyout 和 W3C disclosure/dialog 的行为分工，不复制界面。官方URL已搜索定位，但web_fetch受限，本轮只把它们作为参考入口，不声称逐条核验官方正文。

- https://code.visualstudio.com/docs/configure/custom-layout
- https://www.literatureandlatte.com/blog/distraction-free-writing-with-scrivener
- https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/dialogs-and-flyouts/flyouts
- https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/

历史截图只用于观察拥挤/遮挡：test-results/workbench-layout/workbench-1440x900.png、workbench-side-context-1024x700.png；不是第二轮桌面证据。第二轮将保留新的实际截图和测量结果，不清理证据。

## 当前分工（独占，避免交叉覆盖）

| 所有者 | 范围 | 状态 |
| --- | --- | --- |
| 8d08926a-1697-42db-93f5-88583b40e69d | AppShell/FrameBar、Page/header/sidepanel/Composer、focus context、app-shell/workbench-zcode及测试 | 实施中 |
| 7681bb5b-6b24-4b5e-afc0-80b85abc11eb | Stream/Turn/Components/Readiness、分组与reading、workbench.css及测试 | 实施中 |
| 31a42ff6-3310-4fa8-a758-81f7c18e86aa | 世界规则渐进UI/摘要/影响复核、novel-detail.css及测试 | 实施中 |
| b2f009a6-c0f6-46e2-93da-431c9b3c8654 | 039兼容migration独立复核与防护、相关测试 | 实施中 |
| 221dfcfe-d940-4eda-9e69-4e8bdfdecb11 | 恢复两道尺寸ratchet与相邻测试，不加阈值豁免 | 实施中 |
| c1f6729d-7f88-43aa-a658-55696a548c2e | browser规则严格guard + 3个合法seed fixture适配 | guard已落，fixture收尾 |
| 父 | 跨模块接口、统一文档/验收注册、证据、EXE | 实施中 |

## 必须恢复的安全基线

1. localRuleGovernance缺guard拒绝，不能服务自签作者确认；需要用明确预览/guard适配隔离fixture，而非改产品以满足旧test。
2. 已降至500行以下的legacy模块删除baseline条目并回到500硬上限，删除MIN_LEGACY_KEEP_LINES后门。
3. 已发布010原文/definition/checksum保持；用户授权新增039使旧库与新库跨task lineage一致，所有已有行/回执/引用和作者守卫保留。迁移实现必须经真实SQLite重开/回滚/FK验证。
4. 布局验收等待真实终态后保持1-2px对齐，不以17px/8px容差容忍动画中状态；不清未知异常。

## 共享接口

Stream可选presentationContext={novelId,novelTitle,chapters:[{id,title}]}；Page只传匹配作品数据。onInsertExample(text)只追加当前草稿并聚焦，不send/run/采用。

## 统一验证计划（均待执行）

实现、回归和文档完成后才执行：
- 变更文件Prettier/ESLint、一次TypeScript检查；合法测试归属检查。
- 相邻行为测试涵盖临时/固定、专注恢复、IME、header几何、候选识别与分组锚点、规则预览/明确确认/缺guard零写。
- 039真实SQLite旧库升级/重开/回滚与完整相关Rust检查，固定载体与Gateway仍沿既有契约。
- 真实浏览器宽窄(1024/1280/1440/2560)及真实Tauri隔离SQLite流程；记录截图与geometry，失败定位而非放宽断言。
- 不调用真实云模型；Browser/Mock/Tauri/云端分别报告。
- 最后清除CARGO_TARGET_DIR，npm run dsh:assets（已知干净固定DSH_CHECKOUT F:/dsh-v320-clean），npx tauri build --bundles none，核对src-tauri/target/release/AI Novel Studio.exe；占用则不强杀用户进程。

## 验证记录

NOT_RUN：本轮尚未开始统一验收。仅有源码检查、子代理普通格式化和用户批准migration。构建/测试不能由第一轮结果推定。
