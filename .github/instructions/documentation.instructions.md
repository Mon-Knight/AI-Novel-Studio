# Documentation Instructions

> 适用于：所有文档的创建、更新和维护
> 优先级：中（每次功能变更必须执行）
> 适用范围：`docs/`、`README.md`、`CHANGELOG.md`

---

## 1. 文档更新规则

### 1.1 必须更新的文档

| 变更类型       | 必须更新                       |
| -------------- | ------------------------------ |
| 新功能         | README + CHANGELOG             |
| 架构变更       | docs/project-architecture.md   |
| 数据模型变更   | docs/data-model.md             |
| UI 方向调整    | docs/ui-reference.md           |
| 新版本发布     | CHANGELOG + version-roadmap.md |
| 开发规则变更   | docs/development-rules.md      |
| Agent 基础设施 | AGENTS.md + 相关 instructions  |

### 1.2 文档原则

- 文档与代码同等重要
- 代码和文档冲突时，以用户需求为最高优先级
- 文档必须简明扼要，避免过时信息
- 每个文档必须有明确的目的和受众

---

## 2. README.md 维护

README 是项目的第一入口，必须保持准确：

- 项目定位
- 技术栈
- 当前版本
- 功能概览
- 本地运行步骤
- 版本路线
- 项目结构

每次发布新版本后，必须更新 README 中的版本号和功能描述。

---

## 3. CHANGELOG.md 维护

### 3.1 格式

```markdown
## vX.X.X (YYYY-MM-DD)

### 新增

- ...

### 修改

- ...

### 修复

- ...

### 移除

- ...

### 开发者备注

- ...
```

### 3.2 规则

- 每个版本必须有一条 CHANGELOG 记录
- 描述必须清晰可理解
- 按类型分组（新增/修改/修复/移除）
- 标注日期
- 可以包含开发者备注

---

## 4. Release Notes 与历史归档

### 4.1 存储

- 当前与未来版本以根目录 `CHANGELOG.md` 为唯一持续维护入口。
- 历史逐版本说明统一归档在 `docs/project/release-history.md`，不再新增 `docs/release-notes-v*.md`。
- 发布流水线从 CHANGELOG 精确提取目标版本段落，生成 GitHub Release 正文和 updater notes。

### 4.2 内容

- 版本号与日期
- 新增、修改、修复和安全边界
- 已完成的测试与安装包验证
- 已知限制、兼容性与回滚说明
- 不写入未经验证的未来计划

---

## 5. 禁止事项

- ❌ 代码修改后不更新文档
- ❌ 文档中存在过时信息
- ❌ 文档与代码实际行为不一致
- ❌ 多个文档描述同一件事情但互相矛盾
- ❌ 在文档中写大段未经验证的"计划"

---

> **本文件是 AI Novel Studio 文档维护的权威指令。文档即产品的一部分。**
