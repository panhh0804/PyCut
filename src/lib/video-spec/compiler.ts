import type {VideoSpec} from './schema';

export interface CompiledScene {
  id: string;
  index: number;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  startMs: number;
  durationMs: number;
  component: VideoSpec['editSpec']['scenes'][number]['component'];
  props: Record<string, unknown>;
  narration: string;
}

export interface CompiledVideo {
  spec: VideoSpec;
  scenes: CompiledScene[];
  durationInFrames: number;
  durationMs: number;
}

export function compileVideoSpec(spec: VideoSpec): CompiledVideo {
  const storyById = new Map(spec.storySpec.scenes.map((scene) => [scene.id, scene]));
  const scenes = [...spec.editSpec.scenes]
    .sort((a, b) => a.startFrame - b.startFrame)
    .map((scene, index) => ({
      id: scene.id,
      index,
      startFrame: scene.startFrame,
      endFrame: scene.startFrame + scene.durationFrames,
      durationFrames: scene.durationFrames,
      startMs: Math.round((scene.startFrame / spec.canvas.fps) * 1000),
      durationMs: Math.round((scene.durationFrames / spec.canvas.fps) * 1000),
      component: scene.component,
      props: scene.props,
      narration: storyById.get(scene.id)?.narration ?? '',
    }));
  const durationInFrames = scenes.reduce((max, scene) => Math.max(max, scene.endFrame), 0);
  return {
    spec,
    scenes,
    durationInFrames,
    durationMs: Math.round((durationInFrames / spec.canvas.fps) * 1000),
  };
}

export function toSrt(spec: VideoSpec): string {
  const compiled = compileVideoSpec(spec);
  const time = (milliseconds: number) => {
    const hours = Math.floor(milliseconds / 3_600_000);
    const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
    const seconds = Math.floor((milliseconds % 60_000) / 1000);
    const millis = milliseconds % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
  };
  return compiled.scenes
    .map((scene, index) => `${index + 1}\n${time(scene.startMs)} --> ${time(scene.startMs + scene.durationMs)}\n${scene.narration}\n`)
    .join('\n');
}

