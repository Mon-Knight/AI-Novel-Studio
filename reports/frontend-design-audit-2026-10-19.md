# 前端设计体检报告（只读分析）

> 分析对象：`F:/ai-novel-studio-hotfix-v321`（v3.7.0）
> 分析时间：2026-10-19
> 分析范围：`src/styles/*.css`、`src/pages/*/`、`src/components/`、`index.html`
> 执行方式：纯静态审阅 + 量化统计，**未修改任何代码**。所有数字均可按文末口径复现。

---

## 0. 一句话结论

这套前端的**工程底座是合格的**（令牌化、双主题语义色、reduced-motion 兜底、焦点环、懒加载样式都有），
但**没有一个属于「长篇小说创作」的视觉观点**：17 种字号里 209 处是 12px、正文与按钮共用同一套系统无衬线、
强调色是最典型的 SaaS 蓝紫。结果是——它读起来像一个开发者控制台，而不是一个写作空间。

优化重点不在「再加多少效果」，而在**收敛**：先把字体、间距、圆角、强调色收敛成一套可执行的纪律，
再把最该有性格的两个面（稿件纸面、作品封面）做出识别度。

---

## 1. 量化基线

| 指标 | 实测值 | 判读 |
| --- | --- | --- |
| CSS 文件 / 总行数 | 22 个 / 13,342 行 | 规模已到需要分层的程度 |
| 最大单文件 | `workbench.css` 3,152 行 | 无 CSS 体积门禁 |
| 设计令牌 | 214 个（含浅/深两套） | 覆盖完整，未被引用的仅 11 个 |
| `font-size` 用令牌 vs 硬编码 | 124 处 vs **365 处** | 75% 绕过令牌 |
| `font-size: 12px` | **209 处** | 视觉层级塌陷 |
| 间距用令牌 vs 硬编码 | 175 处 vs **1,235 处** | 网格失守 |
| 间距落在 4px 网格内 | **49.8%** | 另有一整套 1px 偶数网格在并行 |
| 圆角硬编码值 | 8 种（2/4/5/6/7/8/10/999） | 令牌只有 4/6/10/12/16 |
| 硬编码动效时长 | 140ms × 24、900ms × 5、180ms × 5… | 动效令牌只在 8 个文件被使用 |
| `:active` 规则 | **3 处** | 几乎没有按压反馈 |
| `backdrop-filter` | 1 处（弹窗遮罩） | 无氛围层 |
| 渐变实际使用 | 2 处（首页图标、右栏） | 无背景氛围 |
| 纹理/噪点 | **0 处** | — |
| 首屏 eager CSS | 约 128KB（未压缩，现有 dist 产物） | 含工作台两层样式 |

---

## 2. 视觉识别：三个强调色，等于没有强调色

**证据**

- `variables.css:11` 主色 `#3b6fe0`；`variables.css:68` 次要强调色 `#7c3aed`；
  `variables.css:23` 自主创作强调色 `#bf6f45` —— 三个强调色同时存在于同一界面。
- `--color-secondary-accent` 被用于卷状态、检查面板、全局 AI 任务弹窗（`VolumeCard.tsx:26`、
  `CheckPanelActionSections.tsx:144`、`GlobalAiTaskModal.tsx:49`），与主色在主流程里争夺注意力。
- 品牌标记是 22×22 圆角方块 + 12px 粗体文字（`frame.css:85-96`），与「任意后台系统」无异。
- 全站 0 处纹理、2 处实际渐变、1 处毛玻璃：层次完全靠 1px 边框和灰阶堆出来。

**影响**
所有面板看起来一样重要。用户离开产品后无法描述「它长什么样」，只能描述「它有什么功能」。

**建议**
强调色收敛为 1 个，其余降级为中性色；把 `--color-secondary-accent` 改成语义状态色而不是第二主色。
把省下来的注意力投到两个真正该有性格的地方（见 §7）。

---

## 3. 排版系统：字号阶梯实际不存在

**证据**

- `--font-size-xs` 与 `--font-size-sm` 都是 **12px**（`variables.css:91-92`），阶梯名义上 7 档，实际 6 档。
- 实际出现 **17 种字号**：12(209)、13(66)、14(33)、15(12)、16(11)、18(10)、20(5)、22(5)、17(4)、24(2)…
  —— 大量 1px 步进，人眼无法建立层级，只能靠颜色和字重补偿。
