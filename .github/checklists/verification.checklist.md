# Verification Checklist

> 用途：Agent 执行任务后的综合验证清单
> 使用时机：版本验收、发布任务或用户明确要求综合验证时；普通任务按变更范围执行适用子项

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

## 验证选择检查

- [ ] `npm run verify:change -- --dry-run` 已列出本次变更的归属与命令？
- [ ] 未映射路径已在 `scripts/quality/verification-scopes.mjs` 补充行为归属（没有以零测试通过）？
- [ ] 同一批未变化且已通过的检查未重复运行？
- [ ] 验证失败是否能定位到具体原因，并原样传播退出码？

---

## 构建检查

- [ ] 选择器选出的行为测试通过，且报告了实际用例数？
- [ ] 前端改动的改动文件 ESLint 与一次类型检查通过；构建配置/依赖变化时完整 `lint:ci` 与 `build` 通过？
- [ ] Rust/SQLite 改动的 `cargo check --locked` 与有非零匹配证明的相关测试通过？
- [ ] 用户交互/写作流程变化对应的真实桌面场景通过（生产界面、隔离 SQLite、固定模型响应）？
- [ ] Migration/共享持久化/DSH/打包变化扩大到对应完整领域门禁；打包变化通过 `npm run tauri:build`？
- [ ] 发布或明确完整验收任务的 `verify_project.ps1` 通过？
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
