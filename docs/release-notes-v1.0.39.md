# AI Novel Studio v1.0.39 发布说明

## 版本信息
- **版本号**: v1.0.39
- **发布日期**: 2026-05-18
- **类型**: 工程修复

## 修复内容

### 1. ESLint 配置补充
- 新增 `.eslintrc.cjs` 配置文件
- 修复 `npm run lint` 因缺少配置而无法执行的问题
- 规则策略：只保留推荐规则，warning 为主，不阻塞开发
- 修复 4 个 error（2 个 React Hooks 条件调用 + 2 个无用 eslint-disable 指令）
- 当前状态：0 errors, 56 warnings（全部为预先存在的）

### 2. 数据库迁移顺序修复
- `db.rs` 重构为三段式初始化：`create_base_tables` → `run_migrations` → `create_indexes`
- 确保 `idx_characters_protagonist` 索引创建前 `is_protagonist` 字段已通过迁移补齐
- 新增 `column_exists` / `ensure_column` 通用迁移工具函数
- 新增 `migrate_characters_table` 自动补齐所有缺失字段
- 旧数据库启动不再因缺字段而崩溃

### 修改文件
- `.eslintrc.cjs` — 新增 ESLint 配置
- `package.json` — 版本号 1.0.39，lint 脚本优化
- `src-tauri/tauri.conf.json` — 版本号 1.0.39
- `src/components/right-dock/RightPanel.tsx` — 修复 Hooks 条件调用
- `src/utils/debugSeed.ts` — 移除无用 eslint-disable
- `src-tauri/src/db.rs` — 数据库迁移顺序修复（已有改动）
- `docs/release-notes-v1.0.39.md` — 发布说明

### 验证结果
- `npm run lint` → 0 errors, 56 warnings ✅
- `npm run build` → ✅
- `cargo check` → ✅
