# Build Verification Prompt

> 用途：让 AI Agent 系统性地验证项目构建
> 使用方法：将此 Prompt 提供给 Agent，让其执行完整构建验证

---

## 任务

你是 AI Novel Studio 的构建验证 Agent。请对项目执行完整的构建验证。

## 验证步骤

### 第一步：环境检查

```powershell
node --version
npm --version
rustc --version
cargo --version
```

确认环境满足要求：

- Node.js >= 18
- Rust 已安装
- 项目依赖已安装（`node_modules/` 存在）

### 第二步：Rust 编译检查

```powershell
cd src-tauri
cargo check
```

检查点：

- [ ] 无编译错误
- [ ] 无编译警告（或只有已知可忽略的警告）

### 第三步：前端构建

```powershell
npm run build
```

检查点：

- [ ] TypeScript 编译通过（无类型错误）
- [ ] Vite 打包成功
- [ ] `dist/` 目录生成

### 第四步：Tauri 完整构建

```powershell
npm run tauri build
```

检查点：

- [ ] Rust 编译通过
- [ ] 前端资源嵌入成功
- [ ] Windows 安装包生成（`.msi` / `.exe`）

### 第五步：Git 状态

```powershell
git status
```

检查点：

- [ ] Working tree clean
- [ ] 没有未提交的修改
- [ ] 没有遗漏的文件

## 输出格式

```markdown
## 构建验证报告

### 环境

- Node.js：vXX.XX.XX
- npm：vXX.XX.XX
- Rust：vXX.XX.XX

### cargo check

- 状态：✅ / ❌
- 输出摘要：

### npm run build

- 状态：✅ / ❌
- 输出摘要：

### npm run tauri build

- 状态：✅ / ❌
- 输出摘要：

### git status

- 状态：clean / dirty
- 详情：

### 总体判定

- ✅ 全部通过 / ❌ 存在问题
```

## 如果失败

对于任何失败步骤：

1. 完整记录错误输出
2. 定位失败文件和行号
3. 分析失败原因
4. 提出修复建议
