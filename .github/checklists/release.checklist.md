# Release Checklist

> 用途：版本发布前的最终检查
> 使用时机：版本开发完成后、创建 tag 前

---

## 版本确认

- [ ] 版本号已确认（`package.json` / `Cargo.toml` / `tauri.conf.json` 一致）
- [ ] 版本号符合语义化版本规则
- [ ] 版本号已从上一版本正确递增

---

## 变更记录

- [ ] `CHANGELOG.md` 已新增当前版本条目
- [ ] CHANGELOG 条目按类型分组（新增/修改/修复/移除）
- [ ] CHANGELOG 日期已填写
- [ ] `npm run test:version-sync` 已确认当前版本可从 CHANGELOG 唯一提取
- [ ] 未新增逐版本 release notes 文档；历史快照统一保存在 `docs/project/release-history.md`

---

## README 同步

- [ ] `README.md` 当前版本号已更新
- [ ] `README.md` 当前阶段描述已同步
- [ ] `README.md` 功能概览已反映最新状态
- [ ] `README.md` Agent Runtime 说明已更新（如适用）

---

## 路线图同步

- [ ] `docs/version-roadmap.md` 已标记当前版本为 ✅
- [ ] 后续版本路线已更新（如有调整）

---

## 构建验证

- [ ] `npm run build` 通过
- [ ] `npm run test:bundle-size` 通过，入口和任一 chunk 的真实字节/gzip 预算未回退
- [ ] `npm run test:component-size` 通过，所有生产 TSX 不超过 500 行
- [ ] `cargo check` 通过
- [ ] `npm run tauri build` 通过
- [ ] 安装包或 release 产物路径已记录
- [ ] `powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1` 通过

---

## Git 检查

- [ ] `git status` 已检查，working tree clean
- [ ] 没有遗漏的未跟踪文件
- [ ] 没有提交 `node_modules/`、`.env.local`、`*.db` 等禁止文件

---

## Tag 创建前人工确认

- [ ] 构建验证 **全部** 通过
- [ ] 文档同步 **全部** 完成
- [ ] 确认可以创建 tag

---

## Tag 与推送

- [ ] 版本分支已通过 PR 审查并合入 `main`
- [ ] 本地 `main` 已使用 `git pull --ff-only origin main` 同步
- [ ] `git tag vX.X.X` 已创建
- [ ] `git push origin vX.X.X` 已推送