- 工作台 `h1` 17px、`h2` 19px（`workbench.css:47-56`）：页面标题与面板标题只差 2px。
- `--font-family-editor` 把 `'Microsoft YaHei'` 排在 `'Noto Serif CJK SC'` 之前（`variables.css:88`），
  衬线字体**永远不会被命中**。全库没有任何一处真正使用衬线。
- 正文 `text-indent`：**0 处**（中文长篇小说默认需要首行缩进 2em）。
- `.editor-body`（`workspace.css:554`）18px / 1.9 / 720px —— 这三项是合格的，问题只在字体族和缩进。

**影响**
一个小说工具，稿件与按钮使用同一套系统无衬线时，产品就失去了最廉价也最有效的差异化手段。
这是本次体检中**投入产出比最高**的一项。

**建议**

1. **双字体族**：正文/阅读面用宋体类（思源宋体 / 霞鹜文楷，系统 serif 兜底），UI 保留无衬线。
2. **模块化阶梯**：12 / 13 / 15 / 17 / 20 / 24 / 30（约 1.2 比例），删掉 1px 中间档。
3. **阅读模式**：首行缩进 2em、段间距可切换、行高 1.9、每行 28–34 个汉字。

---

## 4. 空间节奏：两套网格在打架

**证据**

- 硬编码间距 Top 值：8px(200)、12px(160)、**10px(149)**、**6px(119)**、4px(114)、16px(60)、2px(53)、
  **7px(52)**、14px(49)、**5px(45)**、**9px(38)**、3px(34)、20px(32)…
- 4px 网格内仅 **49.8%**；同时存在一条 1px 偶数网格（6/10/14/18）。
- 圆角：`workbench.css:2001` 给输入卡 `border-radius: 8px`，`workbench-zcode.css:583` 改成
  `var(--radius-xl)`（16px）+ 阴影 —— **同一个组件两套规格，靠加载顺序决定长相**。
- `workbench.css`（396 个选择器）与 `workbench-zcode.css`（169 个）有 **55 个同名选择器**。

**影响**
「说不上哪里不对，但就是不整」的典型症状。改一个间距要跨两个文件找覆盖关系，回归风险高。

**建议**
先冻结纪律再谈视觉：4px 网格（4/8/12/16/24/32）、3 档圆角（6/10/16）、
把 `workbench-zcode.css` 合并进 `workbench.css` 或显式标注为 `@layer`，消灭 55 个重复选择器。

---

## 5. 交互状态与动效：只有 hover，没有 press

**证据**

- `:active` 全库 **3 处**（`frame.css` 2 处、`workbench-zcode.css` 1 处）。主按钮、发送键、任务行点下去都没有反馈。
- `workbench.css` 3,152 行只有 **21 条 `:hover`**，大量可点行（项目行、任务行、模板 chip）缺少悬停态。
- 动效时长硬编码 24 处 140ms；`var(--motion-*)` 只在 8 个文件出现。
- 18 个 `@keyframes` 各自为战，除启动 splash 外**没有一次页面级入场编排**。
- 首屏空态 `.workbench-intro`（`workbench.css:1174`）是「居中圆形图标 + 标题 + 一段说明」，最模板化的处理。

**做得对的**
`global.css:304` 有全局 `prefers-reduced-motion` 兜底，且全库无 `transitionend`
或 `animationend` 依赖 —— 降级是安全的，这点比多数项目做得好，改动时不要破坏它。

**建议**

- 所有可点元素补 press 反馈：`transform: translateY(0.5px)` + 背景加深一档（80ms）。
- 动效收敛为 3 档：140ms（微交互）/ 220ms（面板）/ 320ms（场景）。
- 新任务首屏做一次 3 段错峰入场（标题 → 输入卡 → 提示），间隔 80ms。

---

## 6. 可读性与无障碍：3 个实测不达标组合

| 组合 | 实测对比度 | 标准 | 出现位置 |
| --- | --- | --- | --- |
| `#3b6fe0` on `#eaf0fc`（primary on primary-light） | **4.05:1** | ≥4.5 | `.tag-primary`、选中态徽标 |
| `#d98b0f` on `#ededef`（warning） | **≈2.6:1** | ≥4.5 | `page-layout.css:502` 状态文字 |
| `#22a565` on `#ededef`（success） | **≈2.9:1** | ≥4.5 | `page-layout.css:499` 状态文字 |

