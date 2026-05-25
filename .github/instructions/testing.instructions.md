# Testing Instructions

> 适用于：所有版本的验证与测试
> 优先级：高（每个版本必须执行）
> 适用范围：整个项目

---

## 1. 强制验证命令

每个版本开发完成后，**必须**运行以下全部命令并通过：

### 1.1 Rust 编译检查

```powershell
cargo check
```

- 检查 Rust 代码编译是否通过
- 必须在 `src-tauri/` 目录下执行
- 如有错误，必须先修复再继续

### 1.2 前端构建

```powershell
npm run build
```

- TypeScript 编译 + Vite 打包
- 检查是否有 TS 类型错误
- 检查打包是否成功

### 1.3 Tauri 完整构建

```powershell
npm run tauri build
```

- 完整的桌面应用构建
- 验证 Tauri + React 集成是否正常
- 检查最终产物

### 1.4 Git 状态检查

```powershell
git status
```

- 确认 working tree clean
- 确认所有修改已提交
- 确认没有遗漏文件

---

## 2. 可选验证

### 2.1 ESLint

```powershell
npm run lint
```

- 代码风格检查
- 潜在问题提示

### 2.2 Tauri 开发模式

```powershell
npm run tauri dev
```

- 启动桌面应用
- 手动验证关键页面
- 确认 UI 正常渲染

---

## 3. 验证检查清单

每个版本完成后，对照以下清单：

- [ ] `cargo check` 通过
- [ ] `npm run build` 通过
- [ ] `npm run tauri build` 通过
- [ ] `git status` 显示 clean
- [ ] 所有页面路由可访问
- [ ] 写作工作台正常渲染
- [ ] 右侧工具栏正常交互
- [ ] Mock 数据正常加载
- [ ] 无控制台报错
- [ ] 无 TypeScript 编译错误

---

## 4. 构建失败处理

如果任何一步构建失败：

1. **完整记录错误输出**
2. **定位失败原因**（文件/行号/错误类型）
3. **修复问题**
4. **重新运行全部验证**
5. **确认全部通过后才可提交**

不得跳过验证步骤，不得忽略构建警告/错误。

---

## 5. 测试数据

- 使用 Mock 数据进行 UI 测试
- 不依赖真实 API Key 进行测试
- 测试后清理临时数据

---

## 6. 自动化验证（未来）

后续版本将引入：

- 自动化 CI/CD（GitHub Actions）
- 单元测试（Vitest / Jest）
- E2E 测试（Playwright）
- Rust 测试（`cargo test`）

---

> **本文件是 AI Novel Studio 测试验证的权威指令。任何版本未经完整验证不得发布。**
