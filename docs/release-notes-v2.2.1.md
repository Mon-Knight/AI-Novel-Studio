# AI Novel Studio v2.2.1 发布说明

v2.2.1 是 v2.2.0 的定向可靠性热修，不新增 AI 创作能力。

## 修复内容

- 采用事务在保存前置读取之后提交时，Rust 原子保存以事务内权威状态派生新候选，并通过 `disposition` 向前端证明该 ID 变化合法；编辑器不再把已提交结果误报为失败。
- 冲突恢复候选使用快照身份派生的稳定 operationId；快照删除失败并重进工作区后，会复用相同正文/hash/note 的已提交候选，只重试快照清理。completed replay 返回前会权威重读目标；目标被删除、修改或损坏时拒绝陈旧成功，并保留首次 operation 与恢复快照。
- Tauri `appWindow.close()` 拒绝时撤销一次性 bypass；后续关闭仍进入 Leave Guard，goal-only 路径的拒绝也会被记录和收口。

## 安全边界

- 已采用草稿仍不可原地覆盖；新 ID 只有在后端明确返回 `forked_from_adopted` 且目标、版本、正文 hash、长度与 operationId 全部通过验证时才接受。
- v2.2.0 operation 只在 `disposition` 字段缺失时兼容升级；显式未知或伪造值失败关闭。
- recovery 候选匹配要求作品、章节、固定 note、完整正文和 SHA-256 全部一致。
- 已完成 operation 不会被重新开启或覆盖；replay 目标失效返回 `OPERATION_REPLAY_TARGET_INVALID`，不会用同一 operation 产生第二次副作用。
- 本版本不修改 Provider、Tool Calling 或 Agent handoff，因此不调用真实 AI API。

## 验证

| 命令 | 结果 |
|---|---|
| `npm run lint` | 通过；0 error，保留 1 条既有 React Hooks warning |
| `npm run build` | 通过；211 modules |
| `npm test` | 通过；Node 16/16、tsx 44/44 |
| `npm run test:components` | 通过；5/5 |
| `npm run test:workspace-reliability` | 通过；15/15 |
| `npm run test:workspace-recovery` | 通过；12/12，Rust 111/111 |
| `npm run test:large-text-integrity` | 通过；7/7，Rust 111/111；覆盖采用先提交与保存先提交 |
| `npm run test:migrations` | 通过；1/1，Rust 111/111 |
| `npm run test:workspace-safety` | 通过；5/5 |
| `npm run test:e2e` | 通过；Windows Tauri 11 个独立 spec 全部通过 |
| `npm run tauri:build` | 通过；MSI 与 NSIS 均成功生成 |

安装包：

```text
src-tauri/target/release/bundle/msi/AI Novel Studio_2.2.1_x64_en-US.msi
src-tauri/target/release/bundle/nsis/AI Novel Studio_2.2.1_x64-setup.exe
```

- MSI：6,275,072 bytes；SHA-256 `559A67AC1ABB1CB3A0D5C40E642ACD0C07C2D1D84C9323B6F7ADFC8FF9E225FC`
- NSIS：4,504,591 bytes；SHA-256 `8BDA75FAA8238E688B64BDD11EB65030F90A697C887C085EE9AEC440A8528F44`

验证使用隔离 SQLite、Mock Provider 和独立 WebView2 数据目录，没有调用真实 AI API，也没有读取用户正式数据库。
