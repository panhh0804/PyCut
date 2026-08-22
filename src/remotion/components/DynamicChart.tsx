import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {asNumber, asNumbers, asString, asStrings, SceneShell, type SceneComponentProps} from './SceneShell';

export function DynamicChart(input: SceneComponentProps) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const accent = asString(input.props.accentColor, input.spec.style.tokens.primary);
  const values = asNumbers(input.props.values);
  const labels = asStrings(input.props.labels);
  const highlightIndex = asNumber(input.props.highlightIndex, 0);
  const chartType = asString(input.props.chartType, 'bar');
  const progress = spring({frame: frame - 12, fps, config: {damping: 20, stiffness: 80}});
  const width = 1180;
  const height = 390;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => ({
    x: values.length === 1 ? width / 2 : (index / (values.length - 1)) * width,
    y: height - (value / max) * (height - 44) * progress,
  }));
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  return (
    <SceneShell {...input} accent={accent}>
      <div style={{position: 'absolute', inset: '118px 112px 110px'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'end'}}>
          <div>
            <div style={{fontSize: 19, color: accent, letterSpacing: 4, fontWeight: 850, marginBottom: 16}}>{asString(input.props.kicker)}</div>
            <h2 style={{fontSize: 74, margin: 0, letterSpacing: -2.8}}>{asString(input.props.title)}</h2>
          </div>
          <div style={{padding: '18px 26px', background: 'rgba(255,255,255,.04)', border: `1px solid ${accent}50`, borderRadius: 18, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: accent, fontSize: 25}}>{asString(input.props.formula)}</div>
        </div>
        <div style={{marginTop: 55, height: 530, borderRadius: 28, padding: '44px 52px 30px', background: 'rgba(16,36,58,.68)', border: '1px solid rgba(255,255,255,.08)', position: 'relative'}}>
          {[0, 1, 2, 3].map((line) => <div key={line} style={{position: 'absolute', left: 52, right: 52, top: 48 + line * 110, height: 1, background: 'rgba(141,167,184,.16)'}} />)}
          {chartType === 'line' ? (
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{display: 'block', margin: '0 auto', overflow: 'visible'}}>
              <defs><linearGradient id={`area-${input.sceneIndex}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={accent} stopOpacity=".36"/><stop offset="1" stopColor={accent} stopOpacity="0"/></linearGradient></defs>
              <path d={`${path} L ${width} ${height} L 0 ${height} Z`} fill={`url(#area-${input.sceneIndex})`} opacity={progress} />
              <path d={path} fill="none" stroke={accent} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress} />
              {points.map((point, index) => <g key={labels[index]} opacity={interpolate(progress, [.6, 1], [0, 1], {extrapolateLeft: 'clamp'})}><circle cx={point.x} cy={point.y} r={index === highlightIndex ? 15 : 10} fill={index === highlightIndex ? input.spec.style.tokens.accent : accent} /><text x={point.x} y={point.y - 28} textAnchor="middle" fill={input.spec.style.tokens.text} fontSize="24" fontWeight="800">{values[index]}%</text></g>)}
            </svg>
          ) : (
            <div style={{height, display: 'flex', alignItems: 'end', gap: 30, padding: '0 12px'}}>
              {values.map((value, index) => <div key={labels[index]} style={{flex: 1, height: `${(value / max) * 88 * progress}%`, minHeight: 4, borderRadius: '18px 18px 5px 5px', background: index === highlightIndex ? `linear-gradient(${input.spec.style.tokens.accent}, ${input.spec.style.tokens.accent}90)` : `linear-gradient(${accent}, ${accent}55)`, boxShadow: index === highlightIndex ? `0 0 50px ${input.spec.style.tokens.accent}50` : 'none', position: 'relative'}}><span style={{position: 'absolute', left: '50%', top: -42, transform: 'translateX(-50%)', fontSize: 24, fontWeight: 850}}>{Math.round(value * progress)}%</span></div>)}
            </div>
          )}
          <div style={{height: 55, display: 'flex', gap: 30, padding: '15px 12px 0'}}>{labels.map((label) => <span key={label} style={{flex: 1, textAlign: 'center', color: input.spec.style.tokens.muted, fontSize: 21}}>{label}</span>)}</div>
        </div>
      </div>
    </SceneShell>
  );
}

