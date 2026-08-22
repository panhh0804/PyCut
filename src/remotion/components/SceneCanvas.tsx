import {Video} from '@remotion/media';
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

const iconPaths: Record<string, string[]> = {
  cloud: ['M22 74H78C92 74 96 54 83 48C82 29 58 20 46 35C30 31 19 43 22 56C9 60 10 74 22 74Z'],
  sun: ['M50 26A24 24 0 1 0 50 74A24 24 0 1 0 50 26', 'M50 5V17M50 83V95M5 50H17M83 50H95M18 18L27 27M73 73L82 82M82 18L73 27M27 73L18 82'],
  droplet: ['M50 8C50 8 24 40 24 60A26 26 0 0 0 76 60C76 40 50 8 50 8Z'],
  arrow: ['M12 50H84M61 27L84 50L61 73'],
  check: ['M18 52L40 73L83 25'],
  sparkles: ['M50 8L58 39L88 50L58 61L50 92L42 61L12 50L42 39Z'],
  globe: ['M50 10A40 40 0 1 0 50 90A40 40 0 1 0 50 10M10 50H90M50 10C32 30 32 70 50 90M50 10C68 30 68 70 50 90'],
  atom: ['M18 50C18 27 32 14 50 32C68 50 82 73 82 50C82 27 68 14 50 32C32 50 18 73 18 50M50 46A4 4 0 1 0 50 54A4 4 0 1 0 50 46'],
  play: ['M34 22L78 50L34 78Z'],
};

function maskClip(shape: string) {
  if (shape === 'circle') return 'circle(48% at 50% 50%)';
  if (shape === 'diagonal') return 'polygon(10% 0,100% 0,90% 100%,0 100%)';
  if (shape === 'hexagon') return 'polygon(25% 2%,75% 2%,98% 50%,75% 98%,25% 98%,2% 50%)';
  return 'inset(0 round 28px)';
}

function CanvasChart({layer, progress, accent}: {layer: CanvasLayer; progress: number; accent: string}) {
  const values = layer.values ?? [];
  const labels = layer.labels ?? [];
  const maximum = Math.max(...values, 1);
  const points = values.map((value, index) => `${values.length === 1 ? 50 : 8 + index / (values.length - 1) * 84},${88 - value / maximum * progress * 72}`).join(' ');
  if (layer.chartType === 'line' || layer.chartType === 'area' || layer.chartType === 'scatter') {
    return <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">
      {layer.chartType === 'area' && <polygon points={`8,88 ${points} 92,88`} fill={`${accent}33`}/>}
      {layer.chartType !== 'scatter' && <polyline points={points} fill="none" stroke={accent} strokeWidth="2.4" vectorEffect="non-scaling-stroke"/>}
      {values.map((value, index) => <circle key={index} cx={values.length === 1 ? 50 : 8 + index / (values.length - 1) * 84} cy={88 - value / maximum * progress * 72} r="2.8" fill={accent}/>) }
    </svg>;
  }
  if (layer.chartType === 'donut') {
    const total = Math.max(1, values.reduce((sum, value) => sum + Math.max(0, value), 0));
    const portions = values.map((value) => Math.max(0, value) / total * 251.2 * progress);
    return <svg viewBox="0 0 100 100" width="100%" height="100%">{portions.map((portion, index) => {
      const consumed = portions.slice(0, index).reduce((sum, item) => sum + item, 0);
      const circle = <circle key={index} cx="50" cy="50" r="40" fill="none" stroke={index % 2 ? layer.style.borderColor ?? '#FFFFFF' : accent} strokeOpacity={0.9 - index * 0.08} strokeWidth="13" strokeDasharray={`${portion} ${251.2 - portion}`} strokeDashoffset={-consumed} transform="rotate(-90 50 50)"/>;
      return circle;
    })}</svg>;
  }
  if (layer.chartType === 'network' || layer.chartType === 'flow') {
    const nodes = labels.map((label, index) => ({label, x: layer.chartType === 'flow' ? 12 + index * 76 / Math.max(1, labels.length - 1) : 50 + Math.cos(index / Math.max(1, labels.length) * Math.PI * 2) * 34, y: layer.chartType === 'flow' ? 50 : 50 + Math.sin(index / Math.max(1, labels.length) * Math.PI * 2) * 34}));
    return <svg viewBox="0 0 100 100" width="100%" height="100%">{nodes.slice(1).map((node, index) => <line key={`line-${index}`} x1={nodes[index].x} y1={nodes[index].y} x2={node.x} y2={node.y} stroke={accent} strokeOpacity={progress * .6} strokeWidth="1.5"/>)}{nodes.map((node, index) => <g key={node.label}><circle cx={node.x} cy={node.y} r={5 + (values[index] ?? 0) / maximum * 5 * progress} fill={`${accent}44`} stroke={accent}/><text x={node.x} y={node.y + 14} textAnchor="middle" fill="currentColor" fontSize="5">{node.label}</text></g>)}</svg>;
  }
  if (layer.chartType === 'timeline') {
    return <svg viewBox="0 0 100 100" width="100%" height="100%"><line x1="8" y1="50" x2={8 + 84 * progress} y2="50" stroke={accent} strokeWidth="2"/>{labels.map((label, index) => {const x = 8 + index / Math.max(1, labels.length - 1) * 84; return <g key={label}><circle cx={x} cy="50" r="4" fill={accent}/><text x={x} y={index % 2 ? 68 : 37} textAnchor="middle" fill="currentColor" fontSize="5">{label}</text></g>;})}</svg>;
  }
  if (layer.chartType === 'map') {
    return <svg viewBox="0 0 100 100" width="100%" height="100%"><path d="M9 28L25 16L42 20L52 13L71 22L90 18L84 42L91 57L72 68L62 88L44 78L27 84L14 65L20 48Z" fill={`${accent}22`} stroke={accent} strokeWidth="1.5"/>{values.map((value, index) => <circle key={index} cx={20 + index * 61 / Math.max(1, values.length - 1)} cy={32 + (index * 23) % 42} r={2 + value / maximum * 7 * progress} fill={accent} fillOpacity=".7"/>)}</svg>;
  }
  return <div style={{display: 'flex', alignItems: 'end', gap: 18, width: '100%', height: '100%', padding: layer.style.padding ?? 18}}>{values.map((value, index) => <div key={`${layer.id}-${index}`} style={{display: 'flex', flex: 1, height: '100%', flexDirection: 'column', justifyContent: 'end', alignItems: 'center', gap: 10}}><strong style={{fontSize: 22}}>{Math.round(value * progress)}</strong><i style={{display: 'block', width: '100%', height: `${Math.max(2, value / maximum * progress * 76)}%`, borderRadius: `${layer.style.radius ?? 12}px ${layer.style.radius ?? 12}px 4px 4px`, background: accent, boxShadow: `0 0 26px ${accent}55`}}/><span style={{fontSize: 16, opacity: .72}}>{labels[index]}</span></div>)}</div>;
}