- 深色主题的对比度是合格的：`#9a9a9a` on `#1e1e1e` = 5.92:1，`#5b8def` on `#232323` = 4.87:1。
  问题集中在**浅色主题的状态色直接当文字色用**（`autonomous-planning.css`、`right-dock.css` 也有同样写法）。
- 状态语义大量只靠颜色：`.status-dot`、`.resource-trace-state`、`.autonomous-status` 都没有图标或文字冗余，
  色觉障碍用户无法区分。
- 点击目标偏小：`.workbench-new-task` 30×30、`.frame-icon-button` 28×28、`.btn-sm` 高 28px（基准 44×44）。
  桌面端鼠标可接受，但高分屏 + 触控板偏紧。
- 焦点环本身规范（2px + 2px offset），但只在 **7 个 CSS 文件**中出现，其余页面依赖全局兜底；
  在 `overflow: hidden` 的滚动容器里会被裁切。
- 做得对的：主工作台图标按钮的 `aria-label` + `title` 基本齐全（`WorkbenchTaskHeader.tsx` 全量覆盖）。

**建议**
状态文字统一改用 `--color-*-text`（已有该令牌，浅色下是 `#92400e` / `#166534` / `#991b1b`），
不要直接使用 `--color-warning/success/error` 这三个「填充色」；状态点旁补一个 12px 文字标签。

---

## 7. 两个最该有性格、现在最模板化的面

### 7.1 稿件纸面（写作工作台）

- `.editor-content` 背景是暖白 `#fdfcf9`，`.editor-paper` 却是纯白卡片 + 阴影（`workspace.css:774`）
  —— **「桌面」比「纸」更暖，纸张隐喻是反的**。
- 纸面四周只有 `12px 16px` 内边距，正文 720px 居中，顶部直接是章节标题，没有页眉/页码/字数这类
  「稿件感」元素；编辑器工具栏是标准图标条。
- 深色模式下 `theme.css:206` 又把 paper 改回 `--color-bg-editor`，于是深色下「纸」消失了。

**建议**
把这一面当作产品的门面来做：暖白纸 + 更深的桌面底色、纸面留白 ≥48px、页眉放「作品名 · 第 N 章」、
页脚放字数/保存态、衬线正文、首行缩进。这是用户每天停留最久的一屏。

### 7.2 作品封面（首页作品库）

- `.novel-card-cover`：80px 高的渐变条 + 34px 线性图标 + 右上角题材角标（`home.css:206`）。
  所有作品卡除了标题几乎完全相同，作品库没有「书架感」。
- 首页结构 = 页头 + 首次引导 + 快捷入口 chip 行 + 分组标题 + 卡片网格，是标准后台模板。

**建议**
用「标题排版生成封面」替代渐变+图标：取书名首字做字号/字重变化，配题材色与一句副标题
（类似出版社书脊）。零图片资源、零额外请求，却能立刻形成记忆点。

---

## 8. 工程可维护性：CSS 是唯一没有门禁的层

- `scripts/quality/check-component-size.mjs` 只约束 `.ts/.tsx`（上限 500 行，legacy 白名单 ratchet），
  **CSS 完全没有预算**：`workbench.css` 3,152 行、`right-dock.css` 1,551 行。
- **80 个 TSX 文件**用 `style={{}}` 写视觉；其中不少是 `var(--token, #f8fafc)` 形式的浅色兜底，
  在深色主题下一旦令牌缺失就会露白。
- `variables.css` 里 `@media (prefers-color-scheme: dark)`（39 个令牌）与
  `[data-effective-theme='dark']`（55 个令牌）是两套暗色源。由于 `index.html` 总会写入
  `data-effective-theme`，属性选择器特异性更高，**media 块实际永远不生效**，属于死代码 + 漂移风险。
- 启动 splash 在 `index.html` 内联了约 300 行 CSS，与真实界面是两套皮肤，改版时必须同步两处。
  （优点是 splash 与真实布局同构，观感衔接很好，这点值得保留。）

**建议**

