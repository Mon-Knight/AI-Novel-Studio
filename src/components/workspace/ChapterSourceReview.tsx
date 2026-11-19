import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import { useChapterSourceReview } from '../../features/workspace/useChapterSourceReview';
import {
  changedSourceParagraphs,
  sourceReviewMatches,
  type SourceReviewAsset,
} from '../../services/worldRules/chapterSourceReview';
import { ModalFrame } from '../common/ModalFrame';
import SettingEditForm from '../novel-detail/SettingEditForm';
import { confirmDanger } from '../../utils/nativeDialog';
import './chapter-source-review.css';

function SourceReviewDialog({
  chapter,
  draft,
  original,
  onClose,
}: {
  chapter: Chapter;
  draft: ChapterDraft;
  original?: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const review = useChapterSourceReview(chapter.novelId, chapter.id, draft.id);
  const [selected, setSelected] = useState('');
  const [opened, setOpened] = useState<SourceReviewAsset[]>([]);
  const [dirtyKeys, setDirtyKeys] = useState<string[]>([]);
  const [leaving, setLeaving] = useState(false);
  const leaveLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const leave = async (path?: string) => {
    if (review.saving || leaveLock.current) return;
    leaveLock.current = true;
    setLeaving(true);
    try {
      if (
        dirtyKeys.length &&
        !(await confirmDanger({
          title: '仍有未保存的源设定',
          message: '离开核对窗口会丢弃未保存的源设定输入。确认离开吗？',
          okLabel: '丢弃并离开',
          cancelLabel: '继续核对',
          testId: 'source-review-discard',
        }))
      )
        return;
      if (!mounted.current) return;
      onClose();
      if (path) navigate(path);
    } finally {
      leaveLock.current = false;
      if (mounted.current) setLeaving(false);
    }
  };
  const snapshot = review.snapshot;
  const changes = snapshot ? changedSourceParagraphs(original, snapshot.content) : null;
  const changedText = changes ? [...changes.removed, ...changes.added].join('\n') : '';
  const assetKey = (asset: SourceReviewAsset) => `${asset.kind}:${asset.record.id}`;
  const currentKeys = new Set(snapshot?.assets.map(assetKey));
  const assets = snapshot
    ? [...snapshot.assets, ...opened.filter((asset) => !currentKeys.has(assetKey(asset)))]
        .map((asset) => ({
          asset,
          available: currentKeys.has(assetKey(asset)),
          matches: sourceReviewMatches(asset, changedText),
        }))
        .sort((left, right) => right.matches.length - left.matches.length)
    : [];
  return (
    <ModalFrame
      title="核对正文与源设定"
      onDismiss={() => void leave()}
      busy={review.saving || leaving}
      maxWidth={960}
      dismissOnBackdrop={false}
    >
      <p>
        依据「{chapter.title}」已采用稿 v{snapshot?.versionNo ?? draft.versionNo}
        。修改过的人物事实、时间、地点和约束，需要同步核对源材料。
      </p>
      {(snapshot || review.error) && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={review.refreshing || review.saving || leaving}
          onClick={review.refresh}
        >
          {snapshot ? '刷新正式版本（保留输入）' : '重新读取'}
        </button>
      )}
      {review.error && <p role="alert">{review.error}</p>}
      {review.refreshing && (
        <p role="status">
          {snapshot ? '正在刷新正式版本，未保存内容保留…' : '正在读取完整采用稿与启用设定…'}
        </p>
      )}
      {snapshot && (
        <>
          {changes ? (
            <details
              className="source-review-excerpts"
              open={Boolean(changes.added.length || changes.removed.length)}
            >
              <summary>
                本次修订片段：删除或改写 {changes.removed.length} 段，新增或改写{' '}
                {changes.added.length} 段
              </summary>
              <div className="source-review-columns">
                <div>
                  <strong>原候选</strong>
                  <pre>{changes.removed.join('\n\n') || '无删除段落'}</pre>
                </div>
                <div>
                  <strong>采用正文</strong>
                  <pre>{changes.added.join('\n\n') || '无新增段落'}</pre>
                </div>
              </div>
            </details>
          ) : (
            <details className="source-review-excerpts">
              <summary>查看本章完整采用正文</summary>
              <pre>{snapshot.content}</pre>
            </details>
          )}
          <p className="text-sm text-muted">
            下列是全部启用背景和规则。相同文字仅帮助定位，是否矛盾由你结合上下文判断。保存前仍需预览影响并确认。
          </p>
          {review.savedTitles.length > 0 && (
            <p role="status">
              已保存源设定：{review.savedTitles.join('、')}。请同时复核受影响章节；原正文保留。
            </p>
          )}
          <div className="source-review-assets">
            {assets.map(({ asset, available, matches }) => {
              const key = assetKey(asset);
              return (
                <section key={key} className="source-review-asset">
                  <div className="source-review-heading">
                    <strong>
                      {asset.kind === 'world_setting' ? '背景' : '规则'} · {asset.record.title}
                    </strong>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setSelected(key);
                        setOpened((items) =>
                          items.some((item) => assetKey(item) === key) ? items : [...items, asset],
                        );
                      }}
                    >
                      核对并编辑
                    </button>
                  </div>
                  {matches.length > 0 && (
                    <p className="text-sm text-muted">修订片段涉及：{matches.join('、')}</p>
                  )}
                  {!available && (
                    <p role="alert">此设定已停用或移除。本地输入保留，当前不能保存。</p>
                  )}
                  <details>
                    <summary>查看当前完整设定</summary>
                    <pre>{asset.record.content}</pre>
                    {'forbiddenRules' in asset.record && asset.record.forbiddenRules && (
                      <>
                        <strong>禁止项</strong>
                        <pre>{asset.record.forbiddenRules}</pre>
                      </>
                    )}
                  </details>
                  {opened.some((item) => assetKey(item) === key) && (
                    <SettingEditForm
                      source={asset.record}
                      world={asset.kind === 'world_setting'}
                      hidden={selected !== key}
                      disabled={review.refreshing || Boolean(review.error) || !available}
                      reviewRevision={review.revision}
                      onDirtyChange={(dirty) =>
                        setDirtyKeys((keys) =>
                          dirty === keys.includes(key)
                            ? keys
                            : dirty
                              ? [...keys, key]
                              : keys.filter((item) => item !== key),
                        )
                      }
                      onClose={() => setSelected('')}
                      onPreview={review.preview}
                      onSave={(input) => review.save(asset, input)}
                    />
                  )}
                </section>
              );
            })}
            {!assets.length && <p>本作品尚无启用的背景和规则。</p>}
          </div>
          <p>继续核对人物与大纲，并复核采用后生成的章节总结；各项修改仍需分别保存。</p>
          <div className="detail-form-actions">
            {[
              ['character', '核对人物档案'],
              ['protagonist', '核对主角设定'],
              ['chapter_outline', '核对本章与后章大纲'],
            ].map(([focus, label]) => (
              <button
                key={focus}
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={review.saving || leaving}
                onClick={() =>
                  void leave(
                    focus === 'chapter_outline'
                      ? `/novels/${chapter.novelId}/outline?type=chapter&chapterId=${chapter.id}`
                      : `/novels/${chapter.novelId}?focus=${focus}`,
                  )
                }
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </ModalFrame>
  );
}

export function ChapterSourceReview({
  chapter,
  draft,
  original,
  disabled,
}: {
  chapter: Chapter;
  draft: ChapterDraft;
  original?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!draft.isAdopted || draft.chapterId !== chapter.id || draft.novelId !== chapter.novelId)
    return null;
  return (
    <div className="editor-source-review">
      <span>若修正了事实或约束，请同步核对背景、规则和人物。</span>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        data-testid="chapter-source-review"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        核对源设定
      </button>
      {open && (
        <SourceReviewDialog
          key={JSON.stringify([chapter.novelId, chapter.id, draft.id])}
          chapter={chapter}
          draft={draft}
          original={original}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
