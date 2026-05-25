# Verification Checklist

> 用途：Agent 执行任务后的综合验证清单
> 使用时机：每次 Agent 任务完成后

---

## Prompt 检查

- [ ] 是否存在超大 Prompt（超过 2000 token 的单一 prompt）？
- [ ] Prompt 是否按 system / chapter / style / verification 合理拆分？
- [ ] Prompt 是否在 `src/prompts/` 或 `prompts/` 中独立管理？
- [ ] 组件中是否避免了直接写大量 Prompt 文本？

---

## Agent Tool Layer 检查

- [ ] Agent 工具层是否只是封装接口，不直接乱改业务？
- [ ] Tool 函数是否有明确的输入/输出类型？
- [ ] Tool 是否返回 `AgentToolResult<T>` 统一格式？
- [ ] 是否避免了 Tool 绕过业务服务层直接操作数据库？

---

## 验证脚本检查

- [ ] 是否有验证脚本（`scripts/agent-workflow/`）？
- [ ] `verify_project.ps1` 可正常运行？
- [ ] `check_docs_sync.ps1` 可正常运行？
- [ ] `run_feature_workflow.ps1` 可正常运行？
- [ ] 验证失败是否能定位到具体原因？

---

## 构建检查

- [ ] `cargo check` 通过？
- [ ] `npm run build` 通过？
- [ ] `npm run tauri build` 通过？
- [ ] 是否有 TypeScript 类型错误？
- [ ] 是否有 ESLint 报错？

---

## 安全检查

- [ ] 是否提交了 API Key？
- [ ] 是否提交了 `.env.local`？
- [ ] 是否提交了 `node_modules/`？
- [ ] 是否提交了 `*.db` / `*.sqlite`？
- [ ] 是否提交了 `target/`（Rust 构建产物）？

---

## 文档检查

- [ ] 是否有完成汇报？
- [ ] 完成汇报格式是否规范？
- [ ] 修改的文件清单是否完整？

---

## 危险操作检查

- [ ] 是否没有自动 `git commit`？
- [ ] 是否没有自动 `git push`？
- [ ] 是否没有自动删除文件？
- [ ] 是否没有自动修改版本号？
- [ ] 是否没有自动创建 tag？
