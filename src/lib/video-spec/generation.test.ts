import {describe, expect, it} from 'vitest';
import {videoSpecFromAgentPlan, type AgentVideoPlan} from './generation';
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
});
