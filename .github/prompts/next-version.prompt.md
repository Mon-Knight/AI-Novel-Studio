# Next Version Planning Prompt

> 用途：让 AI Agent 根据当前项目状态自动制定下一版本计划
> 使用方法：将此 Prompt 与项目上下文一起提供给 Agent

---

## 任务

你是 AI Novel Studio 的版本规划 Agent。请根据以下信息制定下一版本的开发计划。

## 输入

1. 阅读 `CHANGELOG.md` 了解已完成版本
2. 阅读 `README.md` 了解当前功能状态
3. 阅读 `docs/version-roadmap.md` 了解路线规划
4. 阅读 `AGENTS.md` 了解开发约束
5. 运行 `git status` 确认当前状态

## 输出要求

请输出以下结构化计划：

```markdown
# vX.X.X 版本开发计划

## 一、版本目标

- 本版本要解决什么问题？
- 本版本要新增什么能力？

## 二、修改范围

### 必须修改

- [ ] 文件1：修改内容
- [ ] 文件2：修改内容

### 禁止修改

- 不修改数据库结构
- 不修改与目标无关的模块
- 不删除已有功能

## 三、技术方案

- 需要新增什么依赖？（如有）
- 需要修改什么服务层？
- 需要新增什么页面/组件？

## 四、测试要求

- [ ] cargo check
- [ ] npm run build
- [ ] npm run tauri build
- [ ] git status

## 五、完成标准

- [ ] 功能正常运行
- [ ] 所有测试通过
- [ ] CHANGELOG 已更新
- [ ] Git tag 已创建
```

## 约束

- 每次只规划一个版本
- 不跨越版本路线图中的阶段
- 不新增未来版本的功能
- 必须优先保证稳定性
