# Feature Development Checklist

> 用途：Agent 执行功能开发任务时的自检清单
> 使用时机：每次功能开发前后

---

## 开发前检查

- [ ] 已阅读 `AGENTS.md`
- [ ] 已阅读 `.github/copilot-instructions.md`
- [ ] 已确认本次版本目标（版本号 + 范围）
- [ ] 已确认禁止修改范围（哪些模块/文件不可动）
- [ ] 已阅读相关 `docs/` 文档（product-design / ui-reference / data-model）
- [ ] 已分析影响范围（新增/修改文件清单）
- [ ] 已制定修改计划并输出给用户确认

---

## 开发中检查

- [ ] 只修改了目标范围内的文件
- [ ] 未修改无关模块
- [ ] 未删除旧功能
- [ ] 未修改数据库 schema（除非任务明确要求）
- [ ] 未在组件中直接写 SQL
- [ ] 未在组件中直接写大量 Prompt
- [ ] 未把 API Key 写死进代码
- [ ] 未引入未要求的依赖

---

## 开发后验证

- [ ] 已运行 `npm run build`
- [ ] 已运行 `cargo check`（如修改了 Rust 代码）
- [ ] 已运行 `npm run tauri build`
- [ ] 已运行 `powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1`
- [ ] 已运行 `powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/check_docs_sync.ps1`
- [ ] 所有验证步骤通过

---

## 文档同步

- [ ] 已更新 `CHANGELOG.md`
- [ ] 已更新 `README.md`（如有必要）
- [ ] 已更新 `docs/`（如有架构变化）
- [ ] 已生成完成汇报

---

## 收尾

- [ ] `git status` 确认变更范围正确
- [ ] 已提交代码
- [ ] 已打 tag（如是版本级任务）
