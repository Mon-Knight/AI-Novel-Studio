# 测试策略与用例

> 当前状态：✅ v1.7.11 已补充
> 适用范围：前端构建、Tauri 编译、设定库 AI 推演静态回归、文档同步检查。

---

## 1. 基础验证命令

```powershell
# TypeScript 类型检查 + 前端构建
npm run build

# ESLint 检查
npm run lint

# Rust 编译检查
cd src-tauri
cargo check
cd ..

# Tauri 完整构建
npm run tauri build
```

---

## 2. 设定库 AI 推演回归检查

```powershell
npm run test:setting-suggestions
```

该脚本位于：

```text
scripts/agent-workflow/check_setting_suggestions.ps1
```

检查范围：

- 设定推演页面文件存在。
- 服务层文件存在。
- 类型定义文件存在。
- 路由包含 `/novels/:novelId/setting-suggestions`。
- 兼容路由包含 `/worlds/:worldId/lore/suggestions`。
- 候选状态包含 `pending`、`adopted`、`edited_adopted`、`discarded`。
- 服务层包含重复采纳保护。
- 服务层包含角色、规则、世界设定采纳目标。
- Mock AI 支持 `setting_suggestion_generate`。
- UI 包含采纳、编辑后采纳、废弃操作。

---

## 3. 项目验证脚本

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/check_docs_sync.ps1
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1
```

`verify_project.ps1` 是综合验证入口，可能耗时较长，因为它会覆盖前端构建、Rust 检查、Tauri 构建和工作区状态检查。

---

## 4. 手动验证建议

### 4.1 设定库 AI 推演

1. 进入作品详情页。
2. 点击“设定库 AI 推演”。
3. 使用 Mock 模式生成角色候选。
4. 原样采纳一个候选，确认进入角色库。
5. 编辑后采纳一个候选，确认状态为 `edited_adopted`。
6. 废弃一个候选，确认状态为 `discarded`。
7. 尝试再次采纳已处理候选，应被阻止。

### 4.2 导出功能

1. 进入 `/import-export`。
2. 分别导出 TXT、Markdown 和 JSON 备份。
3. 确认桌面模式下出现保存位置选择。
4. 确认导出成功后显示保存路径。

### 4.3 桌面布局

1. 使用 1280 × 820 默认窗口检查首页、作品详情、创作资产、导入导出、设定推演。
2. 最大化到 2K 屏幕检查内容宽度是否受控。
3. 缩窄窗口到最小尺寸附近检查布局是否正常换行。

---

## 5. 当前限制

- 尚未引入 Jest / Vitest 单元测试。
- 尚未引入 Playwright 端到端测试。
- 设定推演目前以静态回归和手动验证为主。
- Tauri 构建依赖本机 Rust 与 Windows 构建环境。
