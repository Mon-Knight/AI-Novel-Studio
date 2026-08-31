import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App from '../../App';
import type {
  StartupCoordinator,
  StartupSnapshot,
} from '../../services/startup/startupCoordinator';
import type { LegacyChapterContextMigrationResult } from '../../services/context/legacyChapterContextMigrationService';

vi.mock('../../pages/Workbench/WorkbenchPage', () => ({
  default: function MockWorkbenchPage() {
    return (
      <div data-testid="creative-workbench">
        <textarea data-testid="workbench-composer" aria-label="任务输入" />
      </div>
    );
  },
}));

const EMPTY_CONTEXT_MIGRATION: LegacyChapterContextMigrationResult = {
  performed: false,
  chapterSummaries: { inserted: 0, matched: 0, skipped: 0 },
  contextRecords: { inserted: 0, matched: 0, skipped: 0 },
  characterStates: { inserted: 0, matched: 0, skipped: 0 },
  idMap: {},
  warnings: [],
  localRecordsRemoved: { chapterSummaries: 0, contextRecords: 0, characterStates: 0 },
};

const MIGRATED_CONTEXT: LegacyChapterContextMigrationResult = {
  ...EMPTY_CONTEXT_MIGRATION,
  performed: true,
  chapterSummaries: { inserted: 1, matched: 0, skipped: 0 },
};

const RECOVERED_GENERATION = {
  recoveredJobs: 1,
  recoveredAt: '2026-08-29T00:00:00.000Z',
};

function runningSnapshot(): StartupSnapshot {
  return {
    conversationRecovery: { status: 'running' },
    contextMigration: { status: 'running' },
    generationRecovery: { status: 'running' },
  };
}

function completedSnapshot(): StartupSnapshot {
  return {
    conversationRecovery: { status: 'succeeded', result: { recoveredRuns: 0 } },
    contextMigration: { status: 'succeeded', result: MIGRATED_CONTEXT },
    generationRecovery: { status: 'succeeded', result: RECOVERED_GENERATION },
  };
}

