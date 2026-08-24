# Production Tool 工作性验证报告

日期：2026-08-24  
范围：TypeScript `productionToolRegistry` 与当前宿主 Artifact 协议  
结论：**已完成的工具必须有运行证据；仅有 descriptor 或 schema 不算完成。**

## 1. 验证命令

```powershell
npx tsx --test src/services/agent-tools/productionToolRuntime.test.ts
npx tsx --test src/services/agent-tools/toolRegistry.test.ts
npm run test:workbench
```

本轮结果：

- 隔离 fixture 的 Tool runtime 验证：3 个安全/边界场景 PASS，且 18/18 个现有 production handler 在同一 fixture 中返回 `ok=true`；
- Tool Registry/候选 schema 验证：7/7 PASS；
- Rust Gateway 工具测试：9/9 PASS；
- Rust 桌面全量测试：326 passed，0 failed，2 ignored；
- `npm run test:workbench`：53/53 PASS（包含新增 runtime/catalog 测试）。

测试使用浏览器 LocalStorage 隔离 fixture，不读取用户作品；不联网、不使用 API Key。它验证实际 handler，不等同于 Tauri SQLite 或外部模型验证。18/18 只代表 handler 在合法输入下能执行，不代表每项能力已经满足 facade、事实源或 Agent 暴露门禁。

## 2. 已有生产 handler 的状态

| 旧 Tool                                | 实际验证                                   | 当前结论                                | 说明                                                |
| -------------------------------------- | ------------------------------------------ | --------------------------------------- | --------------------------------------------------- |
| `novel.read_context`                   | 有效作品读回 + 缺失 scope 前置拒绝         | `WORKING handler / PARTIAL capability`  | 读取链可执行；作品设定多源仍需 facade               |
| `chapter.read_outline`                 | 有效章节读回 + 跨作品 fail-closed          | `WORKING handler / PARTIAL capability`  | 增加了章节归属校验；outline version/active 仍需治理 |
| `search_memory`                        | 当前作品 LocalStorage lexical 读回 + scope | `WORKING fallback / PARTIAL capability` | Tauri FTS/embedding 需单独运行证据                  |
| `novel.read_settings`                  | 有效作品设置摘要读回                       | `WORKING handler / PARTIAL capability`  | 多源设定 facade 仍需治理                            |
| `chapter.read_context`                 | 有效章节上下文读回 + 归属保护              | `WORKING handler / PARTIAL capability`  | 角色/事件子来源仍需单独证据                         |
| `style.read_*`、`verification.check_*` | 合法输入 handler smoke + 跨作品检查        | `WORKING handler / PARTIAL capability`  | 需按能力资产逐项挂接 Tauri/事实源证据               |

## 3. 候选 validator 的真实边界

以下 descriptor 已有 schema/输入拒绝测试：

```text
generate_chapter
generate_outline
generate_characters
suggest_events
expand_settings
polish_chapter
check_quality
summarize_chapter
```

它们的 handler 只做 candidate 校验并返回 `candidateOnly=true`；测试通过只证明：

- 参数 schema 能拒绝缺失/未知字段；
- 候选格式能被解析和规范化；
- 结果可序列化。

它们不证明模型生成正文、不证明独立 SubAgent，也不证明正式数据库写入。目录中统一保持 `partial + catalog_only`。

## 4. 宿主采用协议

`artifact.review` 与 `artifact.apply_approved` 不是当前 `productionToolRegistry` 的自由 Tool。它们的工作证据来自 `artifactApply.test.ts` 和受控 Windows E2E：

- 候选必须绑定作品/章节和不可变 Artifact；
- 审阅授权必须由用户触发；
- 正式采用走 CAS/一次性授权事务；
- 重放、跨作品和旧 revision fail-closed。

所以“已完成”在这里表示宿主协议工作，不表示模型可以直接调用 `adopt_artifact`。

## 5. 晋级规则

任何 Tool 只有同时满足以下条件才能从 `catalog_only` 晋级：

1. 至少一个真实 handler 正向调用测试；
2. 缺少 scope、跨作品/章节和不存在目标的负例；
3. 输出 schema、source/revision/hash 可审计；
4. 失败、取消、重启行为有证据；
5. 副作用与 confirmation policy 与宿主实现一致；
6. Tauri/SQLite 与浏览器 fallback 的差异有明确标记；
7. 不包含 prompt、候选正文、API Key 或隐藏推理。

当前没有任何 catalog 条目进入 Agent 可见 allowlist；`listAgentExposedCapabilities()` 必须返回空数组。
