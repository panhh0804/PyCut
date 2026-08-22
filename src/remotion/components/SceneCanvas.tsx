import type {CSSProperties, ReactNode} from 'react';
import {Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneCanvasProps} from '../../lib/video-spec/schema';
import type {SceneComponentProps} from './SceneShell';

type CanvasLayer = SceneCanvasProps['layers'][number];

function canvasBackground(canvas: SceneCanvasProps) {
  const {background} = canvas;
  if (background.type === 'solid') return background.colors[0];
  if (background.type === 'radial') {
    return `radial-gradient(circle at ${background.focalX}% ${background.focalY}%, ${background.colors.join(', ')})`;
  }
  return `linear-gradient(${background.angle}deg, ${background.colors.join(', ')})`;
}

function textureStyle(texture: SceneCanvasProps['texture'], accent: string): CSSProperties {
  if (texture === 'grid') return {
    backgroundImage: `linear-gradient(${accent}16 1px, transparent 1px), linear-gradient(90deg, ${accent}16 1px, transparent 1px)`,
    backgroundSize: '72px 72px',
  };
  if (texture === 'dots') return {backgroundImage: `radial-gradient(${accent}32 1.5px, transparent 1.5px)`, backgroundSize: '30px 30px'};
  if (texture === 'scanlines') return {backgroundImage: 'linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px)', backgroundSize: '100% 5px'};
  return {};
}

