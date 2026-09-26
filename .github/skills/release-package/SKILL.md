---
name: release-package
description: 执行用户明确要求的 AI Novel Studio 版本发布或发布准备；普通功能完成、构建通过或更新 CHANGELOG 不触发发布。
---

# 版本发布与收尾

遵循 [AGENTS.md](../../../AGENTS.md) 和 [Git 治理](../../../docs/project/git-workflow.md)。发布准备、commit、push、PR、合并、tag 和实际发布的授权分别按会话确认；已有明确授权不重复询问，示例命令不提供额外授权。

1. 核实版本、分支、当前差异及目标发布类型。只在用户要求版本变更时同步版本清单、锁文件、前端常量和 Tauri 配置；不自行递增下一版本。
2. 在最终验证前完成 CHANGELOG、README 及对应路线/设计文档。只有实际完成且有验收证据的阶段才标记完成。
3. Release Notes 从 CHANGELOG 当前版本段提取，历史快照保留在 `docs/project/release-history.md`，不新增 docs 下逐版本碎片。提取物核对日期、变更、验证、限制和回滚边界。
4. 运行一次 `scripts/agent-workflow/verify_project.ps1` 完整矩阵；不要再手动重复其子测试。CI 发布只能复用同一提交、成功完成的完整前置门禁，发布 job 复验 verified SHA；签名、生产产物、包体预算和通道检查仍针对实际产物执行。
5. 按已授权范围只暂存本次文件并检查暂存差异，不使用无差别 `git add .`。保留用户已有修改；不为取得 clean tree 自动提交或清理。
6. 分支/PR → 适用门禁与审查 → 合入并同步 main → 不可移动的 tag。没有对应授权时交付已准备的差异和证据，不能自行推送、建 tag 或发布。
7. 如实汇报实际完成的阶段、版本/提交/tag、产物、验证及限制；不自动启动下一版本。

发布门禁失败必须阻断发布。修复后复测受影响项；有效证据必须覆盖最终提交及配置，不把旧结果或不同提交的结果拼成发布通过。真实上传、签名、通道更新和回滚按既有失败关闭与补偿协议执行，不以模拟测试替代。

相关入口：`scripts/agent-workflow/release_workflow.ps1`、[发布清单](../../checklists/release.checklist.md)、[文档同步](../docs-sync/SKILL.md)。
