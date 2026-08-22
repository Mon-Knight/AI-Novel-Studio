import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALLOWED_JOB_TRANSITIONS,
  TERMINAL_JOB_STATUSES,
  normalizeJobStatus,
  normalizeStepName,
  normalizeStepStatus,
} from './types';
import { normalizeJob, normalizeStep } from './jobStateMachine';

test('normalizeJobStatus safely handles unknown statuses', () => {
  assert.equal(normalizeJobStatus('running'), 'running');
  assert.equal(normalizeJobStatus('completed'), 'completed');
  assert.equal(normalizeJobStatus('failed'), 'failed');
  assert.equal(normalizeJobStatus('cancelled'), 'cancelled');
  assert.equal(normalizeJobStatus('unknown_status'), 'pending');
  assert.equal(normalizeJobStatus(null), 'pending');
});

test('normalizeStepName validates and recognizes step names', () => {
  assert.equal(normalizeStepName('compile_context'), 'compile_context');
  assert.equal(normalizeStepName('draft_generation'), 'draft_generation');
  assert.equal(normalizeStepName('quality_check'), 'quality_check');
  assert.equal(normalizeStepName('invalid_step'), undefined);
});

test('normalizeStepStatus validates step statuses', () => {
  assert.equal(normalizeStepStatus('succeeded'), 'succeeded');
  assert.equal(normalizeStepStatus('failed'), 'failed');
  assert.equal(normalizeStepStatus('skipped'), 'skipped');
  assert.equal(normalizeStepStatus('invalid'), 'pending');
});

test('TERMINAL_JOB_STATUSES contains completed, failed, and cancelled', () => {
  assert.equal(TERMINAL_JOB_STATUSES.has('completed'), true);
  assert.equal(TERMINAL_JOB_STATUSES.has('failed'), true);
  assert.equal(TERMINAL_JOB_STATUSES.has('cancelled'), true);
  assert.equal(TERMINAL_JOB_STATUSES.has('running'), false);
  assert.equal(TERMINAL_JOB_STATUSES.has('pending'), false);
});

test('ALLOWED_JOB_TRANSITIONS prevents invalid transitions from terminal states', () => {
  assert.deepEqual([...ALLOWED_JOB_TRANSITIONS.completed], ['completed']);
  assert.deepEqual([...ALLOWED_JOB_TRANSITIONS.failed], ['failed']);
  assert.deepEqual([...ALLOWED_JOB_TRANSITIONS.cancelled], ['cancelled']);
  assert.equal(ALLOWED_JOB_TRANSITIONS.pending.has('running'), true);
  assert.equal(ALLOWED_JOB_TRANSITIONS.running.has('completed'), true);
});

test('normalizeJob parses raw snake_case and camelCase attributes', () => {
  const rawSnake = {
    id: 'job-1',
    novel_id: 'novel-1',
    chapter_id: 'chapter-1',
    job_type: 'chapter_generation',
    status: 'running',
    progress_percent: 50,
    model_name: 'deepseek-chat',
  };

  const job = normalizeJob(rawSnake);
  assert.ok(job);
  assert.equal(job.id, 'job-1');
  assert.equal(job.novelId, 'novel-1');
  assert.equal(job.chapterId, 'chapter-1');
  assert.equal(job.jobType, 'chapter_generation');
  assert.equal(job.status, 'running');
  assert.equal(job.progressPercent, 50);
  assert.equal(job.modelName, 'deepseek-chat');
});

test('normalizeStep parses step fields and json output', () => {
  const raw = {
    id: 'step-1',
    job_id: 'job-1',
    step_name: 'compile_context',
    status: 'succeeded',
    output_json: JSON.stringify({ contextHash: 'hash-123' }),
    output_text: '编译完成',
  };

  const step = normalizeStep(raw);
  assert.ok(step);
  assert.equal(step.id, 'step-1');
  assert.equal(step.jobId, 'job-1');
  assert.equal(step.stepName, 'compile_context');
  assert.equal(step.status, 'succeeded');
  assert.deepEqual(step.outputJson, { contextHash: 'hash-123' });
  assert.equal(step.outputText, '编译完成');
});
