import {Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {asNumber, asString, type SceneComponentProps} from './SceneShell';

export function MediaBroll(input: SceneComponentProps) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const assetId = asString(input.props.assetId);
  const asset = input.spec.assets.find((item) => item.id === assetId);
  const source = asset?.src ? (asset.src.startsWith('/') ? staticFile(asset.src.slice(1)) : asset.src) : '';
  const accent = asString(input.props.accentColor, input.spec.style.tokens.primary);
  const enter = spring({frame, fps, config: {damping: 24, stiffness: 88, mass: 1.1}});
  const progress = interpolate(frame, [0, Math.max(1, input.durationInFrames - 1)], [0, 1], {extrapolateRight: 'clamp'});
  const focalX = asNumber(input.props.focalX, 50);
  const focalY = asNumber(input.props.focalY, 50);
  return <div style={{position: 'absolute', inset: 0, overflow: 'hidden', background: input.spec.style.tokens.background, fontFamily: input.spec.style.tokens.fontFamily, color: input.spec.style.tokens.text}}>
    {source && <Img src={source} style={{position: 'absolute', inset: '-5%', width: '110%', height: '110%', objectFit: 'cover', objectPosition: `${focalX}% ${focalY}%`, transform: `scale(${1.02 + progress * 0.09}) translate(${(progress - .5) * -2.4}%, ${(progress - .5) * -1.2}%)`, filter: 'saturate(1.08) contrast(1.04)'}}/>}
    <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(3,13,22,.9) 0%, rgba(3,13,22,.62) 42%, rgba(3,13,22,.08) 78%), linear-gradient(0deg, rgba(3,13,22,.82), transparent 48%)'}}/>
    <div style={{position: 'absolute', inset: 0, opacity: .24, backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.1) 1px,transparent 1px)', backgroundSize: '120px 120px', transform: `translate(${progress * -40}px,${progress * 24}px)`}}/>
    {Array.from({length: 14}, (_, index) => <i key={index} style={{position: 'absolute', width: 5 + index % 4 * 3, height: 5 + index % 4 * 3, borderRadius: '50%', left: `${54 + (index * 17) % 43}%`, top: `${10 + (index * 29) % 78}%`, background: index % 3 ? 'rgba(255,255,255,.66)' : accent, boxShadow: `0 0 18px ${accent}`, opacity: .24 + (index % 5) * .08, transform: `translate(${Math.sin(frame / 19 + index) * 18}px,${-progress * (36 + index * 3)}px)`}}/>)}
    <div style={{position: 'absolute', left: 108, top: 96, bottom: 88, width: 940, display: 'flex', flexDirection: 'column', justifyContent: 'center', transform: `translateY(${(1 - enter) * 70}px)`, opacity: enter}}>
      <div style={{fontSize: 20, fontWeight: 850, letterSpacing: 5, color: accent, marginBottom: 24}}>{asString(input.props.kicker)}</div>
      <h2 style={{fontSize: 98, lineHeight: .98, letterSpacing: -4.5, margin: 0, textWrap: 'balance'}}>{asString(input.props.headline)}</h2>
      <p style={{fontSize: 30, lineHeight: 1.55, color: '#D2E4ED', maxWidth: 780, margin: '34px 0 0'}}>{asString(input.props.caption)}</p>
      <div style={{display: 'flex', alignItems: 'center', gap: 14, marginTop: 54, color: '#A6C0CE', fontSize: 16, letterSpacing: 1.4}}><span style={{width: 42, height: 2, background: accent}}/>{asString(input.props.credit)}</div>
    </div>
    <div style={{position: 'absolute', top: 34, left: 48, fontSize: 17, fontWeight: 850, letterSpacing: 3}}>πCUT / FIELD VISUAL</div>
    <div style={{position: 'absolute', right: 48, bottom: 32, fontSize: 15, color: '#BDD3DD', letterSpacing: 2}}>SOURCE-TRACEABLE B-ROLL · {String(input.sceneIndex + 1).padStart(2, '0')}</div>
    <div style={{position: 'absolute', bottom: 0, left: 0, height: 6, width: `${progress * 100}%`, background: accent, boxShadow: `0 0 22px ${accent}`}}/>
  </div>;
}