function CanvasLayerContent({layer, frame, spec}: {layer: CanvasLayer; frame: number; spec: SceneComponentProps['spec']}): ReactNode {
  const progress = interpolate(frame - layer.motion.delayFrames, [0, Math.max(1, layer.motion.durationFrames)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  if (layer.type === 'image' || layer.type === 'video') {
    const asset = spec.assets.find((item) => item.id === layer.assetId);
    const source = asset?.src ? asset.src.startsWith('/') ? staticFile(asset.src.slice(1)) : asset.src : '';
    const style = {width: '100%', height: '100%', objectFit: layer.fit, objectPosition: `${layer.focalX}% ${layer.focalY}%`} as const;
    if (layer.type === 'video') return source ? <Video src={source} trimBefore={layer.sourceStartFrame} playbackRate={layer.playbackRate} loop={layer.loop} volume={layer.muted ? 0 : 10 ** (layer.volumeDb / 20)} style={style}/> : null;
    return source ? <Img src={source} style={style}/> : null;
  }
  if (layer.type === 'chart') {
    return <CanvasChart layer={layer} progress={progress} accent={layer.style.color ?? spec.style.tokens.primary}/>;
  }
  if (layer.type === 'svg') return <svg viewBox={layer.viewBox} width="100%" height="100%" fill="none" preserveAspectRatio="xMidYMid meet"><path d={layer.path} fill={layer.style.backgroundColor ?? 'none'} stroke={layer.style.color ?? spec.style.tokens.primary} strokeWidth={layer.style.borderWidth ?? 2} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress}/></svg>;
  if (layer.type === 'icon') return <svg viewBox="0 0 100 100" width="100%" height="100%" fill="none">{(iconPaths[layer.icon ?? 'sparkles'] ?? iconPaths.sparkles).map((path, index) => <path key={index} d={path} fill={index === 0 && layer.icon === 'play' ? layer.style.color ?? spec.style.tokens.primary : 'none'} stroke={layer.style.color ?? spec.style.tokens.primary} strokeWidth={layer.style.borderWidth ?? 4} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress}/>)}</svg>;
  if (layer.type === 'gradientMesh') return <div style={{width: '100%', height: '100%', background: `radial-gradient(circle at 18% 22%,${layer.style.color ?? spec.style.tokens.primary}AA,transparent 38%),radial-gradient(circle at 78% 68%,${layer.style.borderColor ?? spec.style.tokens.accent}88,transparent 42%),radial-gradient(circle at 52% 38%,${layer.style.backgroundColor ?? spec.style.tokens.surface},transparent 58%)`, opacity: layer.style.opacity ?? .72}}/>;
  if (layer.type === 'noise') return <div style={{width: '100%', height: '100%', opacity: layer.style.opacity ?? .14, backgroundImage: `repeating-radial-gradient(circle at ${(frame * 13) % 100}% ${(frame * 7) % 100}%,${layer.style.color ?? '#FFFFFF'} 0 1px,transparent 1px 4px)`, backgroundSize: '7px 7px'}}/>;
  if (layer.type === 'subComposition') return <svg viewBox="0 0 100 100" width="100%" height="100%"><ellipse cx="50" cy="50" rx={30 + Math.sin(frame / 12) * 3} ry="18" fill="none" stroke={layer.style.color ?? spec.style.tokens.primary} strokeWidth="2"/><ellipse cx="50" cy="50" rx="18" ry={30 + Math.cos(frame / 14) * 3} fill="none" stroke={layer.style.borderColor ?? spec.style.tokens.accent} strokeWidth="2"/><circle cx={50 + Math.cos(frame / 10) * 30} cy={50 + Math.sin(frame / 10) * 18} r="4" fill={layer.style.color ?? spec.style.tokens.primary}/></svg>;
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
  const memberIds = new Set(canvas.layers.flatMap((layer) => layer.type === 'group' || layer.type === 'mask' ? layer.memberIds : []));
  const rootLayers = canvas.layers.filter((layer) => !memberIds.has(layer.id));
  const cameraLayers = rootLayers.filter((layer) => ['shape', 'line', 'image', 'video', 'particles', 'gradientMesh', 'noise'].includes(layer.type));
  const contentLayers = rootLayers.filter((layer) => !cameraLayers.includes(layer));
  const renderLayer = (layer: CanvasLayer, ancestors = new Set<string>()): ReactNode => {
    if (ancestors.has(layer.id)) return null;
    if (layer.type === 'group' || layer.type === 'mask') {
      const nextAncestors = new Set(ancestors).add(layer.id);
      return <div key={layer.id} style={{...layerFrameStyle(layer, frame, fps), clipPath: layer.type === 'mask' ? maskClip(layer.maskShape) : undefined}}>{layer.memberIds.map((id) => canvas.layers.find((item) => item.id === id)).filter((item): item is CanvasLayer => Boolean(item)).map((item) => renderLayer(item, nextAncestors))}</div>;
    }
    return <div key={layer.id} style={layerFrameStyle(layer, frame, fps)}><CanvasLayerContent layer={layer} frame={frame} spec={input.spec}/></div>;
  };
  return <div style={{position: 'absolute', inset: 0, overflow: 'hidden', background: canvasBackground(canvas), color: input.spec.style.tokens.text, fontFamily: input.spec.style.tokens.fontFamily}}>
    <div style={{position: 'absolute', inset: '-4%', scale: cameraScale, translate: `${canvas.camera.panX * progress}% ${canvas.camera.panY * progress}%`, transformOrigin: 'center center'}}>
      <div style={{position: 'absolute', inset: 0, opacity: .6, ...textureStyle(canvas.texture, accent)}}/>
        {cameraLayers.map((layer) => renderLayer(layer))}
      </div>
      <div style={{position: 'absolute', inset: 0}}>{contentLayers.map((layer) => renderLayer(layer))}</div>
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 150px rgba(0,0,0,.32)'}}/>
    <div style={{position: 'absolute', left: 46, bottom: 30, fontSize: 14, letterSpacing: 2.2, opacity: .58}}>πCUT / FREE SCENE CANVAS · {String(input.sceneIndex + 1).padStart(2, '0')}</div>
    <div style={{position: 'absolute', right: 46, bottom: 30, width: 210, height: 3, background: 'rgba(255,255,255,.12)'}}><i style={{display: 'block', width: `${Math.min(100, frame / Math.max(1, input.durationInFrames - 1) * 100)}%`, height: '100%', background: accent, boxShadow: `0 0 14px ${accent}`}}/></div>
  </div>;
}
