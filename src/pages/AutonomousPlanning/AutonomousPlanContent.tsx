import { useMemo } from 'react';
import type { AutonomousStoryPlan } from '../../types/autonomousCreation';
import { TABS, type PlanTab } from './autonomousPlanningPresentation';

interface AutonomousPlanContentProps {
  plan: AutonomousStoryPlan;
  tab: PlanTab;
  onTabChange(tab: PlanTab): void;
}

export default function AutonomousPlanContent({
  plan,
  tab,
  onTabChange,
}: AutonomousPlanContentProps) {
  const volumeById = useMemo(
    () => new Map(plan.volumes.map((item) => [item.id, item])),
    [plan.volumes],
  );
  if (!plan.storyBible) return null;

  return (
    <>
      <nav className="autonomous-tabs" aria-label="计划视图">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? 'active' : ''}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <section className="autonomous-plan-content">
        {tab === 'overview' && (
          <div className="autonomous-overview">
            <div className="autonomous-bible">
              <h2>{plan.storyBible.title}</h2>
              <p>{plan.storyBible.logline}</p>
              <dl>
                <div>
                  <dt>核心问题</dt>
                  <dd>{plan.storyBible.centralQuestion}</dd>
                </div>
                <div>
                  <dt>人物承诺</dt>
                  <dd>{plan.storyBible.protagonistPromise}</dd>
                </div>
                <div>
                  <dt>结局愿景</dt>
                  <dd>{plan.storyBible.endingVision}</dd>
                </div>
              </dl>
            </div>
            <div className="autonomous-metrics">
              <div>
                <strong>{plan.arcs.length}</strong>
                <span>故事弧</span>
              </div>
              <div>
                <strong>{plan.volumes.length}</strong>
                <span>分卷</span>
              </div>
              <div>
                <strong>{plan.chapters.length}</strong>
                <span>章节</span>
              </div>
              <div>
                <strong>{plan.characters.length}</strong>
                <span>角色</span>
              </div>
              <div>
                <strong>{plan.worldElements.length}</strong>
                <span>世界元素</span>
              </div>
              <div>
                <strong>{plan.conflicts.length}</strong>
                <span>冲突线程</span>
              </div>
            </div>
            <div className="autonomous-arc-list">
              {plan.arcs.map((arc) => (
                <article key={arc.id}>
                  <div>
                    <strong>{arc.title}</strong>
                    <span>
                      第 {arc.chapterStart}-{arc.chapterEnd} 章
                    </span>
                  </div>
                  <p>{arc.goal}</p>
                  <small>{arc.turningPoint}</small>
                </article>
              ))}
            </div>
          </div>
        )}

        {tab === 'volumes' && (
          <div className="autonomous-list">
            {plan.volumes.map((volume) => (
              <article key={volume.id}>
                <header>
                  <strong>{volume.title}</strong>
                  <span>
                    第 {volume.chapterStart}-{volume.chapterEnd} 章
                  </span>
                </header>
                <p>{volume.summary}</p>
                <small>
                  目标：{volume.goal} · 冲突：{volume.mainConflict}
                </small>
              </article>
            ))}
          </div>
        )}

        {tab === 'characters' && (
          <div className="autonomous-list">
            {plan.characters.map((character) => (
              <article key={character.id}>
                <header>
                  <strong>{character.name}</strong>
                  <span>{character.identity}</span>
                </header>
                <p>
                  {character.initialState} → {character.desiredEndState}
                </p>
                <div className="autonomous-beats">
                  {character.beats.map((beat) => (
                    <span key={beat.id}>
                      第 {beat.chapterNumber} 章 · {beat.stage}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}

        {tab === 'world' && (
          <div className="autonomous-list compact">
            {plan.worldElements.map((element) => (
              <article key={element.id}>
                <header>
                  <strong>{element.name}</strong>
                  <span>
                    第 {element.firstChapter} 章引入 · {element.type}
                  </span>
                </header>
                <p>{element.summary}</p>
                <small>{element.constraints.join('；')}</small>
              </article>
            ))}
          </div>
        )}

        {tab === 'conflicts' && (
          <div className="autonomous-list">
            {plan.conflicts.map((conflict) => (
              <article key={conflict.id}>
                <header>
                  <strong>{conflict.title}</strong>
                  <span>
                    第 {conflict.introducedChapter}-{conflict.resolutionChapter} 章
                  </span>
                </header>
                <p>{conflict.summary}</p>
                <small>
                  高潮：第 {conflict.climaxChapter} 章 · 代价：{conflict.stakes}
                </small>
              </article>
            ))}
          </div>
        )}

        {tab === 'pacing' && (
          <div className="autonomous-pacing-list">
            {plan.pacingPhases.map((phase) => (
              <article key={phase.id}>
                <header>
                  <strong>{phase.title}</strong>
                  <span>
                    {phase.mode} · 第 {phase.chapterStart}-{phase.chapterEnd} 章
                  </span>
                </header>
                <div className="autonomous-tension">
                  <span style={{ width: `${Math.max(4, phase.tensionEnd)}%` }} />
                </div>
                <p>{phase.purpose}</p>
              </article>
            ))}
          </div>
        )}

        {tab === 'chapters' && (
          <div className="autonomous-chapter-list">
            {plan.chapters.map((chapter) => (
              <article key={chapter.id}>
                <div className="autonomous-chapter-number">{chapter.chapterNumber}</div>
                <div>
                  <header>
                    <strong>{chapter.title}</strong>
                    <span>{volumeById.get(chapter.volumeId)?.title}</span>
                  </header>
                  <p>{chapter.outline}</p>
                  <small>
                    {chapter.pacingMode} · 张力 {chapter.tension} · {chapter.endingHook}
                  </small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
