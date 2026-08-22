import {interpolate, useCurrentFrame} from 'remotion';
import {asString, asStrings, SceneShell, withAlpha, type SceneComponentProps} from './SceneShell';

export function CaptionKaraoke(input: SceneComponentProps) {
  const frame = useCurrentFrame();
  const accent = asString(input.props.accentColor, input.spec.style.tokens.primary);
  const words = asStrings(input.props.words);
  const active = Math.min(words.length - 1, Math.floor(interpolate(frame, [20, input.durationInFrames - 35], [0, words.length], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})));
  return (
    <SceneShell {...input} accent={accent}>
      <div style={{position: 'absolute', inset: '130px 128px 120px', display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
        <div style={{fontSize: 19, color: accent, letterSpacing: 4, fontWeight: 850}}>{asString(input.props.kicker)}</div>
        <h2 style={{fontSize: 86, margin: '26px 0 18px', letterSpacing: -3.5}}>{asString(input.props.title)}</h2>
        <div style={{fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 50, color: input.spec.style.tokens.muted, padding: '24px 30px', borderLeft: `6px solid ${accent}`, background: 'rgba(255,255,255,.035)'}}>{asString(input.props.formula)}</div>
        <div style={{display: 'flex', alignItems: 'center', margin: '70px 0 62px'}}>
          {words.map((word, index) => <div key={word} style={{display: 'contents'}}><div style={{padding: '25px 34px', borderRadius: 20, fontSize: 31, fontWeight: 850, background: index === active ? accent : withAlpha(input.spec.style.tokens.surface, 'E6'), color: index === active ? input.spec.style.tokens.background : input.spec.style.tokens.muted, border: `1px solid ${index === active ? accent : 'rgba(255,255,255,.1)'}`, transform: `scale(${index === active ? 1.06 : 1})`, boxShadow: index === active ? `0 18px 55px ${accent}35` : 'none'}}>{word}</div>{index < words.length - 1 && <div style={{height: 2, flex: 1, background: index < active ? accent : 'rgba(141,167,184,.2)'}} />}</div>)}
        </div>
        <p style={{fontSize: 39, margin: 0, letterSpacing: -.5, color: input.spec.style.tokens.text}}>{asString(input.props.footer)}</p>
      </div>
    </SceneShell>
  );
}
