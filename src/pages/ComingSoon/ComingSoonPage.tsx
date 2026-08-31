import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Construction } from 'lucide-react';
import BackButton from '../../components/common/BackButton';
import { APP_VERSION } from '../../constants/version';
import '../../styles/coming-soon.css';

const moduleInfo: Record<string, { title: string; desc: string }> = {
  assets: { title: '创作资产', desc: '管理角色库、世界设定、剧情事件等创作资产' },
  templates: { title: '模板中心', desc: '浏览和使用提示词模板与风格模板' },
  'ai-tasks': { title: 'AI任务记录', desc: '查看所有 AI 任务的历史记录与执行结果' },
  'import-export': { title: '导入导出', desc: '支持 TXT / JSON 格式的小说作品导入与导出' },
  'new-novel': { title: '新建作品', desc: '创建新的小说作品，配置基础设定' },
  'import-novel': { title: '导入作品', desc: '从文件导入已有小说作品' },
  'import-txt': { title: '导入 TXT', desc: '从 TXT 文件导入小说内容' },
  'import-json': { title: '导入 JSON', desc: '从 JSON 文件导入结构化小说数据' },
  'world-setting': { title: '基础设定', desc: '管理世界背景、规则体系与主角设定' },
  outlines: { title: '大纲管理', desc: '规划分卷大纲与章节大纲' },
  characters: { title: '角色库', desc: '管理小说角色、关系与状态' },
  'style-profiles': { title: '风格方案', desc: '配置写作风格与输出控制方案' },
  'output-profiles': { title: '输出控制', desc: '章节输出格式、视角与字数控制' },
  'edit-novel': { title: '编辑作品', desc: '修改作品基本信息和设定' },
  'export-novel': { title: '导出作品', desc: '将作品导出为不同格式文件' },
};

function ComingSoonPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const from = searchParams.get('from') || '';
  const info = moduleInfo[from] || {
    title: '即将开放',
    desc: '该功能正在开发中，将在后续版本开放',
  };

  return (
    <div className="coming-soon-page">
      <BackButton label="返回首页" to="/" />
      <div className="coming-soon-card">
        <div className="coming-soon-icon">
          <Construction aria-hidden="true" size={42} strokeWidth={1.8} />
        </div>
        <div className="coming-soon-title">{info.title}</div>
        <div className="coming-soon-desc">
          {info.desc}
          <br />
          当前版本为 {APP_VERSION}，该模块尚未在本版本开放。
        </div>
        <div className="coming-soon-version">{APP_VERSION} · 即将开放</div>
        <div style={{ marginTop: 24 }}>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.8} />
            返回首页
          </button>
        </div>
      </div>
    </div>
  );
}

export default ComingSoonPage;
