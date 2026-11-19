# AI Novel Studio UI 细节专项优化报告

日期：2026-10-28
范围：创作工作台左侧项目/任务列表；写作区域模型状态、章节目标说明与输入区。
状态：局部修复已完成并完成浏览器、真实 Tauri 与项目门禁验证。应用版本保持 v3.7.0，未改数据库结构、AI 生成流程、任务状态管理或发布产物。

## 1. 审计发现与实际根因

| 现象 | 实际根因与验证依据 | 涉及组件/文件 | 最小修改 | 回归风险 |
| --- | --- | --- | --- | --- |
| 父项目选中背景从展开箭头右侧才开始，和任务高亮边界不一致 | `.workbench-project-heading` 将箭头与项目按钮拆成两个 flex 子项，高亮只落在后者；几何基线中父项目 `left=32`，任务行 `left=8` | `WorkbenchNavigation.tsx`、`workbench.css`、`workbench-zcode.css` | 让项目标题行承担选中背景/状态，箭头绝对定位在独立前导槽 | 需保留展开箭头点击和任务菜单点击 |
| 任务标题、日期、状态与菜单争抢空间，标题易截断 | 标题和时间共用同一 flex 行，任务行又为绝对菜单保留 30px；基线中 231px 行内标题仅剩约 99px | `WorkbenchNavigation.tsx`、`workbench.css`、`workbench-zcode.css` | 项目/任务保持单行；普通任务不渲染时间；当前任务时间内联；完整信息由右侧 Tooltip 披露 | 长中文、英文、混排标题和当前/非当前状态需要真实桌面回归 |
| 父级展开、父级选中、当前任务视觉层级混淆 | 旧实现给父项目和任务使用同类填充背景；展开只改变箭头，但父项目仍像当前任务 | `WorkbenchNavigation.tsx`、`workbench-refinement.css` | 展开仅旋转箭头；当前项目使用字重/项目标记细边；当前任务使用中性填充与 2px 内嵌强调边；悬停/焦点使用独立状态 | 需保持选择、切换、重命名、归档行为 |
| 侧栏完整文本只能依赖原生 `title`，键盘聚焦与提示位置不可控 | 仓库没有可复用 Tooltip 组件，原生提示无法稳定放到侧栏右侧 | `components/common/Tooltip.tsx`、`global.css`、`variables.css` | 新增无第三方依赖 portal Tooltip，支持悬停/键盘聚焦、Escape/滚动/缩放关闭，限制在侧栏右侧 | 提示层不得遮挡列表、焦点环或菜单 |
| 章节目标说明与输入正文左边界不一致 | 基线测量显示目标说明 `left=415`，正文实际文字从 `x=431` 起排；目标说明没有专属 gutter | `WorkbenchComposer.tsx`、`workbench-zcode.css` | 统一 `--workbench-composer-gutter`，目标说明与输入、错误、模型提示共用同一水平基准 | 窄窗、长文本、模型提示展开时需保持不溢出 |
| 模型刷新、正常、失败状态区分不足 | 刷新和失败都使用警示图标；正常状态仍可能持续占位；失败文案不披露 sanitized 原因 | `WorkbenchModelRecoveryNotice.tsx`、`workbenchModelAvailability.ts` | 刷新用 Spinner；正常目录状态隐藏；失败用 alert + 完整原因 + 重试/设置 | 不改变刷新、发送和错误处理逻辑 |
| 两个冻结 CSS 文件只能变小，局部精修会触发样式预算 | `check-style-budget.mjs` 对 `workbench.css`、`workbench-zcode.css` 有只减不增的冻结值 | `check-style-budget.mjs`、新增 `workbench-refinement.css` | 将本轮增量视觉规则移入独立文件，恢复两个冻结文件行数 | 需保持加载顺序和视觉结果 |

## 2. 修改内容

### 左侧列表

- 项目与任务行统一稳定前导槽、单行标题、必要的右侧元数据空间。
- 普通任务不渲染更新时间；当前任务在同侧显示相对时间。
- 当前项目使用独立层级状态，不使用任务级整行高亮；展开只旋转箭头。
- 当前任务使用克制的中性选中底色和细强调边；悬停、键盘焦点、禁用状态分开表达。
- 增加右侧 Tooltip，鼠标悬停或键盘聚焦显示完整项目/任务名称、状态和更新时间。

