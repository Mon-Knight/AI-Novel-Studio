## 变更目标

<!-- 说明本 PR 的单一版本目标与用户可见结果。 -->

## 影响范围

- [ ] 前端页面 / 组件
- [ ] 业务服务 / 状态管理
- [ ] Tauri / Rust
- [ ] SQLite migration / 项目备份
- [ ] Prompt / 文档

## 可靠性检查

- [ ] 未删除既有路由或功能
- [ ] 未在 UI 中直接调用 AI、SQL 或写入密钥
- [ ] 异步结果复验 novel/chapter/draft 所有权，取消后不提交迟到结果
- [ ] 数据库变更具备迁移、回滚/失败关闭与备份恢复测试
- [ ] 长文本与大列表路径保持有界

## 验证证据

```text
npm run lint:ci
npm run test:all
npm run test:component-size
npm run build
npm run test:bundle-size
cargo fmt --all -- --check --manifest-path src-tauri/Cargo.toml
cargo clean --manifest-path src-tauri/Cargo.toml -p novel-domain-gateway
cargo build --locked --manifest-path src-tauri/Cargo.toml -p novel-domain-gateway
cargo test --locked --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

## UI / 桌面体验

<!-- UI 变更请附浅色/暗色、2K 布局和 Windows 桌面截图；无 UI 变更写 N/A。 -->

## 文档与发布

- [ ] `CHANGELOG.md` 已更新
- [ ] README / 架构 / 数据模型已按影响同步
- [ ] 版本号与 CHANGELOG 发布段落已通过 `npm run test:version-sync`
- [ ] 分支、审查和合并方式符合 `docs/project/git-workflow.md`
- [ ] 回滚步骤和兼容边界已记录
