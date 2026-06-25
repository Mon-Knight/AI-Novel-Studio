import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = process.argv[2] || 'f:/ai-novel-studio';
const intermediateDir = join(PROJECT_ROOT, '.understand-anything', 'intermediate');

const graph = JSON.parse(readFileSync(join(intermediateDir, 'assembled-graph.json'), 'utf8'));

// Phase 4 — Architecture layers
const layers = [
  {
    id: 'layer:frontend-entry',
    name: '前端入口与路由',
    description: '应用的入口点、根组件和路由配置，包括 main.tsx、App.tsx 以及全局布局组件。',
    nodeIds: graph.nodes.filter(n =>
      n.filePath === 'src/main.tsx' || n.filePath === 'src/App.tsx' ||
      n.filePath?.startsWith('src/components/layout/') ||
      n.filePath?.startsWith('src/components/sidebar/') ||
      n.filePath?.startsWith('src/components/topbar/')
    ).map(n => n.id)
  },
  {
    id: 'layer:pages',
    name: '页面层',
    description: '所有页面级组件，实现各功能页面的完整布局和交互。',
    nodeIds: graph.nodes.filter(n => n.filePath?.startsWith('src/pages/')).map(n => n.id)
  },
  {
    id: 'layer:ui-components',
    name: 'UI 组件层',
    description: '可复用的通用 UI 组件，包括对话框、按钮、加载状态、错误提示等。',
    nodeIds: graph.nodes.filter(n =>
      n.filePath?.startsWith('src/components/') &&
      !n.filePath?.startsWith('src/components/layout/')
    ).map(n => n.id)
  },
  {
    id: 'layer:business-features',
    name: '业务功能层',
    description: '领域逻辑模块，包括小说规范化、Mock 数据等业务处理。',
    nodeIds: graph.nodes.filter(n => n.filePath?.startsWith('src/features/')).map(n => n.id)
  },
  {
    id: 'layer:services',
    name: '服务层',
    description: 'AI 调用、数据库访问、导入导出、角色管理等后端服务的封装。',
    nodeIds: graph.nodes.filter(n =>
      n.filePath?.startsWith('src/services/') ||
      n.filePath?.startsWith('src/hooks/')
    ).map(n => n.id)
  },
  {
    id: 'layer:state-management',
    name: '状态管理',
    description: 'React 全局状态管理 store。',
    nodeIds: graph.nodes.filter(n => n.filePath?.startsWith('src/store/')).map(n => n.id)
  },
  {
    id: 'layer:types-and-utils',
    name: '类型定义与工具函数',
    description: 'TypeScript 类型接口定义和通用辅助工具函数。',
    nodeIds: graph.nodes.filter(n =>
      n.filePath?.startsWith('src/types/') || n.filePath?.startsWith('src/utils/')
    ).map(n => n.id)
  },
  {
    id: 'layer:agent-system',
    name: 'Agent 系统',
    description: 'Agent 运行时和工具层，为未来的自主创作能力提供基础架构。',
    nodeIds: graph.nodes.filter(n =>
      n.filePath?.startsWith('src/agent/') || n.filePath?.startsWith('src/agent-tools/')
    ).map(n => n.id)
  },
  {
    id: 'layer:prompts',
    name: '提示词模板',
    description: 'AI 调用的提示词模板，包括应用内和外部提示词文件。',
    nodeIds: graph.nodes.filter(n =>
      n.filePath?.startsWith('src/prompts/') || n.filePath?.startsWith('prompts/')
    ).map(n => n.id)
  },
  {
    id: 'layer:styles',
    name: '样式层',
    description: 'CSS 样式文件，定义组件的视觉外观。',
    nodeIds: graph.nodes.filter(n => n.filePath?.endsWith('.css')).map(n => n.id)
  },
  {
    id: 'layer:tauri-backend',
    name: 'Tauri Rust 后端',
    description: 'Rust 编写的桌面壳后端，包括窗口管理、数据库操作、AI 通信和系统命令。',
    nodeIds: graph.nodes.filter(n =>
      n.filePath?.startsWith('src-tauri/')
    ).map(n => n.id)
  },
  {
    id: 'layer:config',
    name: '配置层',
    description: '项目配置文件，包括 TypeScript、Vite、ESLint、Tauri 和 Cargo 配置。',
    nodeIds: graph.nodes.filter(n =>
      n.type === 'config' || n.filePath?.endsWith('.json') || n.filePath?.endsWith('.toml') ||
      n.filePath?.endsWith('.cjs') || n.filePath?.endsWith('.mdc')
    ).map(n => n.id)
  },
  {
    id: 'layer:documentation',
    name: '文档层',
    description: '项目文档、版本发布说明、设计文档和用户指南。',
    nodeIds: graph.nodes.filter(n =>
      n.type === 'document' || n.filePath?.startsWith('docs/')
    ).map(n => n.id)
  },
  {
    id: 'layer:scripts',
    name: '脚本层',
    description: '构建、打包和验证脚本，自动化开发工作流。',
    nodeIds: graph.nodes.filter(n =>
      n.filePath?.startsWith('scripts/')
    ).map(n => n.id)
  }
];

// Filter out empty layers
const filteredLayers = layers.filter(l => l.nodeIds.length > 0);

