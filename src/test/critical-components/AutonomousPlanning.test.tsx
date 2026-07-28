import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AutonomousApplyBar from '../../pages/AutonomousPlanning/AutonomousApplyBar';
import AutonomousBriefPanel from '../../pages/AutonomousPlanning/AutonomousBriefPanel';
import AutonomousExecutionPanel from '../../pages/AutonomousPlanning/AutonomousExecutionPanel';
import AutonomousPlanContent from '../../pages/AutonomousPlanning/AutonomousPlanContent';
import AutonomousPlanProgress from '../../pages/AutonomousPlanning/AutonomousPlanProgress';
import AutonomousSchedulerControls from '../../pages/AutonomousPlanning/AutonomousSchedulerControls';
import type {
  AutonomousChapterRun,
  AutonomousStoryBrief,
  AutonomousStoryPlan,
} from '../../types/autonomousCreation';
import type {
  AutonomousAutomationPolicy,
  AutonomousBookRun,
  AutonomousSchedulerSnapshot,
} from '../../types/autonomousScheduler';

const timestamp = '2026-07-28T00:00:00.000Z';

const brief: AutonomousStoryBrief = {
  premise: '一名档案员发现城市每天都会遗忘一条街道，并决定追查消失的真相。',
  genre: '悬疑',
  targetChapterCount: 12,
  targetWordsPerChapter: 2_400,
  readerPromise: '线索持续累积',
  endingPreference: '回答核心谜题',
  constraints: ['胜利必须付出代价'],
};