1. 给 CSS 加行数预算（例如单文件 ≤800 行）+ 禁止新增内联色值（ESLint 自定义规则或 grep 门禁）。
2. 删除 media 暗色块，只保留 `data-effective-theme` 单一来源。
3. 把 `workbench-zcode.css` 合并或改名为明确的覆盖层，并在文件头注明层级顺序。

---

## 9. 优先级清单

### P0｜低风险、当天可做

| # | 事项 | 落点 | 验收 |
| --- | --- | --- | --- |
| 1 | 状态文字改用 `--color-*-text` | `page-layout.css:499-505`、`autonomous-planning.css`、`right-dock.css` | 三处对比度 ≥4.5:1 |
| 2 | `.tag-primary` 文字色加深 | `global.css:503` | ≥4.5:1 |
| 3 | 强调色收敛为 1 个 | `variables.css:23/68` | 全站只保留一个高饱和色 |
| 4 | 删除 media 暗色块 | `variables.css:217-265` | 深色仅由属性切换 |
| 5 | 补 `:active` 与缺失 hover | 按钮基类 + 任务行/项目行 | 所有可点元素有 press 态 |
| 6 | 焦点环不被裁切 | `overflow:hidden` 容器 | Tab 全流程可见 |

### P1｜需要一次设计决策

| # | 事项 | 验收 |
| --- | --- | --- |
| 7 | 字体系统重做（正文宋体 + UI 无衬线） | 正文与 UI 字体族不同且可解释 |
| 8 | 字号阶梯改为模块化 7 档 | 全库不再出现 13/15/17/19 混用 |
| 9 | 间距归一 4px 网格 | 网格内占比 ≥90% |
| 10 | 圆角收敛 3 档 | 硬编码圆角值 ≤3 种 |
| 11 | 合并 workbench 覆盖层 | 重复选择器 = 0 |
| 12 | 稿件纸面重做（层次反转 + 页眉页脚 + 缩进） | 写作页有明显「稿件」识别 |

### P2｜一个版本周期

| # | 事项 |
| --- | --- |
| 13 | 作品封面由标题排版生成 |
| 14 | 空态从「图标+标题+按钮」改为引导式起笔（示例目标 / 最近项目） |
| 15 | 新任务首屏 3 段错峰入场 |
| 16 | CSS 体积门禁 + 内联样式门禁进入 CI |

---

## 10. 建议的设计方向：铅字书房（Editorial）

如果只允许定一个方向，建议是**「铅字书房」**：整个产品是一张书桌。

- **外壳**（工作台、导航、面板）：中性、低饱和、发丝边框，密度可控 —— 保持现有的克制，不加装饰。
- **纸面**（写作页、阅读页）：暖白纸、宋体正文、页眉页码、2em 首行缩进、48px 留白。
- **强调色**：只保留一个「朱砂」类暖红，仅用于「保存 / 采用 / 发送」这类不可逆动作；
  其余按钮全部灰阶。蓝色退回为链接色或直接取消。
- **记忆点三件套**：① 稿纸的页眉与页码；② 由书名排版生成的作品封面；③ 空态的一句「起笔」引导
  （例如给出三个可点击的开篇方向，而不是一个空按钮）。

这个方向的好处是：**不依赖任何图片资源、不引入新依赖、不改变现有信息架构**，
只动 CSS 变量与少量组件结构，就能让产品从「后台」变成「书房」。

---

## 11. 不建议做的

- 不要加大面积渐变 / 玻璃拟态：与桌面工具调性冲突，且现有基础为 0，投入产出比低。
- 不要为了「高级感」增加装饰性动效：当前问题是缺层级，不是缺动画。
- 不要在视觉收敛的同一个版本里改信息架构：两件事耦合会让回归无法定位。
- 不要为了排版引入在线字体 CDN：桌面端离线可用是硬约束，字体必须本地打包或走系统字体。

---

## 附：统计口径

- 字号/间距/圆角：遍历 `src/**/*.css`，正则匹配 `font-size|padding|margin|gap|border-radius` 声明，
  含 `var()` 的记为令牌使用，其余按 px 数值计数（`0` 与百分比不计）。
