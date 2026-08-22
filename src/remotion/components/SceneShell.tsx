import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {VideoSpec} from '../../lib/video-spec/schema';

export interface SceneComponentProps {
  props: Record<string, unknown>;
  spec: VideoSpec;
  sceneIndex: number;
  durationInFrames: number;
}

const lineStyle: CSSProperties = {
  position: 'absolute',
  height: 1,
  left: 0,
  right: 0,
  background: 'rgba(141,167,184,.12)',
};

export function SceneShell({
  children,
  props,
  spec,
  sceneIndex,
  durationInFrames,
  accent,
}: SceneComponentProps & {children: ReactNode; accent?: string}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = props.transitionIn && props.transitionIn !== 'fade' ? 1 : interpolate(frame, [0, Math.min(18, durationInFrames / 4)], [0, 1], {extrapolateRight: 'clamp'});
  const exit = props.transitionOut && props.transitionOut !== 'fade' ? 1 : interpolate(frame, [durationInFrames - Math.min(12, durationInFrames / 4), durationInFrames], [1, 0], {extrapolateLeft: 'clamp'});
  const pulse = 0.3 + Math.sin(frame / fps * Math.PI) * 0.08;
  const tokens = spec.style.tokens;
  const activeAccent = accent ?? tokens.primary;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: props.transparentBackground ? 'transparent' : tokens.background,
        color: tokens.text,
        fontFamily: tokens.fontFamily,
        opacity: Math.min(enter, exit),
        overflow: 'hidden',
      }}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${18 + sceneIndex * 12}% ${20 + sceneIndex * 8}%, ${activeAccent}24, transparent 36%), radial-gradient(circle at 78% 82%, ${tokens.accent}16, transparent 32%), linear-gradient(140deg, transparent 40%, rgba(255,255,255,.025))`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.14,
          backgroundImage: 'linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)',
          backgroundSize: '96px 96px',
          transform: `translateY(${(frame * 0.15) % 96}px)`,
        }}
      />
      <div style={{...lineStyle, top: 72}} />
      <div style={{...lineStyle, bottom: 72}} />
      <div style={{position: 'absolute', top: 28, left: 64, display: 'flex', alignItems: 'center', gap: 14, fontSize: 19, fontWeight: 800, letterSpacing: 2.8}}>
        <span style={{width: 12, height: 12, borderRadius: '50%', background: activeAccent, boxShadow: `0 0 26px ${activeAccent}`, opacity: pulse + 0.6}} />
        πCUT / EXPLAINER
      </div>
      <div style={{position: 'absolute', top: 31, right: 64, fontSize: 18, color: tokens.muted, letterSpacing: 2}}>
        {String(sceneIndex + 1).padStart(2, '0')} / {String(spec.editSpec.scenes.length).padStart(2, '0')}
      </div>
      <div style={{position: 'absolute', left: 64, right: 64, bottom: 30, display: 'flex', justifyContent: 'space-between', fontSize: 16, color: tokens.muted, letterSpacing: 1.4}}>
        <span>ATTENTION IS ALL YOU NEED</span>
        <span>{spec.canvas.fps} FPS · DETERMINISTIC FRAME</span>
      </div>
      <div style={{position: 'absolute', left: 0, bottom: 0, width: `${(frame / durationInFrames) * 100}%`, height: 5, background: activeAccent, boxShadow: `0 0 18px ${activeAccent}`}} />
      {children}
    </AbsoluteFill>
  );
}

export const asString = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
export const asNumber = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export const asStrings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
export const asNumbers = (value: unknown) => Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : [];
export const withAlpha = (color: string, alpha: string) => /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color;
