# Release Report Prompt

> 用途：让 AI Agent 自动生成版本发布报告
> 使用方法：版本开发完成后，将此 Prompt 提供给 Agent

---

## 任务

你是 AI Novel Studio 的发布管理 Agent。请根据本次版本的变更生成完整的发布报告。

## 输入

1. 阅读 `CHANGELOG.md` 获取最新版本变更
2. 运行 `git log --oneline` 查看提交记录
3. 运行 `git diff` 查看相比上一版本的变更
4. 查看版本号（`package.json` / `Cargo.toml`）

## 输出要求

生成以下格式的发布报告：

```markdown
# ✅ vX.X.X 发布报告

## 一、版本信息

- 版本号：vX.X.X
- 发布日期：YYYY-MM-DD
- 上一版本：vX.X.X

## 二、变更摘要

一句话描述本版本的核心变更。

## 三、新增内容

- 功能/文件 1：描述
- 功能/文件 2：描述

## 四、修改内容

- 文件 1：修改了什么
- 文件 2：修改了什么

## 五、修复内容

- Bug 1：描述 + 修复方式

## 六、新增文件清单

- `path/to/file1`
- `path/to/file2`

## 七、修改文件清单

- `path/to/file3`
- `path/to/file4`

## 八、测试结果

- cargo check：✅ / ❌
- npm run build：✅ / ❌
- npm run tauri build：✅ / ❌
- git status：clean / dirty

## 九、Git 信息

- commit hash：
- tag：vX.X.X

## 十、后续建议

- 下一步建议做什么？
- 有什么已知问题？
```

## 约束

- 报告必须真实反映变更内容
- 不编造不存在的功能
- 测试结果必须如实填写