function motionStyle(layer: CanvasLayer, frame: number, fps: number): CSSProperties {
  const motion = layer.motion;
  const local = frame - motion.delayFrames;
  const duration = Math.max(1, motion.durationFrames);
  const linear = interpolate(local, [0, duration], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const sprung = spring({frame: Math.max(0, local), fps, durationInFrames: duration, config: {damping: 22, stiffness: 120, mass: 0.9}});
  const amount = motion.intensity;
  let opacity = layer.style.opacity ?? 1;
  let translateX = 0;
  let translateY = 0;
  let scale = 1;
  let clipPath: string | undefined;
  if (motion.preset !== 'none' && local < 0) opacity = 0;
  if (motion.preset === 'fade') opacity *= linear;
  if (motion.preset === 'rise') { opacity *= linear; translateY = (1 - sprung) * 64 * amount; }
  if (motion.preset === 'slide-left') { opacity *= linear; translateX = (1 - sprung) * 110 * amount; }
  if (motion.preset === 'slide-right') { opacity *= linear; translateX = (sprung - 1) * 110 * amount; }
  if (motion.preset === 'scale') { opacity *= linear; scale = 0.72 + sprung * 0.28; }
  if (motion.preset === 'reveal') { opacity *= linear; clipPath = `inset(0 ${(1 - linear) * 100}% 0 0)`; }
  if (motion.preset === 'draw') { opacity *= linear; scale = Math.max(0.001, linear); }
  if (motion.preset === 'float') { opacity *= linear; translateY = (1 - sprung) * 42 + Math.sin(Math.max(0, local) / fps * Math.PI * 1.4) * 9 * amount; }
  if (motion.preset === 'pulse') { opacity *= linear; scale = 1 + Math.sin(Math.max(0, local) / fps * Math.PI * 2) * 0.035 * amount; }
  return {
    opacity,
    translate: `${translateX}px ${translateY}px`,
    scale,
    rotate: `${layer.style.rotation ?? 0}deg`,
    clipPath,
  };
}

function layerFrameStyle(layer: CanvasLayer, frame: number, fps: number): CSSProperties {
  const style = layer.style;
  return {
    position: 'absolute',
    left: `${layer.x}%`,
    top: `${layer.y}%`,
    width: `${layer.width}%`,
    height: `${layer.height}%`,
    zIndex: layer.zIndex,
    color: style.color,
    backgroundColor: style.backgroundColor,
    borderColor: layer.type === 'line' ? undefined : style.borderColor,
    borderStyle: layer.type !== 'line' && style.borderWidth ? 'solid' : undefined,
    borderWidth: layer.type === 'line' ? undefined : style.borderWidth,
    borderRadius: style.radius,
    padding: style.padding,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.align,
    filter: style.blur ? `blur(${style.blur}px)` : undefined,
    boxShadow: layer.type !== 'line' && style.shadow ? `0 18px ${style.shadow}px rgba(0,0,0,.28), 0 0 ${style.shadow}px ${style.borderColor ?? style.color ?? 'rgba(255,255,255,.15)'}55` : undefined,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    whiteSpace: 'pre-wrap',
    ...motionStyle(layer, frame, fps),
  };
}

function metricContent(content: string, progress: number) {
  const match = content.match(/-?\d+(?:\.\d+)?/);
  if (!match) return content;
  const target = Number(match[0]);
  const value = Math.abs(target) >= 10 ? Math.round(target * progress) : Math.round(target * progress * 10) / 10;
  return content.replace(match[0], String(value));
}

function CanvasLayerContent({layer, frame, spec}: {layer: CanvasLayer; frame: number; spec: SceneComponentProps['spec']}): ReactNode {
  const progress = interpolate(frame - layer.motion.delayFrames, [0, Math.max(1, layer.motion.durationFrames)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  if (layer.type === 'image') {
    const asset = spec.assets.find((item) => item.id === layer.assetId);
    const source = asset?.src ? asset.src.startsWith('/') ? staticFile(asset.src.slice(1)) : asset.src : '';
    return source ? <Img src={source} style={{width: '100%', height: '100%', objectFit: 'cover'}}/> : null;
  }
  if (layer.type === 'chart') {
    const max = Math.max(...(layer.values ?? []), 1);
    return <div style={{display: 'flex', alignItems: 'end', gap: 18, width: '100%', height: '100%', padding: layer.style.padding ?? 18}}>{(layer.values ?? []).map((value, index) => <div key={`${layer.id}-${index}`} style={{display: 'flex', flex: 1, height: '100%', flexDirection: 'column', justifyContent: 'end', alignItems: 'center', gap: 10}}><strong style={{fontSize: 22}}>{Math.round(value * progress)}</strong><i style={{display: 'block', width: '100%', height: `${Math.max(2, value / max * progress * 76)}%`, borderRadius: `${layer.style.radius ?? 12}px ${layer.style.radius ?? 12}px 4px 4px`, background: layer.style.color ?? spec.style.tokens.primary, boxShadow: `0 0 26px ${layer.style.color ?? spec.style.tokens.primary}55`}}/><span style={{fontSize: 16, opacity: .72}}>{layer.labels?.[index]}</span></div>)}</div>;
  }
  if (layer.type === 'particles') {
    const count = Math.max(6, Math.min(36, Number.parseInt(layer.content ?? '18', 10) || 18));
    return <div style={{position: 'relative', width: '100%', height: '100%'}}>{Array.from({length: count}, (_, index) => {
      const x = (index * 37 + 11) % 100;
      const y = (index * 61 + 7) % 100;
      const size = 4 + index % 5 * 3;
      const drift = Math.sin(frame / 18 + index * 1.7) * 14;
      return <i key={index} style={{position: 'absolute', left: `${x}%`, top: `${y}%`, width: size, height: size, borderRadius: '50%', background: layer.style.color ?? spec.style.tokens.primary, opacity: .25 + index % 4 * .16, translate: `${drift}px ${-progress * (12 + index % 7 * 5)}px`, boxShadow: `0 0 ${size * 3}px ${layer.style.color ?? spec.style.tokens.primary}`}}/>;
    })}</div>;
  }
  if (layer.type === 'line') {
    const color = layer.style.color ?? spec.style.tokens.primary;
    return <span style={{display: 'block', width: `${progress * 100}%`, height: Math.max(1, layer.style.borderWidth ?? 2), background: color, boxShadow: layer.style.shadow ? `0 0 ${layer.style.shadow}px ${color}` : undefined, transformOrigin: 'left center'}}/>;
  }
  if (layer.type === 'shape') return layer.content ? <span>{layer.content}</span> : null;
  if (layer.type === 'code') {
    const lines = (layer.content ?? '').split('\n');
    const visible = Math.max(1, Math.ceil(lines.length * progress));
    return <code style={{fontFamily: 'JetBrains Mono, SFMono-Regular, Consolas, monospace', fontSize: layer.style.fontSize ?? 25, lineHeight: layer.style.lineHeight ?? 1.55}}>{lines.map((line, index) => <span key={index} style={{display: 'block', opacity: index < visible ? 1 : .12, color: index === visible - 1 ? layer.style.color ?? spec.style.tokens.primary : undefined}}>{line || ' '}</span>)}</code>;
  }
  if (layer.type === 'metric' || layer.motion.preset === 'count') return <span>{metricContent(layer.content ?? '', progress)}</span>;
  if (layer.type === 'formula') return <code style={{fontFamily: 'KaTeX_Main, STIX Two Math, serif'}}>{layer.content}</code>;
  return <span>{layer.content}</span>;
}

export function SceneCanvas(input: SceneComponentProps) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const canvas = input.props as unknown as SceneCanvasProps;
  const progress = interpolate(frame, [0, Math.max(1, input.durationInFrames - 1)], [0, 1], {extrapolateRight: 'clamp'});
  const cameraScale = interpolate(progress, [0, 1], [canvas.camera.startScale, canvas.camera.endScale]);
  const accent = canvas.accentColor ?? input.spec.style.tokens.primary;
  const cameraLayers = canvas.layers.filter((layer) => ['shape', 'line', 'image', 'particles'].includes(layer.type));
  const contentLayers = canvas.layers.filter((layer) => !cameraLayers.includes(layer));
  const renderLayer = (layer: CanvasLayer) => <div key={layer.id} style={layerFrameStyle(layer, frame, fps)}><CanvasLayerContent layer={layer} frame={frame} spec={input.spec}/></div>;
  return <div style={{position: 'absolute', inset: 0, overflow: 'hidden', background: canvasBackground(canvas), color: input.spec.style.tokens.text, fontFamily: input.spec.style.tokens.fontFamily}}>
    <div style={{position: 'absolute', inset: '-4%', scale: cameraScale, translate: `${canvas.camera.panX * progress}% ${canvas.camera.panY * progress}%`, transformOrigin: 'center center'}}>
      <div style={{position: 'absolute', inset: 0, opacity: .6, ...textureStyle(canvas.texture, accent)}}/>
      {cameraLayers.map(renderLayer)}
    </div>
    <div style={{position: 'absolute', inset: 0}}>{contentLayers.map(renderLayer)}</div>
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 150px rgba(0,0,0,.32)'}}/>
    <div style={{position: 'absolute', left: 46, bottom: 30, fontSize: 14, letterSpacing: 2.2, opacity: .58}}>πCUT / FREE SCENE CANVAS · {String(input.sceneIndex + 1).padStart(2, '0')}</div>
    <div style={{position: 'absolute', right: 46, bottom: 30, width: 210, height: 3, background: 'rgba(255,255,255,.12)'}}><i style={{display: 'block', width: `${Math.min(100, frame / Math.max(1, input.durationInFrames - 1) * 100)}%`, height: '100%', background: accent, boxShadow: `0 0 14px ${accent}`}}/></div>
  </div>;
}
