import {Video} from '@remotion/media';
import {Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {asNumber, asString, type SceneComponentProps} from './SceneShell';

const maskShape = (mask: string) => {
  if (mask === 'rounded') return 'inset(5% 4% round 42px)';
  if (mask === 'circle') return 'circle(43% at 66% 50%)';
  if (mask === 'diagonal') return 'polygon(10% 0,100% 0,90% 100%,0 100%)';
  return undefined;
};

export function MediaClip(input: SceneComponentProps) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const asset = input.spec.assets.find((item) => item.id === asString(input.props.assetId));
  const source = asset?.src ? asset.src.startsWith('/') ? staticFile(asset.src.slice(1)) : asset.src : '';
  const progress = interpolate(frame, [0, Math.max(1, input.durationInFrames - 1)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const enter = spring({frame, fps, config: {damping: 24, stiffness: 90, mass: 1}});
  const startScale = asNumber(input.props.startScale, 1.03);
  const endScale = asNumber(input.props.endScale, 1.12);
  const focalX = asNumber(input.props.focalX, 50);
  const focalY = asNumber(input.props.focalY, 50);
  const panX = asNumber(input.props.panX, -2);
  const panY = asNumber(input.props.panY, 0);
  const fit = asString(input.props.fit, 'cover') as 'cover' | 'contain';
  const accent = asString(input.props.accentColor, input.spec.style.tokens.primary);
  const mediaStyle = {
    position: 'absolute' as const,
    inset: '-5%',
    width: '110%',
    height: '110%',
    objectFit: fit,
    objectPosition: `${focalX}% ${focalY}%`,
    scale: startScale + (endScale - startScale) * progress,
    translate: `${panX * progress}% ${panY * progress}%`,
    filter: 'saturate(1.08) contrast(1.04)',
  };
  const volume = Boolean(input.props.muted ?? true) ? 0 : 10 ** (asNumber(input.props.volumeDb, -18) / 20);
  return <div style={{position: 'absolute', inset: 0, overflow: 'hidden', background: input.spec.style.tokens.background, color: input.spec.style.tokens.text, fontFamily: input.spec.style.tokens.fontFamily}}>
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', clipPath: maskShape(asString(input.props.mask, 'none'))}}>
      {source && asset?.kind === 'video' ? <Video src={source} trimBefore={Math.round(asNumber(input.props.sourceStartFrame, 0))} playbackRate={asNumber(input.props.playbackRate, 1)} loop={Boolean(input.props.loop)} volume={volume} style={mediaStyle}/> : source ? <Img src={source} style={mediaStyle}/> : null}
    </div>
    <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(90deg,rgba(3,13,22,.92),rgba(3,13,22,.58) 48%,rgba(3,13,22,.1)),linear-gradient(0deg,rgba(3,13,22,.78),transparent 55%)'}}/>
    <div style={{position: 'absolute', left: 108, top: 96, bottom: 88, width: 900, display: 'flex', flexDirection: 'column', justifyContent: 'center', translate: `0 ${(1 - enter) * 70}px`, opacity: enter}}>
      <div style={{fontSize: 20, fontWeight: 850, letterSpacing: 5, color: accent, marginBottom: 24}}>{asString(input.props.kicker)}</div>
      <h2 style={{fontSize: 98, lineHeight: .98, letterSpacing: -4.5, margin: 0, textWrap: 'balance'}}>{asString(input.props.headline)}</h2>
      <p style={{fontSize: 30, lineHeight: 1.55, color: '#D2E4ED', maxWidth: 780, margin: '34px 0 0'}}>{asString(input.props.caption)}</p>
      <div style={{display: 'flex', alignItems: 'center', gap: 14, marginTop: 54, color: '#A6C0CE', fontSize: 16, letterSpacing: 1.4}}><span style={{width: 42, height: 2, background: accent}}/>{asString(input.props.credit)}</div>
    </div>
    <div style={{position: 'absolute', top: 34, left: 48, fontSize: 17, fontWeight: 850, letterSpacing: 3}}>πCUT / MOTION FOOTAGE</div>
    <div style={{position: 'absolute', bottom: 0, left: 0, height: 6, width: `${progress * 100}%`, background: accent, boxShadow: `0 0 22px ${accent}`}}/>
  </div>;
}
