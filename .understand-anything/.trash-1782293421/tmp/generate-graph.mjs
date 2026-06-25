import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, basename, extname } from 'path';

const PROJECT_ROOT = process.argv[2] || 'f:/ai-novel-studio';
const tmpDir = join(PROJECT_ROOT, '.understand-anything', 'tmp');
const intermediateDir = join(PROJECT_ROOT, '.understand-anything', 'intermediate');

// Load scan result for file metadata
const scanResult = JSON.parse(readFileSync(join(intermediateDir, 'scan-result.json'), 'utf8'));

// Collect all extraction results
const nodes = [];
const edges = [];
const nodeIdSet = new Set();
let nodeCounter = { file: 0, function: 0, class: 0, config: 0, document: 0, service: 0, pipeline: 0, table: 0, schema: 0, resource: 0, endpoint: 0 };

function addNode(type, id, name, filePath, summary, tags, complexity = 'simple', extra = {}) {
  if (nodeIdSet.has(id)) return;
  nodeIdSet.add(id);
  nodeCounter[type] = (nodeCounter[type] || 0) + 1;
  const node = { id, type, name, filePath, summary, tags, complexity };
  if (extra.sections) node.sections = extra.sections;
  if (extra.languageNotes) node.languageNotes = extra.languageNotes;
  if (extra.exports) node.exports = extra.exports;
  nodes.push(node);
}

function addEdge(source, target, type, weight = 0.5, extra = {}) {
  if (!nodeIdSet.has(source) || !nodeIdSet.has(target)) return;
  // Deduplicate
  if (edges.some(e => e.source === source && e.target === target && e.type === type)) return;
  const edge = { source, target, type, weight };
  if (extra.confidence) edge.confidence = extra.confidence;
  edges.push(edge);
}

// Category descriptions for summaries
const categoryDescriptions = {
  code: {
    'src/App.tsx': { summary: '应用根组件，配置路由表与全局布局，统一管理页面级路由分发与错误边界。', tags: ['entry-point', 'routing', 'component'], complexity: 'moderate' },
    'src/main.tsx': { summary: '前端应用入口文件，挂载 React 根组件到 DOM 并初始化 HashRouter。', tags: ['entry-point', 'bootstrap'], complexity: 'simple' },
    'src/vite-env.d.ts': { summary: 'Vite 环境类型声明文件，提供客户端类型引用。', tags: ['type-definition', 'build-system'], complexity: 'simple' },
  },
};

// Load batch data for import edges
const batchesData = JSON.parse(readFileSync(join(intermediateDir, 'batches.json'), 'utf8'));
const allImportData = {};
for (const batch of batchesData.batches) {
  const impData = batch.batchImportData || {};
  for (const [file, imports] of Object.entries(impData)) {
    // imports are already resolved relative paths
    if (!allImportData[file]) allImportData[file] = [];
    allImportData[file] = imports;
  }
}

// Process all batch extraction results
const batchFiles = readdirSync(tmpDir).filter(f => f.startsWith('ua-file-extract-results-'));

let totalFiles = 0;
let fileIdx = 0;

