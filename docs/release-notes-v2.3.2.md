# AI Novel Studio v2.3.2 发布说明

发布日期：2026-07-26
阶段：Safe Apply 单目标安全应用

## 本版完成

v2.3.2 首次把只读 AI Artifact 接入正式业务数据的受控应用边界。`setting_candidates@1` 中每条有效候选会建立不可变 PlacementProposal 和等待确认的 ApplyPlan；用户点击确认前不写正式设定，确认后只在一个 SQLite 事务中创建一条世界设定、ArtifactTargetLink 并完成 Plan。

关键能力：

- Proposal 绑定 Artifact、候选 index/hash、预分配 targetId、目标 version/hash 和唯一 create effect。
- ApplyPlan 身份/effect 不可变，状态只允许 awaiting → applying → applied/conflict。
- 用户确认身份和时间进入持久事实；AI 不能绕过 UI 直接声明已确认。
- world_setting、TargetLink 与 Plan applied 同事务提交，任一步失败整体回滚。
- 相同 operationId/planHash 重放返回首次目标，不重复创建副作用。
- 目标 ID 碰撞进入 conflict，不覆盖已有数据。
- applied 重放重新校验完整目标 hash；目标修改、删除或来源异常时失败关闭。
- 浏览器 ephemeral 候选不伪造 Proposal/Plan/Link，也不显示正式采用按钮。

## 数据库迁移

新增迁移：

| ID | 作用 | SHA-256 checksum |
|----|------|-----------------|
| `012_placement_proposals` | 不可变候选到目标提案 | `44e81ec6116531691a4e6232e1f41889e0d40328ab3df735eeb48b1c470b937a` |
| `013_apply_plans` | 用户确认、状态边与单目标副作用计划 | `d4b213d255d1626648e42e672ffe50fe94793e3b027c406b397fa5a060b634e1` |
| `014_artifact_target_links` | Artifact 到正式目标的不可变来源链接 | `168fb1e5d289cd1a1fd0b4fdc01e2e229c54d7634762130789412d190207a4f0` |

迁移只增加表、索引和触发器，不改变既有 `world_settings` 或其他业务表形状。

## 版本边界

本版本只支持一条 `setting_candidates` 候选创建一条 `world_setting`。不实现 update/delete、批量或多目标 effect，不迁移其他生产 AI 入口，也不实现 Tool Registry、Planner、Memory、自动续跑、Multi-Agent 或 Agent 自主写入。

## 主要实现文件

- `src-tauri/src/domain/placement.rs`
- `src-tauri/src/repositories/placement_repository.rs`
- `src-tauri/src/services/placement_service.rs`
- `src-tauri/src/commands/placements.rs`
- `src/services/placements/placementRuntimeService.ts`
- `src/types/placement.ts`
- `src/components/right-dock/panels/SettingPanel.tsx`
- `tests/e2e/provider-pipeline-setting.spec.ts`
- `docs/architecture/safe-apply.md`

## 验证

- Node：16/16；tsx：53/53。
- Rust / SQLite：137/137，另 1 项真实用户数据库隔离副本测试按设计 ignored。
- ESLint：0 error，保留 1 条既有 React Hooks warning。
- TypeScript + Vite production build：通过，215 modules。
- Windows Tauri 完整 E2E：12/12；全部使用隔离 SQLite、Mock Provider、外网阻断和进程清理。
- Safe Apply 桌面 E2E：3 个 Proposal + 3 个 awaiting Plan；确认前正式设定不变，确认后仅 1 个 world_setting + 1 个 TargetLink；同 operation 重放数量保持不变。
- Tauri production build：通过，生成 MSI 与 NSIS。
- 版本同步、局部 rustfmt、凭据扫描和 `git diff --check`：通过。

本版本没有修改 Provider 网络协议、Prompt 或请求参数，因此没有再次调用真实 API。v2.3.1 已记录的一次低输出真实尝试仍是当前事实，不用 Mock 冒充真实 API 成功。

## Windows 发布产物

| 产物 | 大小 | SHA-256 |
|------|------|---------|
| `AI Novel Studio_2.3.2_x64_en-US.msi` | 6,488,064 bytes（6.19 MiB） | `7021db4d91b18ab9ccb1e185c84cbcf8733a1714cdbf0225d3487e7ccf83ef9f` |
| `AI Novel Studio_2.3.2_x64-setup.exe` | 4,654,131 bytes（4.44 MiB） | `32ecb5e54c3a7212b94664e0c084fda90a14743a88ed289ecc9f6ae472398017` |

完整验收证据见 [`audit/phase-3/10-v2.3.2-safe-apply-acceptance.md`](audit/phase-3/10-v2.3.2-safe-apply-acceptance.md)。

## 下一阶段

v2.4.x 将实现正式 Context / Constraint Compiler 与 Tool Registry，为 Planner 提供可复现来源、预算、schema、权限和副作用边界。
