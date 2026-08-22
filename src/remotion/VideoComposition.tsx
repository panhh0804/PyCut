import {Audio} from '@remotion/media';
import {AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {compileVideoSpec, type CompiledScene} from '../lib/video-spec/compiler';
import type {ComponentType, VideoSpec} from '../lib/video-spec/schema';
import {CaptionKaraoke} from './components/CaptionKaraoke';
import {DynamicChart} from './components/DynamicChart';
import {MediaBroll} from './components/MediaBroll';
import {SplitScreen} from './components/SplitScreen';
import {TextHero} from './components/TextHero';

export type VideoCompositionProps = {spec: VideoSpec} & Record<string, unknown>;

const components = {TextHero, SplitScreen, DynamicChart, CaptionKaraoke, MediaBroll} satisfies Record<ComponentType, typeof TextHero>;

function keyframed(scene: CompiledScene, property: 'x' | 'y' | 'scale' | 'rotation' | 'opacity', fallback: number, frame: number) {
  const points = scene.keyframes.filter((keyframe) => keyframe.property === property).sort((a, b) => a.frame - b.frame);
  if (!points.length) return fallback;
  if (frame <= points[0].frame) return points[0].value;
  if (frame >= points.at(-1)!.frame) return points.at(-1)!.value;
  return interpolate(frame, points.map((point) => point.frame), points.map((point) => point.value), {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
}

function SceneLayer({scene, spec, Component}: {scene: CompiledScene; spec: VideoSpec; Component: typeof TextHero}) {
  const frame = useCurrentFrame();
  const transitionFrames = Math.max(1, Math.min(scene.transition.durationFrames, Math.floor(scene.durationFrames / 2)));
  const enterProgress = interpolate(frame, [0, transitionFrames], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const exitProgress = interpolate(frame, [Math.max(0, scene.durationFrames - transitionFrames), scene.durationFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const x = keyframed(scene, 'x', scene.transform.x, frame);
  const y = keyframed(scene, 'y', scene.transform.y, frame);
  const scale = keyframed(scene, 'scale', scene.transform.scale, frame);
  const rotation = keyframed(scene, 'rotation', scene.transform.rotation, frame);
  let opacity = keyframed(scene, 'opacity', scene.transform.opacity, frame);
  if (scene.transition.in === 'fade') opacity *= enterProgress;
  if (scene.transition.out === 'fade') opacity *= exitProgress;
  const slideX = (scene.transition.in === 'slide' ? (1 - enterProgress) * 120 : 0) + (scene.transition.out === 'slide' ? (1 - exitProgress) * -120 : 0);
  const wipeProgress = Math.min(scene.transition.in === 'wipe' ? enterProgress : 1, scene.transition.out === 'wipe' ? exitProgress : 1);
  const filter = scene.effects.filter((effect) => effect.enabled).map((effect) => {
    if (effect.type === 'blur') return `blur(${effect.amount}px)`;
    if (effect.type === 'hue-rotate') return `hue-rotate(${effect.amount}deg)`;
    if (effect.type === 'drop-shadow') return `drop-shadow(0 12px ${Math.abs(effect.amount)}px rgba(0,0,0,.35))`;
    return `${effect.type}(${effect.amount})`;
  }).join(' ');
  return <AbsoluteFill style={{transform: `translate(${x + slideX}px, ${y}px) scale(${scale}) rotate(${rotation}deg)`, opacity, filter: filter || undefined, clipPath: wipeProgress < 1 ? `inset(0 ${(1 - wipeProgress) * 100}% 0 0)` : undefined}}><Component props={scene.props} spec={spec} sceneIndex={scene.index} durationInFrames={scene.durationFrames}/></AbsoluteFill>;
}

export function VideoComposition({spec}: VideoCompositionProps) {
  const compiled = compileVideoSpec(spec);
  const narration = spec.assets.find((asset) => asset.id === spec.editSpec.globalAudio.narrationAssetId);
  const narrationTrack = spec.editSpec.tracks.find((track) => track.id === 'audio-narration');
  const hasAudioSolo = spec.editSpec.tracks.some((track) => track.kind === 'audio' && track.solo);
  const narrationVolume = !narrationTrack || narrationTrack.muted || (hasAudioSolo && !narrationTrack.solo)
    ? 0
    : 10 ** (narrationTrack.gainDb / 20);
  return (
    <AbsoluteFill style={{backgroundColor: spec.style.tokens.background}}>
      {narration?.src && <Audio src={narration.src.startsWith('/') ? staticFile(narration.src.slice(1)) : narration.src} volume={narrationVolume} />}
      {compiled.scenes.map((scene) => {
        const Component = components[scene.component];
        return (
          <Sequence key={scene.id} from={scene.startFrame} durationInFrames={scene.durationFrames} name={`${scene.index + 1}. ${scene.id}`}>
            <SceneLayer scene={scene} spec={spec} Component={Component}/>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