for (const batchFile of batchFiles) {
  const data = JSON.parse(readFileSync(join(tmpDir, batchFile), 'utf8'));
  if (!data.scriptCompleted || !data.results) continue;

  for (const file of data.results) {
    fileIdx++;
    totalFiles++;
    const { path, language, fileCategory, totalLines, nonEmptyLines, functions, classes, exports, callGraph, metrics } = file;

    // Determine node type based on fileCategory
    let nodeType = 'file';
    if (fileCategory === 'config') nodeType = 'config';
    else if (fileCategory === 'docs') nodeType = 'document';
    else if (fileCategory === 'infra') {
      if (path.includes('Dockerfile') || path.includes('docker-compose')) nodeType = 'service';
      else if (path.includes('.github/workflows') || path.includes('.gitlab-ci')) nodeType = 'pipeline';
      else if (path.endsWith('.tf')) nodeType = 'resource';
      else nodeType = 'service';
    }
    else if (fileCategory === 'markup') nodeType = 'file';
    else if (fileCategory === 'script') nodeType = 'file';

    const nodeId = `${nodeType}:${path}`;

    // Determine complexity
    let complexity = 'simple';
    if (nonEmptyLines > 200) complexity = 'complex';
    else if (nonEmptyLines > 50) complexity = 'moderate';

    // Generate summary based on file path and category
    let summary = '';
    let tags = [];
    const fileName = basename(path);
    const dirName = dirname(path);

    if (nodeType === 'document') {
      const docName = fileName.replace(/\.md$/, '');
      summary = `文档：${docName}`;
      if (fileName === 'README.md') summary = '项目或模块自述文件，包含概述、使用说明和架构参考。';
      else if (fileName.includes('release-notes')) summary = `版本发布说明文档（${docName}），记录该版本的变更内容和修复项。`;
      else if (fileName.includes('roadmap')) summary = '项目版本路线图，规划各版本的功能目标和里程碑。';
      else if (dirName.includes('user') || dirName.includes('design')) summary = `${docName} — 项目设计/用户相关文档。`;
      else summary = `项目文档：${docName}，提供 ${dirName} 相关的参考信息。`;
      tags = ['documentation'];
    } else if (nodeType === 'config') {
      if (fileName === 'package.json') summary = 'Node.js 项目清单文件，定义项目元数据、依赖项和构建脚本。';
      else if (fileName === 'tsconfig.json') summary = 'TypeScript 编译器配置，定义编译选项、路径映射和严格模式设置。';
      else if (fileName === 'vite.config.ts') summary = 'Vite 构建工具配置，定义插件、别名和开发服务器设置。';
      else if (fileName === 'Cargo.toml') summary = 'Rust 项目清单（Tauri 桌面壳），定义 Rust 依赖和构建配置。';
      else if (fileName === 'tauri.conf.json') summary = 'Tauri 桌面应用配置，定义窗口尺寸、权限和安全策略。';
      else if (fileName === '.eslintrc.cjs') summary = 'ESLint 代码规范配置，定义 TypeScript/React 代码检查规则。';
      else summary = `配置文件：${fileName}，位于 ${dirName}。`;
      tags = ['configuration'];
    } else if (path.startsWith('src-tauri/src/')) {
      // Tauri Rust backend
      if (fileName === 'ai.rs') summary = 'Tauri Rust AI 服务模块，负责与外部 AI API 通信和聊天补全。';
      else if (fileName === 'commands.rs') summary = 'Tauri Rust 命令层，定义所有前端可调用的后端命令和数据传输对象。';
      else if (fileName === 'main.rs') summary = 'Tauri 应用 Rust 入口，初始化窗口、注册命令和启动事件循环。';
      else if (fileName === 'db.rs') summary = 'SQLite 数据库操作模块，管理连接池、迁移和数据持久化。';
      else if (fileName === 'build.rs') summary = 'Cargo 构建脚本，在编译前执行代码生成或环境检测。';
      else summary = `Tauri Rust 后端模块：${fileName}，处理 ${dirName.split('/').pop()} 相关逻辑。`;
      tags = ['tauri-backend', 'rust'];
    } else if (path.startsWith('src/pages/')) {
      const pageName = path.split('/')[2];
      summary = `页面组件：${pageName}，实现 ${pageName} 页面的布局和交互逻辑。`;
      tags = ['page', 'component', 'react'];
    } else if (path.startsWith('src/components/')) {
      const compDir = path.split('/')[2];
      if (fileName.includes('Dialog')) summary = `对话框组件：${fileName}，提供 ${compDir} 相关的弹窗交互。`;
      else if (fileName.includes('Pane')) summary = `面板组件：${fileName}，展示 ${compDir} 相关的侧边栏/面板内容。`;
      else if (fileName.includes('Button')) summary = `按钮组件：${fileName}，提供导航或操作按钮功能。`;
      else if (fileName.includes('Tab')) summary = `标签页组件：${fileName}，管理多标签页切换和内容展示。`;
      else summary = `UI 组件：${fileName}，属于 ${compDir} 模块的一部分。`;
      tags = ['component', 'react', 'ui'];
    } else if (path.startsWith('src/services/')) {
      const svcDir = path.split('/')[2];
      if (path.includes('database/') || path.includes('db')) summary = `数据库服务：${fileName}，管理 ${svcDir || '数据'} 的持久化与查询。`;
      else if (path.includes('ai/')) summary = `AI 服务：${fileName}，封装 AI 调用、任务管理和结果处理。`;
      else if (path.includes('export/')) summary = `导出服务：${fileName}，处理作品导出为 TXT/Markdown/JSON 格式。`;
      else if (path.includes('import/')) summary = `导入服务：${fileName}，处理外部文件导入到作品结构。`;
      else if (path.includes('characters/')) summary = `角色服务：${fileName}，管理角色库的 CRUD 和推荐逻辑。`;
      else summary = `服务层模块：${fileName}，提供 ${svcDir || ''} 相关的业务逻辑。`;
      tags = ['service', 'data-access'];
    } else if (path.startsWith('src/features/')) {
      summary = `业务功能模块：${fileName}，实现特定的领域逻辑和数据处理。`;
      tags = ['feature', 'business-logic'];
    } else if (path.startsWith('src/store/')) {
      summary = `状态管理：${fileName}，管理 React 全局状态和数据流。`;
      tags = ['state-management', 'store'];
    } else if (path.startsWith('src/hooks/')) {
      summary = `自定义 Hook：${fileName}，封装可复用的 React Hooks 逻辑。`;
      tags = ['hook', 'react'];
    } else if (path.startsWith('src/types/')) {
      summary = `TypeScript 类型定义：${fileName}，定义核心数据模型和接口类型。`;
      tags = ['type-definition', 'typescript'];
    } else if (path.startsWith('src/utils/')) {
      summary = `工具函数：${fileName}，提供通用辅助功能和数据处理。`;
      tags = ['utility', 'helper'];
    } else if (path.startsWith('src/agent/')) {
      summary = `Agent 运行时模块：${fileName}，实现 Agent 系统的核心运行逻辑。`;
      tags = ['agent', 'runtime'];
    } else if (path.startsWith('src/agent-tools/')) {
      summary = `Agent 工具层：${fileName}，提供 Agent 可调用的工具函数。`;
      tags = ['agent', 'tool'];
    } else if (path.startsWith('src/prompts/')) {
      summary = `提示词模板：${fileName}，定义 AI 调用的提示词结构和参数。`;
      tags = ['prompt', 'ai'];
    } else if (path.startsWith('src/styles/')) {
      summary = `样式文件：${fileName}，定义组件或页面的视觉样式。`;
      tags = ['stylesheet', 'css'];
    } else if (path.startsWith('.cursor/')) {
      summary = `Cursor IDE 规则文件：${fileName}，定义 AI Agent 在该项目中的行为约束。`;
      tags = ['configuration', 'cursor', 'rules'];
    } else if (path.startsWith('scripts/')) {
      summary = `构建/验证脚本：${fileName}，自动化项目构建、测试和部署流程。`;
      tags = ['script', 'automation'];
    } else if (path.startsWith('prompts/')) {
      summary = `AI 提示词模板文件：${fileName}，定义小说创作各阶段的提示词框架。`;
      tags = ['prompt', 'ai', 'template'];
    } else {
      summary = `文件：${fileName}，位于 ${dirName}。`;
      tags = ['utility'];
    }

    // Refine tags based on file patterns
    if (fileName.includes('.test.') || fileName.includes('.spec.') || fileName.includes('_test')) {
      tags.push('test');
      summary = '测试文件：' + summary;
    }
    if (fileName === 'index.ts' || fileName === 'index.tsx' || fileName === '__init__.py') {
      if (!tags.includes('entry-point')) tags.unshift('barrel');
    }
    if (fileName.includes('mock')) tags.push('mock');
    if (exports && exports.length > 3 && (functions?.length || 0) < 2) {
      if (!tags.includes('barrel')) tags.push('barrel');
    }

    addNode(nodeType, nodeId, fileName, path, summary, tags.slice(0, 5), complexity);

    // Add function nodes
    if (functions && Array.isArray(functions)) {
      for (const fn of functions) {
        if (fn.startLine && fn.endLine && (fn.endLine - fn.startLine >= 10 || fn.startLine <= 5)) {
          const fnId = `function:${path}:${fn.name}`;
          const fnSummary = fn.name.match(/[A-Z]/) ?
            `方法：${fn.name}，执行 ${fileName} 中的关键操作。` :
            `函数：${fn.name}()，在 ${fileName} 中定义的辅助逻辑。`;
          addNode('function', fnId, fn.name, path, fnSummary, ['function'], 'simple');
          addEdge(fnId, nodeId, 'contains', 1.0);
        }
      }
    }

    // Add class nodes
    if (classes && Array.isArray(classes)) {
      for (const cls of classes) {
        const clsId = `class:${path}:${cls.name}`;
        addNode('class', clsId, cls.name, path, `类：${cls.name}，${fileName} 中定义的核心数据结构或组件。`, ['class'], 'moderate');
        addEdge(clsId, nodeId, 'contains', 1.0);
      }
    }

    // Add import edges
    const imports = allImportData[path] || [];
    for (const imp of imports) {
      const targetId = `file:${imp}`;
      // Also try config/document prefixes
      const altIds = [`config:${imp}`, `document:${imp}`, `service:${imp}`, `pipeline:${imp}`];
      let found = false;
      if (nodeIdSet.has(targetId)) { addEdge(nodeId, targetId, 'imports', 0.7); found = true; }
      for (const altId of altIds) {
        if (nodeIdSet.has(altId)) { addEdge(nodeId, altId, 'imports', 0.7); found = true; break; }
      }
    }

    // Add call graph edges
    if (callGraph && Array.isArray(callGraph)) {
      for (const call of callGraph) {
        if (call.caller && call.callee) {
          const callerId = `function:${path}:${call.caller}`;
          const calleeId = `function:${path}:${call.callee}`;
          addEdge(callerId, calleeId, 'calls', 0.8);
        }
      }
    }
  }
}

