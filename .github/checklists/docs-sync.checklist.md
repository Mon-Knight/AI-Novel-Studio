# Docs Sync Checklist

> 用途：版本完成后检查文档同步状态
> 使用时机：每次版本开发完成后、发布前

---

## README.md

- [ ] 版本号已更新为当前版本
- [ ] 当前阶段描述已同步
- [ ] 功能概览已反映最新状态（如有功能变更）
- [ ] Agent Runtime 说明已更新（如涉及 Agent Runtime）

---

## CHANGELOG.md

- [ ] 已新增当前版本条目
- [ ] 条目按类型分组（新增/修改/修复/移除）
- [ ] 日期已填写
- [ ] 开发者备注已填写（如需要）

---

## docs/version-roadmap.md

- [ ] 当前版本已标记为 ✅
- [ ] 后续版本路线已更新（如有调整）
- [ ] 版本号与实际一致

---

## docs/agent-runtime.md

- [ ] 如需更新，已反映最新 Agent Runtime 状态
- [ ] 当前版本号已标注

---

## docs/development-skills.md

- [ ] 新增 Skills 已记录
- [ ] Skills 说明与 .github/skills/ 一致

---

## Git 与发布治理

- [ ] `docs/project/git-workflow.md` 明确分支、PR、required checks、tag、hotfix 与回滚边界
- [ ] `CHANGELOG.md` 是唯一持续维护的版本入口
- [ ] `docs/project/release-history.md` 保留 40 份历史快照及合并前 SHA-256
- [ ] `docs/` 根目录不存在 `release-notes-v*.md` 碎片
- [ ] CI、Security、Release workflow、Dependabot 与 PR 模板均存在

---

## AGENTS.md

- [ ] 无需更新或已更新
- [ ] 协作流程说明准确
- [ ] 版本体系描述与 roadmap 一致

---

## 版本号一致性

- [ ] `package.json` 是当前版本事实源
- [ ] `package.json` → `version` 字段
- [ ] `src-tauri/Cargo.toml` → `version` 字段
- [ ] `src-tauri/tauri.conf.json` → `package.version` 字段
- [ ] `README.md` → 当前版本
- [ ] `CHANGELOG.md` → 最新条目
- [ ] README 与版本路线图的当前阶段声明唯一且一致

---

## 真实性检查

- [ ] 文档未声明未完成的功能为已完成
- [ ] 文档未包含过时信息
- [ ] 文档与代码实际行为一致
- [ ] 多个文档对同一事物的描述不矛盾
- [ ] 旧版本或旧阶段未被继续标记为“当前”
- [ ] 必需文档、Checklist、Skill 或工作流脚本缺失时检查会失败
- [ ] 文档同步负向回归测试通过
