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

const GREEK_MAP: Record<string, string> = {
  alpha: '\u03B1', beta: '\u03B2', gamma: '\u03B3', delta: '\u03B4', epsilon: '\u03B5',
  zeta: '\u03B6', eta: '\u03B7', theta: '\u03B8', iota: '\u03B9', kappa: '\u03BA',
  lambda: '\u03BB', mu: '\u03BC', nu: '\u03BD', xi: '\u03BE', omicron: '\u03BF',
  pi: '\u03C0', rho: '\u03C1', sigma: '\u03C3', tau: '\u03C4', upsilon: '\u03C5',
  phi: '\u03C6', chi: '\u03C7', psi: '\u03C8', omega: '\u03C9',
  Gamma: '\u0393', Delta: '\u0394', Theta: '\u0398', Lambda: '\u039B',
  Xi: '\u039E', Pi: '\u03A0', Sigma: '\u03A3', Phi: '\u03A6', Psi: '\u03A8', Omega: '\u03A9',
};

const SYMBOL_MAP: Record<string, string> = {
  sum: '\u2211', prod: '\u220F', int: '\u222B', iint: '\u222C', oint: '\u222E',
  partial: '\u2202', nabla: '\u2207', infty: '\u221E', sqrt: '\u221A',
  pm: '\u00B1', mp: '\u2213', times: '\u00D7', div: '\u00F7', cdot: '\u22C5',
  neq: '\u2260', approx: '\u2248', leq: '\u2264', geq: '\u2265',
  equiv: '\u2261', propto: '\u221D', forall: '\u2200', exists: '\u2203',
  in: '\u2208', ni: '\u220B', subset: '\u2282', supset: '\u2283',
  cup: '\u222A', cap: '\u2229', empty: '\u2205', colon: '\u2236',
  ldots: '\u2026', cdots: '\u22EF', ddots: '\u22F1', vdots: '\u22EE',
  leftarrow: '\u2190', rightarrow: '\u2192', leftrightarrow: '\u2194',
  Leftarrow: '\u21D0', Rightarrow: '\u21D2', Leftrightarrow: '\u21D4',
};

type TokenType = 'normal' | 'italic' | 'symbol' | 'greek' | 'delimiter' | 'accent' | 'bigop';
interface FormulaToken {
  text?: string;
  super?: boolean;
  sub?: boolean;
  frac?: {num: string; den: string};
  sqrt?: string;
  style?: TokenType;
}

function parseFormula(text: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\\') {
      const cmd = text.slice(i + 1).match(/^[a-zA-Z]+/)?.[0] ?? '';
      if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
        const rest = text.slice(i + 1 + cmd.length);
        const numMatch = rest.match(/^\{([^}]*)\}/);
        if (numMatch) {
          const denMatch = rest.slice(numMatch[0].length).match(/^\{([^}]*)\}/);
          if (denMatch) {
            tokens.push({frac: {num: numMatch[1], den: denMatch[1]}});
            i += 1 + cmd.length + numMatch[0].length + denMatch[0].length;
            continue;
          }
        }
      }
      if (cmd === 'sqrt') {
        const rest = text.slice(i + 5);
        const inner = rest.match(/^\{([^}]*)\}/);
        if (inner) { tokens.push({sqrt: inner[1]}); i += 5 + inner[0].length; continue; }
        tokens.push({sqrt: 'x'}); i += 5; continue;
      }
      if (GREEK_MAP[cmd]) { tokens.push({text: GREEK_MAP[cmd], style: 'greek'}); i += 1 + cmd.length; continue; }
      if (SYMBOL_MAP[cmd]) { tokens.push({text: SYMBOL_MAP[cmd], style: SYMBOL_MAP[cmd].length > 1 ? 'bigop' : 'symbol'}); i += 1 + cmd.length; continue; }
      tokens.push({text: '\\' + cmd, style: 'normal'}); i += 1 + cmd.length; continue;
    }
    if (text[i] === '^' && tokens.length > 0) {
      const rest = text.slice(i + 1);
      const m = rest.match(/^\{([^}]*)\}|^(\w)/);
      if (m) { tokens[tokens.length - 1].super = true; tokens[tokens.length - 1].text = m[1] ?? m[2]; i += 1 + m[0].length; continue; }
    }
    if (text[i] === '_' && tokens.length > 0) {
      const rest = text.slice(i + 1);
      const m = rest.match(/^\{([^}]*)\}|^(\w)/);
      if (m) { tokens[tokens.length - 1].sub = true; tokens[tokens.length - 1].text = m[1] ?? m[2]; i += 1 + m[0].length; continue; }
    }
    if ('()[]{}|'.includes(text[i])) { tokens.push({text: text[i], style: 'delimiter'}); i++; continue; }
    tokens.push({text: text[i], style: /[A-Za-z]/.test(text[i]) ? 'italic' : 'normal'}); i++;
  }
  return tokens;
}

