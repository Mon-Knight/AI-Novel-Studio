import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type {
  ChapterOutlineCandidate,
  VolumeOutlineCandidate,
} from '../../services/ai/outlineGenerateService';

interface OutlineCandidateResultsProps {
  volumeCandidate: VolumeOutlineCandidate | null;
  setVolumeCandidate: Dispatch<SetStateAction<VolumeOutlineCandidate | null>>;
  chapterCandidates: ChapterOutlineCandidate[];
  setChapterCandidates: Dispatch<SetStateAction<ChapterOutlineCandidate[]>>;
  targetVolumeId?: string;
  onSaveVolumeCandidate: () => Promise<void>;
  onSaveChapterCandidate: (candidate: ChapterOutlineCandidate) => Promise<void>;
}

export function OutlineCandidateResults({
  volumeCandidate,
  setVolumeCandidate,
  chapterCandidates,
  setChapterCandidates,
  targetVolumeId,
  onSaveVolumeCandidate,
  onSaveChapterCandidate,
}: OutlineCandidateResultsProps) {
  const candidateAnchorRef = useRef<HTMLDivElement>(null);
  const hasGeneratedCandidate = volumeCandidate !== null || chapterCandidates.length > 0;

  useEffect(() => {
    if (!hasGeneratedCandidate) return;
    const frame = requestAnimationFrame(() => {
      candidateAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [hasGeneratedCandidate]);

  return (
    <>
      <div ref={candidateAnchorRef} />

      {volumeCandidate && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            border: '1px solid var(--color-border-light)',
            borderRadius: 6,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>分卷大纲候选</div>
          <input
            className="form-input"
            value={volumeCandidate.title}
            onChange={(event) =>
              setVolumeCandidate({ ...volumeCandidate, title: event.target.value })
            }
            placeholder="分卷标题"
            style={{ width: '100%', marginBottom: 6, fontSize: 13 }}
          />
          <textarea
            className="form-textarea"
            value={volumeCandidate.summary}
            onChange={(event) =>
              setVolumeCandidate({ ...volumeCandidate, summary: event.target.value })
            }
            placeholder="分卷摘要..."
            style={{
              width: '100%',
              height: 120,
              resize: 'vertical',
              fontSize: 13,
              lineHeight: 1.7,
            }}
          />
          {volumeCandidate.goal !== undefined && (
            <input
              className="form-input"
              value={volumeCandidate.goal || ''}
              onChange={(event) =>
                setVolumeCandidate({ ...volumeCandidate, goal: event.target.value })
              }
              placeholder="分卷目标"
              style={{ width: '100%', marginTop: 6, fontSize: 13 }}
            />
          )}
          {volumeCandidate.mainConflict !== undefined && (
            <input
              className="form-input"
              value={volumeCandidate.mainConflict || ''}
              onChange={(event) =>
                setVolumeCandidate({ ...volumeCandidate, mainConflict: event.target.value })
              }
              placeholder="主要冲突"
              style={{ width: '100%', marginTop: 6, fontSize: 13 }}
            />
          )}
          <button
            className="btn btn-primary btn-sm"
            onClick={onSaveVolumeCandidate}
            style={{ marginTop: 8 }}
          >
            {targetVolumeId ? '确认更新分卷' : '确认创建分卷'}
          </button>
        </div>
      )}

      {chapterCandidates.length > 0 && (
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          {chapterCandidates.map((candidate, index) => (
            <div
              key={`${candidate.title}-${index}`}
              style={{
                padding: 10,
                border: '1px solid var(--color-border-light)',
                borderRadius: 6,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>章节候选 #{index + 1}</div>
              <input
                className="form-input"
                value={candidate.title}
                onChange={(event) => {
                  const updated = [...chapterCandidates];
                  updated[index] = { ...candidate, title: event.target.value };
                  setChapterCandidates(updated);
                }}
                placeholder="章节标题"
                style={{ width: '100%', marginBottom: 6, fontSize: 13 }}
              />
              <textarea
                className="form-textarea"
                value={candidate.rawText || candidate.outline}
                onChange={(event) => {
                  const updated = [...chapterCandidates];
                  if (candidate.rawText) {
                    updated[index] = { ...candidate, rawText: event.target.value };
                  } else {
                    updated[index] = { ...candidate, outline: event.target.value };
                  }
                  setChapterCandidates(updated);
                }}
                placeholder="章节大纲..."
                style={{
                  width: '100%',
                  height: 100,
                  resize: 'vertical',
                  fontSize: 13,
                  lineHeight: 1.7,
                }}
              />
              {candidate.goal !== undefined && (
                <input
                  className="form-input"
                  value={candidate.goal || ''}
                  onChange={(event) => {
                    const updated = [...chapterCandidates];
                    updated[index] = { ...candidate, goal: event.target.value };
                    setChapterCandidates(updated);
                  }}
                  placeholder="章节目标"
                  style={{ width: '100%', marginTop: 6, fontSize: 13 }}
                />
              )}
              {candidate.targetWordCount !== undefined && (
                <input
                  className="form-input"
                  type="number"
                  value={candidate.targetWordCount || 2500}
                  onChange={(event) => {
                    const updated = [...chapterCandidates];
                    updated[index] = {
                      ...candidate,
                      targetWordCount: Number(event.target.value),
                    };
                    setChapterCandidates(updated);
                  }}
                  placeholder="建议字数"
                  style={{ width: '100%', marginTop: 6, fontSize: 13 }}
                />
              )}
              <button
                className="btn btn-primary btn-sm"
                onClick={() => onSaveChapterCandidate(candidate)}
                style={{ marginTop: 8 }}
              >
                确认保存为章节
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
