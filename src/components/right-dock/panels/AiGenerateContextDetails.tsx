import type { ChapterGenerationContext, ChapterPromptDebugInfo } from '../../../types/ai';
import type { OutputProfile } from '../../../types/output';
import type { StyleProfile } from '../../../types/style';
import { getChapterCharacterNames, getRequiredCharacterNames } from './aiGenerateValidation';

interface AiGenerateContextDetailsProps {
  context: ChapterGenerationContext;
  promptDebug: ChapterPromptDebugInfo | null;
  styles: StyleProfile[];
  selectedStyleId: string;
  outputs: OutputProfile[];
  selectedOutputId: string;
  wordCount: number;
}

export function AiGenerateContextDetails({
  context,
  promptDebug,
  styles,
  selectedStyleId,
  outputs,
  selectedOutputId,
  wordCount,
}: AiGenerateContextDetailsProps) {
  const chapterCharacters = getChapterCharacterNames(context);
  const requiredCharacters = getRequiredCharacterNames(context);
  const selectedStyleName = styles.find((style) => style.id === selectedStyleId)?.name;
  const selectedOutputName = outputs.find((output) => output.id === selectedOutputId)?.name;

  return (
    <div
      style={{
        fontSize: 11,
        lineHeight: 1.7,
        color: 'var(--color-text-secondary)',
        marginTop: 8,
        padding: 8,
        background: 'var(--color-bg-primary)',
        borderRadius: 4,
      }}
    >
      <div>
        总大纲：
        {context.masterOutline || context.novelOutline
          ? `有（${(context.masterOutline || context.novelOutline)!.length} 字）`
          : '无'}
      </div>
      <div>
        分卷大纲：{context.volumeOutline ? `有（${context.volumeOutline.length} 字）` : '无'}
      </div>
      <div>
        章节大纲：{context.chapterOutline ? `有（${context.chapterOutline.length} 字）` : '无'}
      </div>
      <div>大纲来源：{context.chapterOutlineSource || 'empty'}</div>
      <div>大纲执行清单：{context.outlineKeyPoints?.length || 0} 项</div>
      <div>本章目标：{context.chapterGoal ? `有（${context.chapterGoal.length} 字）` : '无'}</div>
      <div>
        出场角色：
        {chapterCharacters.length > 0
          ? `${chapterCharacters.length} 个（${chapterCharacters.join('、')}）`
          : '0 个'}
      </div>
      <div>
        必须出场角色：
        {requiredCharacters.length > 0
          ? `${requiredCharacters.length} 个（${requiredCharacters.join('、')}）`
          : '0 个'}
      </div>
      <div>
        本章事件：{context.chapterEvents ? context.chapterEvents.match(/\n- /g)?.length || 1 : 0} 个
      </div>
      <div>世界设定：{context.worldBackground ? '有' : '无'}</div>
      <div>前文总结：{context.previousContext ? '有' : '无'}</div>
      <div>
        风格方案：{context.styleProfile ? '有' : '无（使用默认）'}
        {selectedStyleName ? `（${selectedStyleName}）` : ''}
      </div>
      <div>输出控制：{selectedOutputName || '默认'}</div>
      <div>目标字数：{context.targetWordCount || wordCount} 字</div>
      {promptDebug && (
        <>
          <div>最终 prompt 模板：{promptDebug.templateSource}</div>
          <div>
            包含角色块：{promptDebug.hasRequiredCharactersBlock ? '是' : '否'}（
            {promptDebug.requiredCharactersCount} 个）
          </div>
          <div>包含章节大纲：{promptDebug.includesChapterOutlineText ? '是' : '否'}</div>
          <div>
            包含大纲执行清单：{promptDebug.includesOutlineChecklistText ? '是' : '否'}（
            {promptDebug.outlineKeyPointCount} 项）
          </div>
          <div>包含分卷大纲：{promptDebug.includesVolumeOutlineText ? '是' : '否'}</div>
          <div>包含总纲：{promptDebug.includesMasterOutlineText ? '是' : '否'}</div>
          <div>prompt 长度：{promptDebug.promptLength} 字符</div>
        </>
      )}
    </div>
  );
}