function createFakeCoordinator(initialSnapshot: StartupSnapshot): {
  coordinator: StartupCoordinator;
  emit: (snapshot: StartupSnapshot) => void;
} {
  let snapshot = initialSnapshot;
  const listeners = new Set<() => void>();
  const ready = Promise.resolve();

  return {
    coordinator: {
      isStarted: () => true,
      start: () => ready,
      waitForConversationRecovery: () => ready,
      waitForContextMigration: () => ready,
      waitForGenerationRecovery: () => ready,
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    emit(nextSnapshot) {
      snapshot = nextSnapshot;
      for (const listener of listeners) listener();
    },
  };
}

function renderApp(coordinator: StartupCoordinator, onShellReady = vi.fn()) {
  return {
    onShellReady,
    ...render(
      <StrictMode>
        <MemoryRouter
          initialEntries={['/']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <App startupCoordinator={coordinator} onShellReady={onShellReady} />
        </MemoryRouter>
      </StrictMode>,
    ),
  };
}

function startupModalCount(): number {
  return document.querySelectorAll(
    '[data-testid="conversation-recovery-dialog"], [data-testid="recovery-dialog"], [data-testid="context-migration-dialog"]',
  ).length;
}

describe('App startup dialogs', () => {
  it('mounts the workbench while startup recovery tasks are still running', async () => {
    const fake = createFakeCoordinator(runningSnapshot());
    const { onShellReady } = renderApp(fake.coordinator);

    expect(screen.getByTestId('app-shell')).not.toBeNull();
    expect(await screen.findByTestId('workbench-composer')).not.toBeNull();
    expect(onShellReady).toHaveBeenCalled();
    expect(startupModalCount()).toBe(0);
  });

  it('shows simultaneous notices one at a time with recovery first', async () => {
    const fake = createFakeCoordinator(completedSnapshot());
    renderApp(fake.coordinator);

    expect(await screen.findByTestId('workbench-composer')).not.toBeNull();
    expect(await screen.findByTestId('recovery-dialog')).not.toBeNull();
    expect(screen.queryByTestId('context-migration-dialog')).toBeNull();
    expect(startupModalCount()).toBe(1);

    fireEvent.click(screen.getByTestId('recovery-dismiss'));
    await waitFor(() => {
      expect(screen.queryByTestId('recovery-dialog')).toBeNull();
      expect(screen.queryByTestId('context-migration-dialog')).not.toBeNull();
      expect(startupModalCount()).toBe(1);
    });

    fireEvent.click(screen.getByTestId('context-migration-dismiss'));
    await waitFor(() => expect(startupModalCount()).toBe(0));
  });

  it('does not let a later recovery notice preempt a visible migration notice', async () => {
    const fake = createFakeCoordinator(runningSnapshot());
    renderApp(fake.coordinator);
    expect(await screen.findByTestId('workbench-composer')).not.toBeNull();

    const migrationReady: StartupSnapshot = {
      conversationRecovery: { status: 'running' },
      contextMigration: { status: 'succeeded', result: MIGRATED_CONTEXT },
      generationRecovery: { status: 'running' },
    };
    await act(async () => {
      fake.emit(migrationReady);
      await Promise.resolve();
    });
    expect(screen.queryByTestId('context-migration-dialog')).not.toBeNull();

    await act(async () => {
      fake.emit({
        ...migrationReady,
        generationRecovery: { status: 'succeeded', result: RECOVERED_GENERATION },
      });
      await Promise.resolve();
    });
    expect(screen.queryByTestId('context-migration-dialog')).not.toBeNull();
    expect(screen.queryByTestId('recovery-dialog')).toBeNull();
    expect(startupModalCount()).toBe(1);

    fireEvent.click(screen.getByTestId('context-migration-dismiss'));
    expect(await screen.findByTestId('recovery-dialog')).not.toBeNull();
    expect(startupModalCount()).toBe(1);
  });

  it('does not queue successful startup tasks without a user-facing notice', async () => {
    const fake = createFakeCoordinator({
      conversationRecovery: { status: 'succeeded', result: { recoveredRuns: 0 } },
      contextMigration: { status: 'succeeded', result: EMPTY_CONTEXT_MIGRATION },
      generationRecovery: {
        status: 'succeeded',
        result: { recoveredJobs: 0, recoveredAt: '2026-08-29T00:00:00.000Z' },
      },
    });
    renderApp(fake.coordinator);

    expect(await screen.findByTestId('workbench-composer')).not.toBeNull();
    await act(async () => Promise.resolve());
    expect(startupModalCount()).toBe(0);
  });

  it('shows conversation recovery failures and makes the workbench inert while focused', async () => {
    const fake = createFakeCoordinator(runningSnapshot());
    renderApp(fake.coordinator);
    const composer = await screen.findByTestId('workbench-composer');
    composer.focus();

    await act(async () => {
      fake.emit({
        ...runningSnapshot(),
        conversationRecovery: { status: 'failed', error: 'conversation failed' },
      });
      await Promise.resolve();
    });

    const dialog = await screen.findByTestId('conversation-recovery-dialog');
    const shell = screen.getByTestId('app-shell');
    const dismiss = screen.getByTestId('conversation-recovery-dismiss');
    await waitFor(() => expect(document.activeElement).toBe(dismiss));
    expect(dialog.classList.contains('startup-dialog-overlay')).toBe(true);
    expect(shell.inert).toBe(true);
    expect(shell.getAttribute('aria-hidden')).toBe('true');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('conversation-recovery-dialog')).toBeNull());
    expect(shell.inert).toBe(false);
    expect(shell.hasAttribute('aria-hidden')).toBe(false);
    expect(document.activeElement).toBe(composer);
  });
});