### 写作区域

- 章节目标说明、模型状态、错误/冲突提示、正文和工具栏使用统一水平 gutter。
- 目标说明通过 `aria-describedby` 与创作目标输入建立可访问关联。
- 模型刷新使用 Spinner，正常状态不占位，失败保留完整原因及重试/设置动作。
- 保留输入、发送、快捷键、模板、上下文、任务菜单、重命名和归档行为。

### 设计令牌

- 复用 `--color-*`、`--space-*`、`--radius-*`、`--font-size-*` 和现有焦点/阴影令牌。
- 仅新增 `--z-tooltip` 和 `workbench-refinement.css` 的局部覆盖层；没有新增 UI 框架或第三方依赖。

## 3. 修改前后截图

相同浏览器夹具、相同逻辑窗口尺寸：

| 场景 | 修改前 | 修改后 |
| --- | --- | --- |
| 1440×900 列表与 Composer | `baseline-1440x900.png` | `after-1440x900.png` |
| 1024×700 窄窗 | `baseline-1024x700.png` | `after-1024x700.png` |
| 模型失败提示 1024×700 | `baseline-model-unavailable-1024x700.png` | `after-model-unavailable-1024x700.png` |
| 真实 Tauri 1440×900 | — | `F:\ai-novel-studio-hotfix-v321\test-results\ui-detail-refinement\tauri-1440x900.png` |
| 真实 Tauri 1024×700 + Tooltip | — | `F:\ai-novel-studio-hotfix-v321\test-results\ui-detail-refinement\tauri-tooltip-focus-1024x700.png` |

差异重点：

- 父项目选中背景不再从箭头右侧开始；当前任务边界稳定，不再与相邻行重叠。
- 非当前任务回到单行，时间不再挤占所有任务标题；当前任务时间与标题在同一行。
- 长标题保留完整原始文本，Tooltip 在侧栏右侧打开，不覆盖任务行。
- 章节目标说明左边界与输入文字左边界一致；模型失败提示与目标说明、输入内容保持同一 gutter。

## 4. 验证结果

已通过：

- `npx tsc --noEmit`
- `npm run lint:ci`
- `npm run test:component-size`
- `npm run test:style-budget`
- `npm run test:bundle-size`
- `npm run build`
- `npm run test:docs-sync`
- `npm run test:version-sync`
- `Tooltip.test.tsx` 1 passed
- `WorkbenchNavigation.test.tsx` 3 passed
- `WorkbenchInputUX.test.tsx` 22 passed
- `WorkbenchComposer.test.tsx` 6 passed
- `workbenchModelAvailability.test.ts` 8 passed
- `WorkbenchPage.test.tsx` 71 passed
- 隔离生产构建浏览器回归 4/4：1440×900、1024×700、模型失败、悬停/键盘焦点/明暗主题与对比度
- 真实 Windows Tauri 隔离 SQLite 专项 1/1：长中文/英文/混排标题、父子层级、单行任务、当前任务时间、右侧 Tooltip、焦点、Composer 对齐

聚合验证：

- `npm run verify:change -- --lane frontend --report reports/ui-detail-refinement/verify-change-frontend.json`
- `coverage`：PASS，2532 reported cases
- `frontend-build`：PASS
- `bundle-budget`：PASS
- `component-size`：PASS
- `format`：FAIL，原因是工作树既有 `src-tauri/capabilities/desktop.json`、`src-tauri/capabilities/migrated.json`、`src-tauri/tauri.conf.json` 不符合 Prettier；本次未修改这些配置文件。
- 聚合 `lint` 当时命中的临时诊断 spec 已删除；随后 `npm run lint:ci` 已单独通过。

## 5. 尚未解决的问题与风险

- 聚合 `verify:change` 仍因上述既有配置文件的格式状态返回非零；没有改动或回滚用户已有配置修改。
- 当前浏览器和真实 Tauri 验证覆盖常用桌面窗口尺寸；未扩展为移动端/触摸交互验收，因为本次范围是现有 Windows 桌面 UI。
- 模型目录不可用提示保持“仍可直接发送”的既有产品边界，本次只改进状态与错误呈现，没有绕过发送门禁。
