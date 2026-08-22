import {componentPropsSchemas, type VideoSpec} from './schema';

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
  trackId: string;
  transform: VideoSpec['editSpec']['scenes'][number]['transform'];
  effects: VideoSpec['editSpec']['scenes'][number]['effects'];
  keyframes: VideoSpec['editSpec']['scenes'][number]['keyframes'];
  transition: VideoSpec['editSpec']['scenes'][number]['transition'];
  playbackRate: number;
}

export interface CompiledVideo {
  spec: VideoSpec;
  scenes: CompiledScene[];
  durationInFrames: number;
  durationMs: number;
}

export function compileVideoSpec(spec: VideoSpec): CompiledVideo {
  const storyById = new Map(spec.storySpec.scenes.map((scene) => [scene.id, scene]));
  const trackById = new Map(spec.editSpec.tracks.map((track) => [track.id, track]));
  const soloTracks = new Set(spec.editSpec.tracks.filter((track) => track.solo).map((track) => track.id));
  const scenes = [...spec.editSpec.scenes]
    .filter((scene) => {
      const track = trackById.get(scene.trackId);
      return Boolean(track?.visible && (!soloTracks.size || soloTracks.has(scene.trackId)));
    })
    .sort((a, b) => (trackById.get(b.trackId)?.order ?? 0) - (trackById.get(a.trackId)?.order ?? 0) || a.startFrame - b.startFrame)
    .map((scene, index) => {
      const normalizedProps = componentPropsSchemas[scene.component].safeParse(scene.props);
      return {
        id: scene.id,
        index,
        startFrame: scene.startFrame,
        endFrame: scene.startFrame + scene.durationFrames,
        durationFrames: scene.durationFrames,
        startMs: Math.round((scene.startFrame / spec.canvas.fps) * 1000),
        durationMs: Math.round((scene.durationFrames / spec.canvas.fps) * 1000),
        component: scene.component,
        props: {...(normalizedProps.success ? normalizedProps.data : scene.props), transparentBackground: trackById.get(scene.trackId)?.kind === 'overlay', transitionIn: scene.transition.in, transitionOut: scene.transition.out},
        narration: storyById.get(scene.id)?.narration ?? '',
        trackId: scene.trackId,
        transform: scene.transform,
        effects: scene.effects,
        keyframes: scene.keyframes,
        transition: scene.transition,
        playbackRate: scene.playbackRate,
      };
    });
  const durationInFrames = spec.editSpec.scenes.reduce((max, scene) => Math.max(max, scene.startFrame + scene.durationFrames), 1);
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