- 对比度：WCAG 2.1 相对亮度公式，sRGB，未做 alpha 混合。
- 选择器重叠：两个 CSS 文件顶层选择器字符串去重后求交集（不含 `@media` 内部规则）。
- 未使用令牌：在 `src/**/*.{css,ts,tsx}` 中搜索 `var(--token`，命中 0 次记为未引用。
- 构建体积：读取现有 `dist/assets/*.css` 文件大小，未重新构建、未做 gzip。

---

## 12. 本轮落地结果（2026-10-19，实现记录）

> 本节记录实际执行结果，与上面的体检结论配套阅读。**第 10 节的强调色用法定案有一处修正**：
> 朱砂没有用于「保存 / 采用 / 发送」，而是收敛为**印记级**用法（品牌章、书脊、未保存点、当前项标记）；
> 主按钮改为**墨色实心**。原因是朱砂与 `--color-error` 同属红相，大面积使用会让「保存」读起来像「删除」。

### 12.1 落地了什么

| 层 | 改动 | 代表文件 |
| --- | --- | --- |
| 令牌 | 主色由蓝改墨、朱砂独立成 `--color-accent`、青铜降为状态色；新增 `--color-bg-desk` / `--font-family-display` / `--space-1..8` / `--radius-control|card|panel` / `--shadow-paper`；删除 `prefers-color-scheme` 暗色死代码 | `variables.css` |
| 字阶 | 7 档模块化 12/13/15/17/20/24/30；`xs` 与 `sm` 不再同为 12px；正文默认 15px | `variables.css`、`global.css` |
| 字体 | UI 无衬线 / 展示与稿件衬线；`--font-family-editor` 改为衬线优先，宋体真正生效 | `variables.css` |
| 对比度 | 状态文字统一改用 `--color-*-text`；`tag-primary` 从 4.05:1 提升到 13.04:1 | `page-layout.css`、`right-dock.css`、`autonomous-planning.css` 等 |
| 交互态 | `:active` 从 3 处补到 46 处；补 hover 与自定义容器的 `:focus-visible` | 全部组件样式 |
| 工作台 | 98 个属性冲突清零；输入卡统一 `--radius-panel` + `--shadow-composer`；字号收敛 128 处；首屏 4 段错峰入场 | `workbench.css`、`workbench-zcode.css` |
| 稿件纸面 | 桌面比纸暗（层次反转）；标题移入纸内、44px 朱砂细线；页脚「第 N 章 / 字数 · 目标」；正文 20px 衬线 1.9 | `workspace.css`、`EditorAreaView.tsx` |
| 作品封面 | 渐变 + 图标改为「朱砂书脊 + 书名首字衬线 + 题材标签」，零图片资源 | `home.css`、`NovelCard.tsx` |
| 空态 | 标题衬线化，补一句引导文案（不加新交互） | `WorkbenchPageStates.tsx` |
| 门禁 | 新增 `scripts/quality/check-style-budget.mjs`：CSS 行数 ratchet、内联色值 ratchet、硬编码字号总量 ratchet | `package.json` 增 `test:style-budget` 并接入 `test:all` |

### 12.2 前后指标

| 指标 | 改造前 | 改造后 |
| --- | --- | --- |
| `font-size` 令牌 / 硬编码 | 124 / 365 | **433 / 56** |
| CSS 内十六进制色值 | 分散在 10+ 文件 | **仅 `variables.css`（令牌定义）与 `frame.css`（Windows 窗口按钮 4 处）** |
| 组件内联十六进制色值 | 151 处 / 11 文件 | **134 处 / 9 文件**（本轮清空两个文件，其余冻结） |
| workbench 两文件同属性冲突 | 98 | **0** |
| 两文件同名选择器 | 55 | 46（剩余为媒体查询与互补声明） |
| `:active` 规则 | 3 | **46** |
| 间距 4px 网格占比 | 49.8% | 58.4% |
| CSS 总行数 | 13,342 | 13,569（新增交互态与页脚，`workbench.css` 净减 86） |

### 12.3 明确没做的（诚实清单）

