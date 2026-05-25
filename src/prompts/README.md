# src/prompts — Prompt Pipeline

> 版本：v1.0.44
> 用途：未来 Agent 化 Prompt 生成的结构化目录
> 注意：**当前版本只建立目录和最小模块，不替换现有正文生成链路。**

---

## 目录结构

```
src/prompts/
├── README.md                          # 本文件
├── system/
│   └── base-system-prompt.ts          # 系统规则 Prompt
├── chapter/
│   └── chapter-generation-prompt.ts   # 章节生成 Prompt 构建器
├── style/
│   └── style-constraint-prompt.ts     # 风格约束 Prompt 构建器
└── verification/
    └── chapter-verification-prompt.ts # 生成后验证 Prompt 构建器
```

---

## 各模块职责

### system/ — 系统规则
定义 AI 的行为边界和项目核心约束：
- AI Novel Studio 是长篇小说创作工程系统
- AI 必须遵守用户已确认设定
- AI 不得自动修改正史、角色核心设定、世界规则

### chapter/ — 章节生成
根据章节目标、大纲、风格摘要构建章节生成 Prompt。

### style/ — 风格约束
根据风格方案构建风格约束 Prompt。

### verification/ — 生成后检查
根据大纲和草稿构建验证 Prompt。

---

## 当前状态

| 模块 | 状态 | 说明 |
|------|------|------|
| system | ✅ 已实现 | 包含基础系统规则常量 |
| chapter | ✅ 已实现 | 返回构建后的字符串，不调用 AI |
| style | ✅ 已实现 | 返回构建后的字符串，不调用 AI |
| verification | ✅ 已实现 | 返回构建后的字符串，不调用 AI |

---

## 与现有系统的关系

- **根目录 `prompts/`**：存储 Markdown 格式的提示词模板（现有系统）
- **`src/prompts/`**：存储 TypeScript Prompt 构建器（未来 Pipeline）

**当前版本两者并存，互不替代。**
后续 v1.0.47+ 逐步将 Prompt Pipeline 接入正文生成链路。

---

## 后续扩展

- v1.0.47：Prompt Pipeline 接入现有生成链路
- v2.x：Agent 化阶段，由 Planner 自动选择和组合 Prompt 模块
