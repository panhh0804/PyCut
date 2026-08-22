import {describe, expect, it} from 'vitest';
import {createDefaultVideoSpec} from '@/lib/video-spec/defaults';
import {routeRenderBackend} from './router';

describe('render engine autonomous router', () => {
  it('routes chart-heavy deterministic timelines to Remotion', () => {
    const decision = routeRenderBackend(createDefaultVideoSpec('route-remotion'));
    expect(decision.selected).toBe('remotion');
    expect(decision.scores.remotion).toBeGreaterThan(decision.scores.hyperframes);
    expect(decision.scenes.some((scene) => scene.reason.includes('DynamicChart'))).toBe(true);
  });

  it('routes a pure short editorial DOM composition to HyperFrames', () => {
    const base = createDefaultVideoSpec('route-hyperframes');
    const scene = {...base.editSpec.scenes[0], durationFrames: 270};
    const spec = {
      ...base,
      project: {...base.project, targetDurationMs: 9000},
      storySpec: {...base.storySpec, scenes: [base.storySpec.scenes[0]]},
      editSpec: {...base.editSpec, scenes: [scene]},
    };
    const decision = routeRenderBackend(spec);
    expect(decision.selected).toBe('hyperframes');
    expect(decision.fallback).toBe('remotion');
  });
});