1. **间距只做了局部归一**（49.8% → 58.4%），没有对 1,235 处硬编码做机械替换：无截图通道时全局改间距会引入不可见的重排，风险不成比例。剩余项交给 ratchet 门禁冻结。
2. **剩余 27 处 14px 未改成 15px**：它们集中在 360px 宽的右侧面板与资源条目，+1px 可能引起换行，需真实桌面复核后再动。
3. **`workbench.css` 与 `workbench-zcode.css` 没有合并成一个文件**：合并 4,400 行 CSS 且无法目视验收，属于高风险低收益。改为「冲突清零 + 文件头声明加载顺序」，同名选择器保留为有意的视觉覆盖。
4. **7 个 `WorkbenchPage.test.tsx` 用例失败，属既有问题**：例如测试断言「重试此回合」，而 `src` 中该文案已不存在（现为「重试失败阶段」，见 `WorkbenchTurn.tsx:254`），与本轮样式改动无关。**该批失败已于 2026-10-19 修复**（测试夹具与过期断言；其中预检重试错误码由产品侧保留），`WorkbenchPage.test.tsx` 现为 71/71 通过。
5. **`npm run lint:ci` 在 `ChapterSummaryWorkflowNotice.tsx` 上失败**（4 处 Lucide 图标缺 `strokeWidth={1.8}`），该文件本轮未改动，属既有门禁红。**已于 2026-10-19 修复**：补齐 4 处 `strokeWidth={1.8}`；另将 gitignored 的 `test-results/` 加入 ESLint `ignorePatterns`，避免桌面 E2E 解包出的 DSH 第三方 `.d.ts` 污染源码 lint。

### 12.4 验证证据

- `npx tsc --noEmit`：通过。
- `npx eslint`（本轮改动的 5 个 TSX）：零报错。
- `npx prettier --check`（全部改动文件）：通过。
- `npx vite build`：通过（2,504 模块，15s）。
- `npm run test:bundle-size`：PASS（entry 109.25 KiB raw / 34.45 KiB gzip）。
- `npm run test:component-size`：通过（719 个生产源）。
- `vitest`：`ReadableSupportStyles`（4）+ `SharedDialogStyles`（10）+ `WorkbenchNavigation`（1）+ `WorkbenchInputUX`（22）全部通过。
- `tsx --test src/components/workspace/EditorArea.test.tsx`：7/7 通过。
- `node scripts/quality/check-style-budget.mjs`：通过。
- 视觉验收：`reports/frontend-redesign-proof-2026-10-19.html`（浅/深两套，含对比度表）。

### 12.5 门禁收口（2026-10-19）

- `check-ui-icons` / `npm run lint:ci`：通过（718 个生产源）；`test-results/` 已加入 ESLint ignore。
- `WorkbenchPage.test.tsx`（Node 22.22.2 + `tsx --test`）：**71/71 通过**，0 失败。
- `WritingWorkspaceViewBehavior`：7/7 通过（补充章节总结通知 mock，避免 `useNavigate` 把编辑区送入错误边界）。
- `agentProductionClosedLoop`：10/10 通过（补齐 deepseek-chat 的保存模型夹具，不再依赖本机 LocalStorage）。
- `npm run test:coverage`：
  - 全量：**58.95% lines / 78.82% branches / 65.06% functions / 58.95% statements**，高于 34/64/44/34 阈值；
  - 核心 8 文件：**87.39% lines / 82.32% branches**，高于 85/85/80/80；
  - 关键组件：各组 ≥ 60%，门禁通过。
- `npx tsc --noEmit`：通过。
- `node scripts/quality/check-style-budget.mjs`：通过。
- `npm run test:docs-sync`、`git diff --check`：通过。
- 桌面 E2E：`conversational-workbench` 已按 v3.7.0“模型目录不阻断发送”契约更新并通过；`chapter-context-persistence` 仍失败，原因是 mock 总结缺少 `grounding` 原文依据，校验按现行规则记为 `validation_status=failed`，对应 context record 因此 `is_active=0`（预期行为）。该用例的 mock 夹具尚未跟进 grounding 契约，列为后续事项，不在本轮伪造通过。
- `npm run test:discovered`：**225/225 通过**（40 个文件）；同步修正了 `verify-change` 测试夹具、`ArtifactLifecycle` 修订按钮文案与 `OutlineManager` 的 `saveDetails` mock。
- 说明：`WorkbenchPage.test.tsx` 是 `node:test` + JSDOM 夹具，不能由 `vitest` 运行；本地 Node 24 下 `vitest` 会在加载阶段报 esbuild `TextEncoder` 断言，与本文件无关。
