import {describe, expect, it} from 'vitest';
import {videoSpecFromAgentPlan, type AgentVideoPlan} from './generation';
import {compileVideoSpec} from './compiler';
import {validateVideoSpec} from './validation';

const plan: AgentVideoPlan = {
  title: '九秒看懂海底热液喷口',
  logline: '跟随深海热流理解黑烟囱生态。',
  audience: '对深海科学好奇的普通观众',
  durationSeconds: 9,
  theme: 'nature',
  scenes: [
    {purpose: '建立深海环境', narration: '阳光无法抵达的海底，热水正从地壳裂缝喷出。', visualIntent: '真实深海喷口素材缓慢推进', tempo: 'steady', durationSeconds: 3, visualType: 'media', kicker: 'ABYSS · 01', headline: '海底也有热泉', body: '高温流体冲入冰冷海水', mediaQuery: 'hydrothermal vent black smoker deep sea'},
    {purpose: '解释黑烟形成', narration: '矿物遇冷析出，堆成像烟囱一样的结构。', visualIntent: '左右结构卡解释温差与矿物', tempo: 'fast', durationSeconds: 3, visualType: 'split', kicker: 'MINERAL · 02', headline: '黑烟不是烟', body: '热流携带矿物', secondaryTitle: '遇冷析出', secondaryBody: '颗粒让水柱看起来像黑烟', tags: ['热流', '矿物', '析出']},
    {purpose: '收束生态意义', narration: '没有阳光，生命仍靠化学能在这里繁盛。', visualIntent: '关键词逐项高亮收束', tempo: 'calm', durationSeconds: 3, visualType: 'caption', kicker: 'LIFE · 03', headline: '黑暗里的生命绿洲', body: '化学能 → 微生物 → 独特生态', tags: ['化学能', '微生物', '生命绿洲']},
  ],
};

describe('π Agent plan to VideoSpec', () => {
  it('uses the current plan content and obeys the explicit brief duration', () => {
    const spec = videoSpecFromAgentPlan('vent-7s', '生成一个7秒海底热液喷口科普视频', plan);
    expect(spec.project.title).toBe(plan.title);
    expect(spec.project.targetDurationMs).toBe(7000);
    expect(spec.storySpec.scenes.map((scene) => scene.purpose)).toEqual(plan.scenes.map((scene) => scene.purpose));
    expect(spec.storySpec.scenes.some((scene) => /Transformer|云朵/.test(scene.narration))).toBe(false);
    expect(spec.editSpec.scenes[0].props.mediaQuery).toBe('hydrothermal vent black smoker deep sea');
    expect(spec.editSpec.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0)).toBe(210);
    expect(validateVideoSpec(spec).valid).toBe(true);
  });

  it('preserves a model-authored free canvas instead of collapsing it into a card template', () => {
    const canvasPlan: AgentVideoPlan = {
      title: '十二秒看懂极光',
      logline: '用空间尺度和粒子运动解释极光。',
      audience: '普通科普观众',
      durationSeconds: 12,
      theme: 'science',
      style: {background: '#020713', primary: '#6EFBCE', accent: '#B58CFF', text: '#F7FBFF', radius: 26},
      scenes: [{
        purpose: '建立太阳风与磁场关系', narration: '带电粒子沿着地球磁场冲向两极。', visualIntent: '斜向磁力线穿过空间，标题悬浮在左上角', tempo: 'fast', durationSeconds: 12,
        visualType: 'canvas', kicker: 'AURORA · FIELD', headline: '天空为什么会发光？', body: '太阳风 × 地球磁场', mediaQuery: 'aurora borealis real footage night sky',
        canvas: {
          background: {type: 'radial', colors: ['#020713', '#123552'], focalX: 76, focalY: 22}, texture: 'dots',
          camera: {startScale: 1, endScale: 1.06, panX: -2, panY: 1},
          layers: [
            {id: 'title', type: 'text', x: 7, y: 10, width: 58, height: 26, content: '天空为什么会发光？', style: {fontSize: 82, fontWeight: 900, color: '#F7FBFF'}, motion: {preset: 'rise', delayFrames: 4}},
            {id: 'field', type: 'line', x: 18, y: 52, width: 68, height: 3, style: {color: '#6EFBCE', borderWidth: 4}, motion: {preset: 'draw'}},
            {id: 'particles', type: 'particles', x: 52, y: 18, width: 42, height: 62, content: '24', style: {color: '#B58CFF'}},
          ],
        },
      }],
    };
    const spec = videoSpecFromAgentPlan('aurora-free-canvas', '生成一个12秒极光科普视频', canvasPlan);
    const compiled = compileVideoSpec(spec);
    expect(spec.editSpec.scenes[0].component).toBe('SceneCanvas');
    expect(spec.editSpec.scenes[0].props.mediaQuery).toBe('aurora borealis real footage night sky');
    expect(spec.style.tokens.primary).toBe('#6EFBCE');
    expect((compiled.scenes[0].props.layers as Array<{id: string; motion: {durationFrames: number}}>)[0].motion.durationFrames).toBe(18);
    expect(validateVideoSpec(spec).valid).toBe(true);
  });
});
