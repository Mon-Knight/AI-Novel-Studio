import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CoCreationDraftPanel from '../../components/co-creation/CoCreationDraftPanel';
import type { CoCreationApplyPreparationV1 } from '../../types/coCreationApply';

const payload = {
  fields: {
    'worldSetting.era': { value: '蒸汽纪元', state: 'user_confirmed' },
  },
  suggestions: [{
    suggestionId: 'suggestion-a',
    target: { objectType: 'world_setting', fieldPath: 'worldSetting.era' },
    originalValue: null,
    suggestedValue: '蒸汽纪元',
    fieldState: 'ai_suggested',
    sourceType: 'ai_inference',
    sourceReferences: [],
    confidence: 0.8,
    conflicts: [],
    baseDataRevision: 1,
    decision: 'accepted_to_draft',
    candidateHash: 'candidate-hash',
    sourceArtifactId: 'artifact-a',
  }],
};

function props() {
  return {
    payload,
    onEditField: vi.fn(),
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onAcceptAll: vi.fn(),
    onPrepareApply: vi.fn(),
    onConfirmApply: vi.fn(),
    onCancelApply: vi.fn(),
    onPrepareUndo: vi.fn(),
  };
}

describe('co-creation formal apply review', () => {
  it('requires preparation before exposing the final ApplyPlan confirmation', () => {
    const input = props();
    render(<CoCreationDraftPanel {...input} />);
    expect(screen.queryByRole('button', { name: '确认执行 ApplyPlan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '准备正式写入' }));
    expect(input.onPrepareApply).toHaveBeenCalledWith(['suggestion-a']);
  });

  it('shows exact targets and impact warnings before execution', () => {
    const input = props();
    const preparation = {
      proposal: { proposalId: 'proposal-a' },
      plan: { planId: 'plan-a', status: 'ready' },
      affectedTargets: [{
        targetType: 'world_setting', targetId: 'world-a', action: 'create_world_setting',
        fieldPaths: ['worldSetting.era'],
      }],
      impactWarnings: ['世界规则变化可能影响后续章节'],
    } as CoCreationApplyPreparationV1;
    render(<CoCreationDraftPanel {...input} applyPreparation={preparation} />);
    expect(screen.getByText('world_setting · create_world_setting')).not.toBeNull();
    expect(screen.getByText('世界规则变化可能影响后续章节')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '确认执行 ApplyPlan' }));
    expect(input.onConfirmApply).toHaveBeenCalledTimes(1);
  });

  it('defaults formal selection to the latest Artifact and never mixes turns', () => {
    const input = props();
    const multiArtifactPayload = {
      fields: {
        'worldSetting.era': { value: '蒸汽纪元', state: 'user_confirmed' },
        'worldSetting.society': { value: '浮空城邦', state: 'user_confirmed' },
      },
      suggestions: [
        { ...payload.suggestions[0], suggestionId: 'suggestion-old', sourceArtifactId: 'artifact-old' },
        {
          ...payload.suggestions[0],
          suggestionId: 'suggestion-new',
          sourceArtifactId: 'artifact-new',
          target: { objectType: 'world_setting', fieldPath: 'worldSetting.society' },
        },
      ],
    };
    render(<CoCreationDraftPanel {...input} payload={multiArtifactPayload} />);

    fireEvent.click(screen.getByRole('button', { name: '准备正式写入' }));
    expect(input.onPrepareApply).toHaveBeenLastCalledWith(['suggestion-new']);

    fireEvent.change(screen.getByRole('combobox', { name: '待写入 AI 轮次' }), {
      target: { value: 'artifact-old' },
    });
    fireEvent.click(screen.getByRole('button', { name: '准备正式写入' }));
    expect(input.onPrepareApply).toHaveBeenLastCalledWith(['suggestion-old']);
  });
});
