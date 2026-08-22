import {describe, expect, it} from 'vitest';
import {createDefaultVideoSpec} from './defaults';
import {rippleReorderScene} from './timeline';
import {validateVideoSpec} from './validation';

describe('timeline ripple reorder', () => {
  it('keeps EditSpec, StorySpec and narration timing in the same order when clips cross', () => {
    const spec = createDefaultVideoSpec('timeline-reorder');
    spec.editSpec.globalAudio.narrationSegments = spec.editSpec.scenes.map((scene) => ({
      sceneId: scene.id,
      assetId: `audio-${scene.id}`,
      trackId: 'audio-narration',
      startFrame: scene.startFrame,
      durationFrames: scene.durationFrames,
      sourceDurationMs: scene.durationFrames / spec.canvas.fps * 1000,
      renderedDurationMs: scene.durationFrames / spec.canvas.fps * 1000,
      muted: false,
      gainDb: 0,
      playbackRate: 1,
      waveform: Array.from({length: 16}, () => 0.5),
    }));
    const second = spec.editSpec.scenes[1];
    const result = rippleReorderScene(spec, second.id, spec.editSpec.scenes[4].startFrame + 100);
    expect(result.changed).toBe(true);
    expect(result.editScenes.map((scene) => scene.id)).toEqual(['scene-01', 'scene-03', 'scene-04', 'scene-05', 'scene-02', 'scene-06']);
    expect(result.storyScenes.map((scene) => scene.id)).toEqual(result.editScenes.map((scene) => scene.id));
    expect(result.editScenes.map((scene) => scene.startFrame)).toEqual([0, 270, 585, 885, 1215, 1515]);
    for (const segment of result.narrationSegments) {
      expect(segment.startFrame).toBe(result.editScenes.find((scene) => scene.id === segment.sceneId)?.startFrame);
    }
    const next = {...spec, storySpec: {...spec.storySpec, scenes: result.storyScenes}, editSpec: {...spec.editSpec, scenes: result.editScenes, globalAudio: {...spec.editSpec.globalAudio, narrationSegments: result.narrationSegments}}};
    expect(validateVideoSpec(next).valid).toBe(true);
  });

  it('does not rewrite arrays until the dragged clip crosses another clip center', () => {
    const spec = createDefaultVideoSpec('timeline-no-reorder');
    const scene = spec.editSpec.scenes[1];
    const result = rippleReorderScene(spec, scene.id, scene.startFrame + 10);
    expect(result.changed).toBe(false);
    expect(result.editScenes).toBe(spec.editSpec.scenes);
  });
});
