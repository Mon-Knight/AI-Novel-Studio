# 快速开始指南

> AI Novel Studio — Windows 桌面端 AI 小说创作工作台

## 环境要求

- **操作系统**：Windows 10/11
- **Node.js**：>= 22.6（运行内建 TypeScript 安全测试所需）
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

1. 打开应用后进入创作工作台
2. 点击「设置中心」配置 AI；可先用 **Mock 模式**
3. 到「小说作品」创建小说并建好分卷/章节
4. 回到工作台选择目标章节，发送「生成下一章」

## 下一步

- 查看 [桌面端使用说明](desktop-usage.md)
- 查看 [AI 设置说明](ai-settings.md)
- 查看 [用户使用手册](../user-guide.md)
