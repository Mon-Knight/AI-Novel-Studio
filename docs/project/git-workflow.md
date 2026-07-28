# Git 分支与发布治理

> 适用范围：AI Novel Studio 仓库开发、审查、紧急修复和版本发布。当前长期分支仅为 `main`。

## 1. 分支模型

| 分支                   | 用途                             | 生命周期                  |
| ---------------------- | -------------------------------- | ------------------------- |
| `main`                 | 始终保持可验证、可发布的集成基线 | 长期                      |
| `codex/vX.Y.Z-<scope>` | 单一版本目标或边界清晰的功能任务 | PR 合并后删除             |
| `codex/fix-<scope>`    | 非版本级缺陷修复                 | PR 合并后删除             |
| `codex/hotfix-vX.Y.Z`  | 已发布版本的紧急修复             | 验证、PR、补丁 tag 后删除 |

- 一个分支只承载一个版本目标，不混入未来版本或无关重构。
- 日常开发不直接提交到 `main`，不使用 force push 改写共享历史。
- Agent 创建分支时使用 `codex/` 前缀；人工分支也应保持可识别的范围与版本。

## 2. 标准流程

```powershell
git switch main
git pull --ff-only origin main
git switch -c codex/vX.Y.Z-short-scope

# 小步提交，遵循 Conventional Commits
git commit -m "feat(scope): describe the verified increment"

git push -u origin codex/vX.Y.Z-short-scope
```

随后创建 Pull Request，使用 [PR 模板](../../.github/pull_request_template.md) 填写影响范围、
验证证据、数据兼容性和回滚步骤。合并方式默认 **Squash and merge**；需要保留多个独立、
可审计提交时可使用 **Rebase and merge**，不创建无意义 merge commit。

## 3. `main` 保护规则

仓库管理员应在 GitHub Branch protection / Rulesets 中为 `main` 配置：

1. 必须通过 Pull Request 合并，至少 1 名非作者审查者批准。
2. 新提交到来时撤销过期批准，所有 review conversation 必须解决。
3. 必须通过快速浏览器 CI、Windows 桌面 smoke 和依赖安全门禁；数据库、桌面壳或发布文件变更时运行对应完整门禁。
4. 要求分支在合并前与 `main` 保持最新，禁止 force push 和删除 `main`。
5. 管理员仅在 GitHub 或 CI 故障的紧急场景旁路；旁路原因必须记录在后续 PR / CHANGELOG。

仓库内的 [快速 CI](../../.github/workflows/ci.yml)、
[Windows 桌面 E2E](../../.github/workflows/windows-desktop-e2e.yml) 和
[安全审计](../../.github/workflows/security.yml) 提供可选为 required check 的工作流事实；
GitHub 规则本身由仓库管理员配置，文档不把未配置的远端规则描述为已启用。

## 4. 版本与发布

1. 版本号、README、路线图和 CHANGELOG 在同一发布 PR 中同步。
2. `npm run test:version-sync` 和 `npm run test:docs-sync` 必须通过。
3. 发布 tag 只能指向已合入 `main` 且门禁通过的提交；tag 格式为 `vX.Y.Z` 或语义化预发布版本。
4. [发布工作流](../../.github/workflows/release.yml) 复验 tag 与应用版本，生成签名安装包、Stable/Beta 通道和 rollback manifest。
5. GitHub Release 与 updater notes 从 `CHANGELOG.md` 的当前版本段落生成；历史快照统一见
   [发布历史归档](release-history.md)。

## 5. 紧急修复与回滚

- 从当前 `main` 创建 `codex/hotfix-vX.Y.Z`，只包含问题修复、回归测试和 CHANGELOG 条目。
- 仍通过 PR 和必要门禁；不在已发布 tag 上追加提交，也不移动既有 tag。
- 发布补丁版本后使用通道 manifest；需要降级时遵循 rollback manifest，先导出完整项目备份，
  再安装保留的上一通道安装包。
- 回滚代码使用新的 revert / fix PR，保留审计历史，不重写 `main`。

## 6. 提交边界

- 禁止提交 API Key、`.env.local`、正式数据库、用户正文、`node_modules/` 和本地构建产物。
- Migration、备份 schema、更新器或发布脚本变更必须同时提供兼容性与失败关闭证据。
- 每次版本完成更新 `CHANGELOG.md`；架构、数据模型或用户流程变化同步相应权威文档。