// Add README and key document nodes (might have been missed)
const keyDocs = [
  { path: 'README.md', type: 'document', name: 'README.md', summary: 'AI Novel Studio 项目主自述文件，包含项目简介、快速开始、架构概览和文档索引。', tags: ['documentation', 'entry-point'] },
  { path: 'CHANGELOG.md', type: 'document', name: 'CHANGELOG.md', summary: '项目变更日志，记录每个版本的更新内容、修复和新增功能。', tags: ['documentation', 'versioning'] },
  { path: 'AGENTS.md', type: 'document', name: 'AGENTS.md', summary: 'AI Agent 行为约束文件，定义 Agent 在本仓库中的工作规则和禁止事项。', tags: ['documentation', 'agent', 'safety'] },
];

for (const doc of keyDocs) {
  const id = `${doc.type}:${doc.path}`;
  if (!nodeIdSet.has(id)) {
    addNode(doc.type, id, doc.name, doc.path, doc.summary, doc.tags, 'simple');
  }
}

// Connect App.tsx to all pages
for (const node of nodes) {
  if (node.filePath?.startsWith('src/pages/')) {
    addEdge('file:src/App.tsx', node.id, 'imports', 0.7);
  }
  // Connect main.tsx to App.tsx
  if (node.id === 'file:src/main.tsx') {
    addEdge(node.id, 'file:src/App.tsx', 'imports', 0.7);
  }
}

// Sort output
nodes.sort((a, b) => a.id.localeCompare(b.id));
edges.sort((a, b) => a.source.localeCompare(b.source) || a.type.localeCompare(b.type));

// Write assembled graph
const graph = {
  version: '1.0.0',
  project: {
    name: scanResult.name,
    languages: scanResult.languages,
    frameworks: scanResult.frameworks,
    description: scanResult.description,
    analyzedAt: new Date().toISOString(),
    gitCommitHash: '33fc8d71bada77e2168e865c94a83f998182c47b'
  },
  nodes,
  edges,
  layers: [],
  tour: []
};

writeFileSync(join(intermediateDir, 'assembled-graph.json'), JSON.stringify(graph, null, 2));
console.log(`Graph generated: ${nodes.length} nodes, ${edges.length} edges`);
console.log(`Node types: ${JSON.stringify(nodeCounter)}`);