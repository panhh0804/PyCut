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

  it('understands free canvas layer complexity instead of treating it as an unknown template', () => {
    const spec = createDefaultVideoSpec('route-free-canvas');
    spec.editSpec.scenes[0].component = 'SceneCanvas';
    spec.editSpec.scenes[0].props = {
      background: {type: 'solid', colors: ['#071522']},
      layers: [
        {id: 'title', type: 'text', x: 8, y: 10, width: 60, height: 22, content: '自由画布'},
        {id: 'data', type: 'chart', x: 10, y: 45, width: 72, height: 40, labels: ['A', 'B'], values: [30, 70]},
      ],
    };
    const decision = routeRenderBackend(spec);
    const scene = decision.scenes.find((item) => item.sceneId === 'scene-01');
    expect(scene?.preferred).toBe('remotion');
    expect(scene?.reason).toContain('SceneCanvas');
    expect(decision.reasons.some((reason) => reason.includes('自由画布'))).toBe(true);
  });
});
