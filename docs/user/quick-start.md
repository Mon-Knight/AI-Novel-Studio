# 快速开始指南

> AI Novel Studio — Windows 桌面端 AI 小说创作工作台

## 环境要求

- **操作系统**：Windows 10/11
- **Node.js**：>= 18
- **Rust**（仅 Tauri 桌面模式需要）

## 安装

```powershell
# 克隆仓库
git clone https://github.com/Mon-Knight/AI-Novel-Studio.git
cd AI-Novel-Studio

# 安装依赖
npm install
```

## 启动

### 浏览器开发模式（推荐开发时使用）

```powershell
npm run dev
```

浏览器访问 `http://localhost:1420`

### Tauri 桌面模式

```powershell
npm run tauri dev
```

## 构建

```powershell
# 前端构建
npm run build

# 桌面 EXE 构建
npm run tauri build
```

构建产物位于 `src-tauri/target/release/`

## 首次使用

1. 打开应用后进入首页
2. 点击「设置」进入 AI 设置
3. 可选择 **Mock 模式** 快速体验完整工作流（无需 API Key）
4. 或关闭 Mock 模式，配置 OpenAI 兼容 API

## 下一步

- 查看 [桌面端使用说明](desktop-usage.md)
- 查看 [AI 设置说明](ai-settings.md)
- 查看 [用户使用手册](../user-guide.md)
