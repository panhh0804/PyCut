import {describe, expect, it} from 'vitest';
import {PICUT_AGENT_TOOL_NAMES, runPiCutAgent} from './runtime';

describe('π Agent ReAct runtime', () => {
  it('registers the complete eight-tool video workflow contract', () => {
    expect(PICUT_AGENT_TOOL_NAMES).toEqual([
      'create_project',
      'draft_storyboard',
      'apply_spec_patch',
      'validate_spec',
      'search_media',
      'synthesize_narration',
      'render_preview',
      'render_final',
    ]);
  });

  it('executes tool calls, observes results, validates, and returns a revised spec', async () => {
    const previous = process.env.PICUT_AGENT_MODE;
    process.env.PICUT_AGENT_MODE = 'local';
    const projectId = `agent-test-${Date.now()}`;
    try {
      const result = await runPiCutAgent(projectId, '把第 3 幕改成蓝色，并延长到 12 秒');
      expect(result.executionMode).toBe('local');
      expect(result.spec.revision).toBe(1);
      expect(result.spec.editSpec.scenes[2].props.accentColor).toBe('#4D8DFF');
      expect(result.validation.valid).toBe(true);
      expect(result.events.some((event) => event.toolName === 'apply_spec_patch')).toBe(true);
      expect(result.events.some((event) => event.toolName === 'validate_spec')).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.PICUT_AGENT_MODE;
      else process.env.PICUT_AGENT_MODE = previous;
    }
  });

  it('stages structural edits until a separate human confirmation turn', async () => {
    const previous = process.env.PICUT_AGENT_MODE;
    process.env.PICUT_AGENT_MODE = 'local';
    const projectId = `approval-test-${Date.now()}`;
    try {
      const proposed = await runPiCutAgent(projectId, '删除第 5 幕');
      expect(proposed.spec.revision).toBe(0);
      expect(proposed.spec.editSpec.scenes).toHaveLength(6);
      expect(proposed.pendingApproval?.risk).toBe('high');

      const approved = await runPiCutAgent(projectId, '确认上述结构修改');
      expect(approved.pendingApproval).toBeNull();
      expect(approved.spec.revision).toBe(1);
      expect(approved.spec.editSpec.scenes).toHaveLength(5);
      expect(approved.spec.storySpec.scenes).toHaveLength(5);
      expect(approved.validation.valid).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.PICUT_AGENT_MODE;
      else process.env.PICUT_AGENT_MODE = previous;
    }
  });
});