// Phase 5 — Tour
const tour = [
  {
    order: 1,
    title: '项目概览',
    description: '从 README 入手了解 AI Novel Studio 的项目定位、核心能力和技术栈。这是一个 Windows 桌面端的 AI 长篇小说创作工作台。',
    nodeIds: ['document:README.md']
  },
  {
    order: 2,
    title: 'Agent 行为约束',
    description: 'AGENTS.md 定义了 AI Agent 在本仓库中的行为规则、禁止事项和开发工作流，是所有 AI 操作的基础约束文档。',
    nodeIds: ['document:AGENTS.md']
  },
  {
    order: 3,
    title: '项目配置入口',
    description: 'package.json 和 tsconfig.json 定义了项目的依赖、脚本和 TypeScript 编译选项，是理解构建系统的基础。',
    nodeIds: ['config:package.json', 'config:tsconfig.json']
  },
  {
    order: 4,
    title: '应用启动流程',
    description: '从 main.tsx（入口）→ App.tsx（根组件）→ 各页面组件，理解前端应用的启动和路由分发流程。',
    nodeIds: ['file:src/main.tsx', 'file:src/App.tsx']
  },
  {
    order: 5,
    title: '页面系统',
    description: '所有页面组件的全景视图，包括首页、写作工作台、设置、导入导出、资产库等核心功能页面。',
    nodeIds: graph.nodes.filter(n => n.filePath?.startsWith('src/pages/') && !n.filePath?.includes('.css')).slice(0, 8).map(n => n.id)
  },
  {
    order: 6,
    title: '服务层架构',
    description: 'AI 服务、数据库访问、角色管理、导入导出等服务模块，构成应用的业务逻辑核心。',
    nodeIds: graph.nodes.filter(n => n.filePath?.startsWith('src/services/') && !n.filePath?.includes('README')).slice(0, 10).map(n => n.id)
  },
  {
    order: 7,
    title: 'Tauri Rust 后端',
    description: 'Rust 编写的桌面壳后端代码，处理窗口管理、SQLite 数据库、AI API 通信和系统级命令。',
    nodeIds: graph.nodes.filter(n => n.filePath?.startsWith('src-tauri/src/')).map(n => n.id)
  },
  {
    order: 8,
    title: '类型系统',
    description: 'TypeScript 类型定义文件，定义了 Novel、Chapter、Volume、Character 等核心数据模型。',
    nodeIds: graph.nodes.filter(n => n.filePath?.startsWith('src/types/')).map(n => n.id)
  },
  {
    order: 9,
    title: '文档体系',
    description: 'docs/ 目录下的完整文档体系，包含产品设计、UI 参考、版本路线图和发布说明。',
    nodeIds: ['document:docs/product-design.md', 'document:docs/ui-reference.md', 'document:docs/data-model.md', 'document:docs/version-roadmap.md']
  },
  {
    order: 10,
    title: 'IDE 规则系统',
    description: '.cursor/rules/ 下的行为约束规则，定义 AI Agent 的安全边界、UI 标准和测试要求。',
    nodeIds: graph.nodes.filter(n => n.filePath?.startsWith('.cursor/rules/')).map(n => n.id)
  }
];

// Update graph with layers and tour
graph.layers = filteredLayers;
graph.tour = tour;

// Phase 6 — Inline validation
console.log('Running inline validation...');

const issues = [];
const warnings = [];
const nodeIds = new Set();
const seen = new Map();

graph.nodes.forEach((n, i) => {
  if (!n.id) { issues.push(`Node[${i}] missing id`); return; }
  if (!n.type) issues.push(`Node[${i}] '${n.id}' missing type`);
  if (!n.name) issues.push(`Node[${i}] '${n.id}' missing name`);
  if (!n.summary) issues.push(`Node[${i}] '${n.id}' missing summary`);
  if (!n.tags || !n.tags.length) { n.tags = ['untagged']; warnings.push(`Node '${n.id}' missing tags — defaulting to ['untagged']`); }
  if (seen.has(n.id)) issues.push(`Duplicate node ID '${n.id}'`);
  else seen.set(n.id, i);
  nodeIds.add(n.id);
});

graph.edges.forEach((e, i) => {
  if (!nodeIds.has(e.source)) issues.push(`Edge[${i}] source '${e.source}' not found`);
  if (!nodeIds.has(e.target)) issues.push(`Edge[${i}] target '${e.target}' not found`);
});

// Drop dangling edges
const validEdges = graph.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
const droppedEdges = graph.edges.length - validEdges.length;
graph.edges = validEdges;
if (droppedEdges > 0) warnings.push(`Dropped ${droppedEdges} dangling edges`);

// Validate layers
graph.layers.forEach(layer => {
  (layer.nodeIds || []).forEach(id => {
    if (!nodeIds.has(id)) issues.push(`Layer '${layer.id}' refs missing node '${id}'`);
  });
});

// Validate tour
graph.tour.forEach((step, i) => {
  (step.nodeIds || []).forEach(id => {
    if (!nodeIds.has(id)) issues.push(`Tour step[${i}] refs missing node '${id}'`);
  });
});

// Stats
const stats = {
  totalNodes: graph.nodes.length,
  totalEdges: graph.edges.length,
  totalLayers: graph.layers.length,
  tourSteps: graph.tour.length,
  nodeTypes: graph.nodes.reduce((a, n) => { a[n.type] = (a[n.type] || 0) + 1; return a; }, {}),
  edgeTypes: graph.edges.reduce((a, e) => { a[e.type] = (a[e.type] || 0) + 1; return a; }, {})
};

console.log('Validation complete.');
console.log('Issues:', issues.length);
console.log('Warnings:', warnings.length);
console.log('Stats:', JSON.stringify(stats, null, 2));

if (issues.length > 0) {
  issues.forEach(i => console.warn('  ISSUE:', i));
}

// Write final graph
const outputPath = join(intermediateDir, 'assembled-graph.json');
writeFileSync(outputPath, JSON.stringify(graph, null, 2));
console.log('Final assembled-graph.json written:', outputPath);

// Write review
const review = { issues, warnings, stats };
writeFileSync(join(intermediateDir, 'review.json'), JSON.stringify(review, null, 2));
console.log('review.json written');