function plan(overrides: Partial<AutonomousStoryPlan> = {}): AutonomousStoryPlan {
  const value: AutonomousStoryPlan = {
    schemaVersion: 1,
    planId: 'plan-1',
    operationId: 'operation-1',
    requestHash: 'request-hash',
    novelId: 'novel-1',
    status: 'ready',
    stage: 'ready',
    revision: 4,
    brief,
    storyBible: {
      title: '遗忘之城',
      logline: '档案员追查消失街道。',
      themes: ['记忆', '代价'],
      protagonistPromise: '从旁观者成为守护者',
      centralQuestion: '谁在改写城市？',
      endingVision: '真相公开',
      narrativeRules: ['线索先出现后解释'],
    },
    arcs: [
      {
        id: 'arc-1',
        index: 1,
        title: '失踪街道',
        chapterStart: 1,
        chapterEnd: 12,
        goal: '找到入口',
        turningPoint: '同伴背叛',
        climax: '档案库对峙',
        outcome: '保存城市记忆',
      },
    ],
    volumes: [
      {
        id: 'volume-1',
        index: 1,
        title: '第一卷',
        chapterStart: 1,
        chapterEnd: 12,
        summary: '调查开始',
        goal: '确认异常',
        mainConflict: '记忆与秩序',
        arcIds: ['arc-1'],
      },
    ],
    characters: [
      {
        id: 'character-1',
        name: '林岚',
        role: 'protagonist',
        identity: '档案员',
        personality: '谨慎',
        coreNeed: '守住记忆',
        flaw: '不信任他人',
        initialState: '旁观',
        desiredEndState: '承担责任',
        behaviorLimits: ['不伤害无辜'],
        forbiddenBehaviors: ['无依据相信敌人'],
        beats: [
          {
            id: 'beat-1',
            characterId: 'character-1',
            chapterNumber: 1,
            stage: '触发',
            change: '开始调查',
          },
        ],
      },
    ],
    worldElements: [
      {
        id: 'world-1',
        type: 'location',
        name: '旧档案库',
        summary: '保存被遗忘的地图',
        firstChapter: 1,
        dependencies: [],
        constraints: ['午夜关闭'],
      },
    ],
    conflicts: [
      {
        id: 'conflict-1',
        title: '城市记忆',
        type: 'mystery',
        participants: ['character-1'],
        stakes: '整座城市失忆',
        summary: '找出记忆被修改的原因',
        introducedChapter: 1,
        escalationChapters: [4, 8],
        climaxChapter: 11,
        resolutionChapter: 12,
      },
    ],
    pacingPhases: [
      {
        id: 'phase-1',
        title: '调查',
        chapterStart: 1,
        chapterEnd: 12,
        mode: 'build',
        tensionStart: 20,
        tensionEnd: 70,
        purpose: '累积线索',
      },
    ],
    pacingCurve: [],
    chapters: [
      {
        id: 'chapter-1',
        chapterNumber: 1,
        volumeId: 'volume-1',
        arcId: 'arc-1',
        title: '空白地图',
        outline: '主角发现街道从地图消失。',
        goal: '确认异常',
        targetWordCount: 2_400,
        pacingMode: 'build',
        tension: 55,
        endingHook: '档案里出现自己的签名',
        conflictThreadIds: ['conflict-1'],
        characterIds: ['character-1'],
        characterBeatIds: ['beat-1'],
        worldElementIds: ['world-1'],
        status: 'materialized',
      },
    ],
    agentRuns: [
      ...(['succeeded', 'running', 'failed', 'cancelled', 'pending'] as const).map(
        (status, index) => ({
          agent: (
            [
              'plot_planner',
              'character_evolution',
              'world_builder',
              'conflict_generator',
              'pacing_controller',
            ] as const
          )[index],
          status,
          aiTaskIds: [],
          tokensInput: 1,
          tokensOutput: 1,
          tokensUsed: 2,
          durationMs: 10,
          updatedAt: timestamp,
        }),
      ),
    ],
    chapterRuns: [],
    progress: {
      completedVolumeIds: [],
      currentVolumeIndex: 0,
      adoptedChapterNumbers: [],
      lastCheckpoint: '规划完成',
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { ...value, ...overrides };
}

function policy(overrides: Partial<AutonomousAutomationPolicy> = {}): AutonomousAutomationPolicy {
  return {
    schemaVersion: 1,
    mode: 'draft_night',
    maxChapters: 1,
    maxConsecutiveFailures: 3,
    maxRetriesPerChapter: 2,
    minimumSuccessfulExperts: 4,
    minimumAverageScore: 80,
    minimumAcceptanceRate: 0.75,
    autoConfirmAnalysis: false,
    dailyTokenBudget: 500_000,
    bookTokenBudget: 500_000,
    dailyCostBudgetUsd: 25,
    bookCostBudgetUsd: 25,
    ...overrides,
  };
}

function bookRun(
  status: AutonomousBookRun['status'],
  overrides: Partial<AutonomousBookRun> = {},
): AutonomousBookRun {
  return {
    runId: 'run-1',
    operationId: 'run-operation-1',
    requestHash: 'run-request-hash',
    novelId: 'novel-1',
    planId: 'plan-1',
    mode: 'draft_night',
    policy: policy(),
    policyHash: 'policy-hash',
    status,
    stateRevision: 1,
    nextChapterNumber: 1,
    totalChapters: 1,
    completedChapters: 0,
    tokenInput: 10,
    tokenOutput: 20,
    costUsd: 0.1,
    usageDay: '2026-07-28',
    dailyTokenInput: 10,
    dailyTokenOutput: 20,
    dailyCostUsd: 0.1,
    consecutiveFailures: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function scheduler(
  run: AutonomousBookRun | null = null,
  overrides: Partial<AutonomousSchedulerSnapshot> = {},
): AutonomousSchedulerSnapshot {
  return {
    capability: { persistent: true, runtime: 'tauri' },
    run,
    attempts: [],
    workerActive: false,
    busy: false,
    ...overrides,
  };
}

describe('Autonomous planning presentation', () => {
  it('edits the brief, selects history, resumes and cancels a running plan', () => {
    const onBriefChange = vi.fn();
    const onCancel = vi.fn();
    const onRun = vi.fn();
    const onResume = vi.fn();
    const onSelectPlan = vi.fn();
    const activePlan = plan({ status: 'failed' });
    const props = {
      brief,
      running: false,
      plans: [activePlan, plan({ planId: 'plan-2', status: 'applied' })],
      activePlan,
      onBriefChange,
      onCancel,
      onRun,
      onResume,
      onSelectPlan,
    };
    const view = render(<AutonomousBriefPanel {...props} />);

    const fields = screen
      .getByRole('complementary', { name: '小说创意输入' })
      .querySelectorAll('input, textarea');
    ['新核心创意', '科幻', '24', '3200', '新承诺', '新结局', '边界一\n\n边界二'].forEach(
      (value, index) => fireEvent.change(fields[index], { target: { value } }),
    );
    expect(onBriefChange).toHaveBeenCalledTimes(7);
    fireEvent.click(screen.getByRole('button', { name: '生成新计划' }));
    fireEvent.click(screen.getByRole('button', { name: '继续此计划' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'plan-2' } });
    expect(onRun).toHaveBeenCalledOnce();
    expect(onResume).toHaveBeenCalledWith(activePlan);
    expect(onSelectPlan).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan-2' }));

    view.rerender(<AutonomousBriefPanel {...props} running />);
    fireEvent.click(screen.getByRole('button', { name: '取消生成' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('renders every plan tab, every agent state and both apply states', () => {
    const value = plan();
    const onTabChange = vi.fn();
    const tabs = [
      'overview',
      'volumes',
      'characters',
      'world',
      'conflicts',
      'pacing',
      'chapters',
    ] as const;
    const view = render(
      <AutonomousPlanContent plan={value} tab="overview" onTabChange={onTabChange} />,
    );
    for (const tab of tabs) {
      view.rerender(<AutonomousPlanContent plan={value} tab={tab} onTabChange={onTabChange} />);
    }
    fireEvent.click(screen.getByRole('button', { name: '章节' }));
    expect(onTabChange).toHaveBeenCalledWith('chapters');
    view.rerender(
      <AutonomousPlanContent
        plan={plan({ storyBible: undefined })}
        tab="overview"
        onTabChange={onTabChange}
      />,
    );
    expect(screen.queryByRole('navigation', { name: '计划视图' })).toBeNull();

    view.rerender(<AutonomousPlanProgress plan={value} percent={73} />);
    expect(screen.getByRole('region', { name: '自主创作进度' }).textContent).toContain('已取消');

    const onApply = vi.fn();
    view.rerender(<AutonomousApplyBar applying={false} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: '确认应用全书计划' }));
    expect(onApply).toHaveBeenCalledOnce();
    view.rerender(<AutonomousApplyBar applying onApply={onApply} />);
    expect(
      (screen.getByRole('button', { name: '正在应用...' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('Autonomous scheduler controls', () => {
  it('edits every policy field, time window and starts the frozen policy', () => {
    const onStart = vi.fn();
    const view = render(
      <AutonomousSchedulerControls
        plan={plan()}
        scheduler={scheduler()}
        onStart={onStart}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /全自动/ }));
    const numberInputs = screen.getAllByRole('spinbutton');
    ['9', '4', '3', '5', '85', '90', '', '900000', '12.5', '40'].forEach((value, index) => {
      fireEvent.change(numberInputs[index], { target: { value } });
    });
    fireEvent.click(screen.getByRole('checkbox'));
    const timeInputs = view.container.querySelectorAll<HTMLInputElement>('input[type="time"]');
    fireEvent.change(timeInputs[0], { target: { value: '23:15' } });
    fireEvent.change(timeInputs[1], { target: { value: '06:45' } });
    fireEvent.click(screen.getByRole('button', { name: '启动无人值守任务' }));
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'full_auto',
        maxChapters: 1,
        autoConfirmAnalysis: true,
        runWindow: expect.objectContaining({ startMinute: 1395, endMinute: 405 }),
      }),
    );
  });

  it('hydrates an existing window and exposes pause, resume, stop, error and browser states', () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const onStop = vi.fn();
    const running = bookRun('running', {
      pauseReason: '等待预算',
      policy: policy({ runWindow: { startMinute: 30, endMinute: 90, utcOffsetMinutes: 480 } }),
    });
    const props = {
      plan: plan(),
      scheduler: scheduler(running, { error: '调度错误' }),
      onStart: vi.fn(),
      onPause,
      onResume,
      onStop,
    };
    const view = render(<AutonomousSchedulerControls {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '暂停任务' }));
    fireEvent.click(screen.getByRole('button', { name: '停止任务' }));
    expect(onPause).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();

    view.rerender(
      <AutonomousSchedulerControls {...props} scheduler={scheduler(bookRun('paused'))} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '继续任务' }));
    expect(onResume).toHaveBeenCalledOnce();

    view.rerender(
      <AutonomousSchedulerControls
        {...props}
        scheduler={{
          ...scheduler(),
          capability: { persistent: false, runtime: 'browser', reason: '仅桌面可用' },
        }}
      />,
    );
    expect(screen.getByRole('note').textContent).toContain('仅桌面可用');
  });
});

describe('Autonomous execution panel', () => {
  const callbacks = () => ({
    onGenerateCandidate: vi.fn(),
    onGenerateBookCandidates: vi.fn(),
    onPauseBookCandidates: vi.fn(),
    onOpenCandidate: vi.fn(),
    onRetryAnalysis: vi.fn(),
    onStopAnalysis: vi.fn(),
    onConfirmAnalysis: vi.fn(),
    onViewWorldSuggestions: vi.fn(),
  });

  function chapterRun(
    status: AutonomousChapterRun['status'],
    overrides: Partial<AutonomousChapterRun> = {},
  ): AutonomousChapterRun {
    return {
      runId: `chapter-run-${status}`,
      operationId: `chapter-operation-${status}`,
      chapterId: 'chapter-1',
      chapterNumber: 1,
      status,
      plannedCharacterBeatIds: [],
      confirmedCharacterBeatIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
  }

  it('generates, pauses a book queue and opens an accepted candidate', () => {
    const calls = callbacks();
    const view = render(
      <AutonomousExecutionPanel
        plan={plan()}
        chapterRunning={false}
        bookRunning={false}
        analysisSaving={false}
        {...calls}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '生成下一章候选' }));
    fireEvent.click(screen.getByRole('button', { name: '生成全书候选草稿' }));
    expect(calls.onGenerateCandidate).toHaveBeenCalledOnce();
    expect(calls.onGenerateBookCandidates).toHaveBeenCalledOnce();

    view.rerender(
      <AutonomousExecutionPanel
        plan={plan()}
        chapterRunning={false}
        bookRunning
        analysisSaving={false}
        {...calls}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '暂停全书生成' }));

    const candidate = chapterRun('candidate_ready', {
      candidateDraftId: 'draft-2',
      reviewAccepted: true,
      acceptanceRate: 0.9,
      averageScore: 88,
    });
    view.rerender(
      <AutonomousExecutionPanel
        plan={plan({ chapterRuns: [candidate] })}
        chapterRunning={false}
        bookRunning={false}
        analysisSaving={false}
        {...calls}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '在工作台审阅候选' }));
    expect(calls.onOpenCandidate).toHaveBeenCalledWith('chapter-1', 'draft-2');
  });

  it('handles running, retryable and confirmable analysis states and completion', () => {
    const calls = callbacks();
    const runningAnalysis = chapterRun('adopted', {
      analysis: {
        status: 'running',
        adoptedDraftId: 'draft-2',
        worldSuggestionIds: [],
        updatedAt: timestamp,
      },
    });
    const view = render(
      <AutonomousExecutionPanel
        plan={plan({ chapterRuns: [runningAnalysis] })}
        chapterRunning
        bookRunning={false}
        analysisSaving={false}
        {...calls}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '停止分析' }));
    expect(calls.onStopAnalysis).toHaveBeenCalledOnce();

    const failed = chapterRun('failed', {
      analysis: {
        status: 'failed',
        adoptedDraftId: 'draft-2',
        errorMessage: '分析失败',
        worldSuggestionIds: ['world-1'],
        updatedAt: timestamp,
      },
    });
    view.rerender(
      <AutonomousExecutionPanel
        plan={plan({ chapterRuns: [failed] })}
        chapterRunning={false}
        bookRunning={false}
        analysisSaving={false}
        {...calls}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '重试本章候选' }));
    fireEvent.click(screen.getByRole('button', { name: '重试分析' }));
    fireEvent.click(screen.getByRole('button', { name: '查看世界候选' }));
    expect(calls.onRetryAnalysis).toHaveBeenCalledWith(failed);

    const pending = chapterRun('adopted', {
      analysis: {
        status: 'pending_confirmation',
        adoptedDraftId: 'draft-2',
        worldSuggestionIds: ['world-1'],
        updatedAt: timestamp,
        result: {
          summary: '章节收束完成',
          keyEvents: [],
          characterChanges: [],
          relationshipChanges: [],
          newForeshadows: [],
          resolvedForeshadows: [],
          nextChapterHints: '',
          newLocations: ['旧档案库'],
          contextRecords: [],
        },
      },
    });
    view.rerender(
      <AutonomousExecutionPanel
        plan={plan({ chapterRuns: [pending] })}
        chapterRunning={false}
        bookRunning={false}
        analysisSaving={false}
        {...calls}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '确认沉淀章节分析' }));
    expect(calls.onConfirmAnalysis).toHaveBeenCalledWith(pending);

    view.rerender(
      <AutonomousExecutionPanel
        plan={plan({
          chapters: [{ ...plan().chapters[0], status: 'adopted' }],
          progress: { ...plan().progress, adoptedChapterNumbers: [1] },
        })}
        chapterRunning={false}
        bookRunning={false}
        analysisSaving={false}
        scheduler={scheduler()}
        onStartScheduler={vi.fn()}
        onPauseScheduler={vi.fn()}
        onResumeScheduler={vi.fn()}
        onStopScheduler={vi.fn()}
        {...calls}
      />,
    );
    expect(screen.getByText('全书章节均已采用')).not.toBeNull();
  });
});