function FormulaRenderer({content, frame, delayFrames, style, accent}: {content: string; frame: number; delayFrames: number; style?: CanvasLayer['style']; accent: string}) {
  const localFrame = frame - delayFrames;
  const revealProgress = interpolate(localFrame, [0, 40], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const tokens = parseFormula(content);
  const visibleCount = Math.ceil(tokens.length * revealProgress);
  const visibleTokens = tokens.slice(0, visibleCount);
  const baseStyle: React.CSSProperties = {
    fontFamily: 'STIX Two Math, KaTeX_Main, Times New Roman, serif',
    fontSize: style?.fontSize ?? 48,
    fontWeight: style?.fontWeight ?? 400,
    color: style?.color ?? '#FFFFFF',
    letterSpacing: 2,
    lineHeight: 1.6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: style?.align === 'left' ? 'flex-start' : style?.align === 'right' ? 'flex-end' : 'center',
    flexWrap: 'wrap',
    gap: '2px 0',
    width: '100%',
    height: '100%',
    padding: style?.padding ?? 12,
    textAlign: style?.align,
  };
  return (
    <div style={baseStyle}>
      {visibleTokens.map((token, index) => {
        if (token.frac) {
          return (
            <span key={index} style={{display: 'inline-flex', flexDirection: 'column', alignItems: 'center', margin: '0 4px', verticalAlign: 'middle'}}>
              <span style={{fontSize: '0.75em', borderBottom: `2px solid ${accent}`, paddingBottom: 2, marginBottom: 2}}>{token.frac.num}</span>
              <span style={{fontSize: '0.75em', paddingTop: 2}}>{token.frac.den}</span>
            </span>
          );
        }
        if (token.sqrt !== undefined) {
          return (
            <span key={index} style={{display: 'inline-flex', alignItems: 'center', margin: '0 2px'}}>
              <span style={{fontSize: '1.4em', fontWeight: 200, marginRight: -2}}>{'\u221A'}</span>
              <span style={{borderTop: `2px solid ${accent}`, paddingLeft: 4, paddingTop: 2}}>{token.sqrt}</span>
            </span>
          );
        }
        const isGreeks = token.style === 'greek';
        const isSymbol = token.style === 'symbol' || token.style === 'bigop';
        const isItalic = token.style === 'italic';
        return (
          <span key={index} style={{
            fontStyle: isItalic ? 'italic' : 'normal',
            fontWeight: isSymbol ? 600 : isGreeks ? 500 : undefined,
            fontSize: isSymbol && token.style === 'bigop' ? '1.6em' : undefined,
            color: isGreeks ? accent : undefined,
            display: 'inline-block',
            textAlign: 'center',
          }}>
            {token.text}
          </span>
        );
      })}
    </div>
  );
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
  if (layer.type === 'formula') return <FormulaRenderer content={layer.content ?? ''} frame={frame} delayFrames={layer.motion.delayFrames} style={layer.style} accent={spec.style.tokens.primary} />;
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
