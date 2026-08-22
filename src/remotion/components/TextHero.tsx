import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {asString, SceneShell, type SceneComponentProps} from './SceneShell';

export function TextHero(input: SceneComponentProps) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const progress = spring({frame, fps, config: {damping: 18, stiffness: 95, mass: 0.9}});
  const title = asString(input.props.title, 'πCut');
  const accent = asString(input.props.accentColor, input.spec.style.tokens.primary);
  const words = title.split('\n');
  return (
    <SceneShell {...input} accent={accent}>
      <div style={{position: 'absolute', inset: '120px 118px 110px', display: 'grid', gridTemplateColumns: '1.15fr .85fr', alignItems: 'center', gap: 86}}>
        <div style={{transform: `translateY(${(1 - progress) * 54}px)`, opacity: progress}}>
          <div style={{fontSize: 21, color: accent, letterSpacing: 5, fontWeight: 850, marginBottom: 28}}>{asString(input.props.eyebrow)}</div>
          <h1 style={{fontSize: 114, lineHeight: .98, letterSpacing: -5, margin: 0, fontWeight: 900}}>
            {words.map((word, index) => <span key={word} style={{display: 'block', color: index === words.length - 1 ? accent : input.spec.style.tokens.text}}>{word}</span>)}
          </h1>
          <p style={{fontSize: 32, color: input.spec.style.tokens.muted, margin: '32px 0 0', letterSpacing: .4}}>{asString(input.props.subtitle)}</p>
        </div>
        <div style={{height: 650, position: 'relative', display: 'grid', placeItems: 'center'}}>
          {[0, 1, 2].map((ring) => (
            <div key={ring} style={{position: 'absolute', width: 260 + ring * 135, height: 260 + ring * 135, border: `1px solid ${accent}${ring === 0 ? '90' : '32'}`, borderRadius: '50%', transform: `rotate(${frame * (ring % 2 ? -0.16 : 0.12)}deg) scale(${.9 + progress * .1})`}}>
              <span style={{position: 'absolute', width: 18, height: 18, borderRadius: '50%', background: ring === 1 ? input.spec.style.tokens.accent : accent, top: '12%', left: '18%', boxShadow: `0 0 24px ${accent}`}} />
            </div>
          ))}
          <div style={{width: 210, height: 210, borderRadius: 42, background: `linear-gradient(145deg, ${accent}36, ${input.spec.style.tokens.surface})`, border: `1px solid ${accent}82`, display: 'grid', placeItems: 'center', boxShadow: `0 42px 90px rgba(0,0,0,.4), inset 0 0 52px ${accent}18`, transform: `rotate(${interpolate(progress, [0, 1], [-10, 0])}deg)`}}>
            <span style={{fontSize: 86, fontWeight: 900}}>π</span>
          </div>
          <div style={{position: 'absolute', right: 0, bottom: 38, color: input.spec.style.tokens.muted, fontSize: 17, letterSpacing: 3}}>{asString(input.props.metric)}</div>
        </div>
      </div>
    </SceneShell>
  );
}

