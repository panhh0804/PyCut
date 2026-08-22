import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {asString, asStrings, SceneShell, type SceneComponentProps} from './SceneShell';

export function SplitScreen(input: SceneComponentProps) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const accent = asString(input.props.accentColor, input.spec.style.tokens.primary);
  const enter = spring({frame, fps, config: {damping: 20, stiffness: 110}});
  const cards = [
    {index: '01', title: asString(input.props.leftTitle), body: asString(input.props.leftBody), tint: accent},
    {index: '02', title: asString(input.props.rightTitle), body: asString(input.props.rightBody), tint: input.spec.style.tokens.accent},
  ];
  return (
    <SceneShell {...input} accent={accent}>
      <div style={{position: 'absolute', inset: '120px 108px 116px', display: 'grid', gridTemplateRows: 'auto 1fr', gap: 42}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'end'}}>
          <div>
            <div style={{fontSize: 19, color: accent, letterSpacing: 4, fontWeight: 850, marginBottom: 17}}>{asString(input.props.kicker)}</div>
            <h2 style={{margin: 0, fontSize: 79, letterSpacing: -3, lineHeight: 1}}>{asString(input.props.title)}</h2>
          </div>
          <div style={{display: 'flex', gap: 12}}>{asStrings(input.props.tags).map((tag, index) => <span key={tag} style={{padding: '12px 18px', borderRadius: 999, border: `1px solid ${index === 1 ? input.spec.style.tokens.accent : accent}66`, color: input.spec.style.tokens.text, fontSize: 17, background: 'rgba(255,255,255,.035)'}}>{tag}</span>)}</div>
        </div>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 26}}>
          {cards.map((card, index) => {
            const local = interpolate(enter, [0, 1], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
            return <div key={card.index} style={{position: 'relative', borderRadius: input.spec.style.tokens.radius, padding: '52px 54px', border: `1px solid ${card.tint}48`, background: `linear-gradient(145deg, ${card.tint}17, rgba(16,36,58,.72))`, overflow: 'hidden', transform: `translateX(${(1 - local) * (index ? 70 : -70)}px)`, opacity: local}}>
              <div style={{position: 'absolute', width: 240, height: 240, borderRadius: '50%', border: `50px solid ${card.tint}0D`, right: -56, top: -62}} />
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <span style={{fontSize: 18, letterSpacing: 3, color: card.tint}}>LAYER {card.index}</span>
                <span style={{fontSize: 38, color: card.tint}}>↗</span>
              </div>
              <h3 style={{fontSize: 55, margin: '88px 0 24px', letterSpacing: -1.5}}>{card.title}</h3>
              <p style={{fontSize: 29, lineHeight: 1.58, color: input.spec.style.tokens.muted, whiteSpace: 'pre-line', margin: 0}}>{card.body}</p>
              <div style={{position: 'absolute', bottom: 0, left: 0, height: 7, width: `${Math.min(100, Math.max(0, frame / input.durationInFrames * 120))}%`, background: card.tint}} />
            </div>;
          })}
        </div>
      </div>
    </SceneShell>
  );
}

