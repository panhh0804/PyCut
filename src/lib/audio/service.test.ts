import {describe, expect, it} from 'vitest';
import {createDefaultVideoSpec} from '@/lib/video-spec/defaults';
import {planNaturalNarrationTimeline} from './service';

describe('natural narration timing', () => {
  it('never hides a tempo multiplier behind 1.0× and ripples later scenes instead', () => {
    const spec = createDefaultVideoSpec('natural-narration-timing');
    const first = spec.editSpec.scenes[0];
    const second = spec.editSpec.scenes[1];
    const sourceMs = 15_000;
    const result = planNaturalNarrationTimeline(spec, new Map([[first.id, sourceMs]]));
    const expectedFrames = Math.ceil((sourceMs + 180) / 1000 * spec.canvas.fps);
    expect(result.scenes[0].durationFrames).toBe(expectedFrames);
    expect(result.scenes[1].startFrame).toBe(second.startFrame + expectedFrames - first.durationFrames);
    expect(result.extendedByFrames).toBe(expectedFrames - first.durationFrames);
  });

  it('does not shorten an existing scene when narration is already sparse', () => {
    const spec = createDefaultVideoSpec('sparse-narration-timing');
    const sourceDurations = new Map(spec.editSpec.scenes.map((scene) => [scene.id, 400]));
    const result = planNaturalNarrationTimeline(spec, sourceDurations);
    expect(result.scenes).toEqual(spec.editSpec.scenes);
    expect(result.extendedByFrames).toBe(0);
  });
});
