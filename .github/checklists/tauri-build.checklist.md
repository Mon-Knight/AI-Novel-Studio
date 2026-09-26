# Tauri Desktop Build Checklist

> 用途：Tauri 桌面应用构建前的检查清单
> 使用时机：打包配置、依赖图或发布任务执行 `npm run tauri:build` 前后；普通局部修改不要求完整安装包构建

---

## 构建前

- [ ] `cargo check --locked --manifest-path src-tauri/Cargo.toml` 已通过（`tauri:build` 已包含前端构建，不必提前重复 `npm run build`）
- [ ] 图标资源存在于 `src-tauri/icons/`
- [ ] `tauri.conf.json` 配置正确
  - [ ] `package.productName` = "AI Novel Studio"
  - [ ] `package.version` 正确
  - [ ] `build.distDir` 指向正确路径
  - [ ] `bundle.identifier` 正确
- [ ] 没有未提交的敏感文件（`.env.local` / API Key）

---

## 构建中

- [ ] Rust 编译成功
- [ ] 前端资源嵌入成功
- [ ] 无编译错误

---

## 构建后

- [ ] 安装包路径已记录
- [ ] EXE 路径已记录
- [ ] EXE 可启动
- [ ] 窗口尺寸符合 `tauri.conf.json`（默认 1280×820，最小 1024×700）
- [ ] 最大化功能正常
- [ ] 前端页面正常加载
- [ ] 无控制台报错

---

## 日志检查

- [ ] 日志可定位（控制台 / 文件）
- [ ] 无隐藏的 panic 或 unhandled error

---

## 产物记录

- [ ] EXE 路径：`____________________`
- [ ] 安装包路径：`____________________`
- [ ] 文件大小：`____________________`
- [ ] 构建时间：`____________________`
