import type {EditScene, StoryScene, VideoSpec} from './schema';

const storyScenes: StoryScene[] = [
  {
    id: 'scene-01',
    purpose: '用一个直觉问题建立注意力机制的必要性',
    narration: '一句话很长时，模型怎么知道此刻最该关注哪个词？Transformer 的答案，是让每个词主动寻找与自己最相关的信息。',
    visualIntent: '大标题从深色空间中浮现，词语节点建立连接',
    evidenceRefs: ['Vaswani et al. 2017'],
    tempo: 'steady',
    mustShow: ['Transformer', '注意力机制'],
    mustAvoid: ['大段论文截图'],
    approvalState: 'approved',
  },
  {
    id: 'scene-02',
    purpose: '解释 Query、Key、Value 三个角色',
    narration: '每个词生成三份表示：Query 是我在找什么，Key 是我能被怎样匹配，Value 是我真正携带的信息。',
    visualIntent: '三列结构卡片并排展示 Q K V',
    evidenceRefs: ['Attention Is All You Need §3.2.1'],
    tempo: 'steady',
    mustShow: ['Query', 'Key', 'Value'],
    mustAvoid: ['过度拟人化'],
    approvalState: 'approved',
  },
  {
    id: 'scene-03',
    purpose: '展示点积得到相关性分数',
    narration: 'Query 与所有 Key 做点积，分数越高，代表两个词在当前上下文中越相关。缩放能够避免数值过大。',
    visualIntent: '柱形分数逐项增长，最高项被强调',
    evidenceRefs: ['Scaled Dot-Product Attention'],
    tempo: 'steady',
    mustShow: ['QKᵀ', '缩放'],
    mustAvoid: ['无含义随机数字'],
    approvalState: 'approved',
  },
  {
    id: 'scene-04',
    purpose: '解释 Softmax 权重归一化',
    narration: 'Softmax 把这些分数变成总和为一的权重。它不是简单选出一个词，而是决定每条信息应该占多少比例。',
    visualIntent: '分数转成概率折线与百分比卡片',
    evidenceRefs: ['Softmax normalization'],
    tempo: 'steady',
    mustShow: ['Softmax', 'Σ = 1'],
    mustAvoid: ['坐标轴缺失'],
    approvalState: 'approved',
  },
  {
    id: 'scene-05',
    purpose: '展示加权汇聚与多头注意力',
    narration: '权重乘上对应的 Value 再求和，就得到融合上下文的新表示。多头注意力会并行观察语义、语法和位置等不同关系。',
    visualIntent: '左右分屏：单头汇聚与多头并行',
    evidenceRefs: ['Multi-Head Attention'],
    tempo: 'fast',
    mustShow: ['加权求和', 'Multi-Head'],
    mustAvoid: ['声称每个头固定负责某种关系'],
    approvalState: 'approved',
  },
  {
    id: 'scene-06',
    purpose: '用完整公式收束并给出心智模型',
    narration: '所以注意力机制的核心只有三步：计算相关性，归一化权重，汇聚信息。它让上下文中的每个词，都能动态选择自己的信息来源。',
    visualIntent: '公式与三步总结依次高亮，形成结尾记忆点',
    evidenceRefs: ['Attention(Q,K,V) formula'],
    tempo: 'calm',
    mustShow: ['Attention(Q,K,V)', '相关性 → 权重 → 汇聚'],
    mustAvoid: ['突然结束'],
    approvalState: 'approved',
  },
];

const editScenes: EditScene[] = [
  scene('scene-01', 0, 270, 'TextHero', {
    eyebrow: 'πCut · 60 秒理解',
    title: 'Transformer\n如何「注意」？',
    subtitle: '让每个词动态选择信息来源',
    metric: 'ATTENTION / 01',
  }),
  scene('scene-02', 270, 300, 'SplitScreen', {
    kicker: 'THE THREE ROLES',
    title: 'Q · K · V',
    leftTitle: 'Query / Key',
    leftBody: '我在找什么？\n我能被怎样匹配？',
    rightTitle: 'Value',
    rightBody: '匹配成功后\n真正取走的信息',
    tags: ['检索', '匹配', '内容'],
  }),
  scene('scene-03', 570, 315, 'DynamicChart', {
    kicker: 'STEP 01 · RELEVANCE',
    title: '点积，得到相关性',
    chartType: 'bar',
    labels: ['它', '追逐', '小猫', '因为', '很快'],
    values: [24, 48, 92, 18, 63],
    unit: '%',
    highlightIndex: 2,
    formula: 'score = QKᵀ / √dₖ',
  }),
  scene('scene-04', 885, 300, 'DynamicChart', {
    kicker: 'STEP 02 · NORMALIZE',
    title: 'Softmax，变成权重',
    chartType: 'line',
    labels: ['它', '追逐', '小猫', '因为', '很快'],
    values: [6, 13, 54, 5, 22],
    unit: '%',
    highlightIndex: 2,
    formula: 'softmax(score) · Σw = 1',
  }),
  scene('scene-05', 1185, 330, 'SplitScreen', {
    kicker: 'STEP 03 · AGGREGATE',
    title: '多头，并行看世界',
    leftTitle: '单头注意力',
    leftBody: 'Σ attentionᵢ · Valueᵢ\n汇聚一个上下文表示',
    rightTitle: 'Multi-Head',
    rightBody: '多个关系空间并行计算\n再拼接成更丰富的表示',
    tags: ['语义', '语法', '位置'],
  }),
  scene('scene-06', 1515, 285, 'CaptionKaraoke', {
    kicker: 'ONE FORMULA · THREE MOVES',
    title: 'Attention(Q, K, V)',
    formula: 'softmax(QKᵀ / √dₖ)V',
    words: ['计算相关性', '归一化权重', '汇聚信息'],
    footer: '每个词，动态选择自己的信息来源。',
  }),
];

function scene(
  id: string,
  startFrame: number,
  durationFrames: number,
  component: EditScene['component'],
  props: Record<string, unknown>,
): EditScene {
  return {
    id,
    trackId: 'video-main',
    startFrame,
    durationFrames,
    sourceStartFrame: 0,
    playbackRate: 1,
    backend: 'either',
    component,
    props,
    animation: {preset: 'rise', enterFrames: 18, exitFrames: 12},
    layout: {safeAreaPct: 6, align: 'left'},
    transform: {x: 0, y: 0, scale: 1, rotation: 0, opacity: 1},
    transition: {in: 'fade', out: 'fade', durationFrames: 12},
    keyframes: [],
    effects: [],
    locks: {owner: 'shared', fields: [], locked: false},
    origin: {actor: 'agent', changeSetId: 'bootstrap'},
  };
}

function defaultTracks(): VideoSpec['editSpec']['tracks'] {
  return [
    {id: 'video-overlay', kind: 'overlay', name: 'V2 · Overlay', order: 0, visible: true, muted: false, solo: false, locked: false, gainDb: 0},
    {id: 'video-main', kind: 'video', name: 'V1 · Main', order: 1, visible: true, muted: false, solo: false, locked: false, gainDb: 0},
    {id: 'caption-main', kind: 'caption', name: 'C1 · Captions', order: 2, visible: true, muted: false, solo: false, locked: false, gainDb: 0},
    {id: 'audio-narration', kind: 'audio', name: 'A1 · Narration', order: 3, visible: true, muted: false, solo: false, locked: false, gainDb: 0},
    {id: 'audio-music', kind: 'audio', name: 'A2 · Music', order: 4, visible: true, muted: false, solo: false, locked: false, gainDb: -18},
  ];
}

export function createDefaultVideoSpec(projectId = 'transformer-60s'): VideoSpec {
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0.0',
    revision: 0,
    project: {
      id: projectId,
      title: '60 秒理解 Transformer 注意力机制',
      targetDurationMs: 60_000,
      renderSeed: 314159,
    },
    canvas: {width: 1920, height: 1080, fps: 30},
    style: {
      themeRef: 'orbital-editorial',
      tokens: {
        background: '#07111F',
        surface: '#10243A',
        primary: '#38E0C1',
        accent: '#FF8A5B',
        text: '#F3F8FC',
        muted: '#8DA7B8',
        fontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif',
        radius: 28,
      },
    },
    assets: [],
    storySpec: {
      logline: '用三步心智模型解释 Transformer 注意力机制。',
      audience: '希望快速理解 AI 基础概念的产品、技术与内容从业者',
      scenes: storyScenes,
    },
    editSpec: {
      tracks: defaultTracks(),
      scenes: editScenes,
      globalAudio: {
        narrationAssetId: null,
        narrationSegments: [],
        tts: {
          provider: 'siliconflow',
          model: 'fnlp/MOSS-TTSD-v0.5',
          voice: 'FunAudioLLM/CosyVoice2-0.5B:charles',
          speed: 1.08,
          gainDb: 0,
          responseFormat: 'wav',
          sampleRate: 44100,
        },
        bgmAssetId: null,
        bgmGainDb: -18,
      },
    },
    constraints: {maxDurationMs: 180_000, safeAreaPct: 6, loudnessTargetLUFS: -14},
    provenance: {
      createdBy: 'agent',
      createdAt: now,
      updatedAt: now,
      agentKernel: '@earendil-works/pi-coding-agent@0.84.2/AgentSession',
    },
  };
}

export function createPendingVideoSpec(projectId: string, brief: string, targetDurationMs = 30_000): VideoSpec {
  const now = new Date().toISOString();
  const durationMs = Math.max(100, Math.min(180_000, Math.round(targetDurationMs)));
  const durationFrames = Math.max(1, Math.round(durationMs / 1000 * 30));
  const summary = brief.trim().replaceAll(/\s+/g, ' ').slice(0, 120) || '新视频';
  return {
    schemaVersion: '1.0.0',
    revision: 0,
    project: {id: projectId, title: `${summary.slice(0, 28)} · 生成中`, targetDurationMs: durationMs, renderSeed: Math.abs([...projectId].reduce((seed, char) => (seed * 31 + char.charCodeAt(0)) | 0, 17))},
    canvas: {width: 1920, height: 1080, fps: 30},
    style: {
      themeRef: 'picut-generation-canvas',
      tokens: {
        background: '#071522', surface: '#102A3D', primary: '#62E5CB', accent: '#78B8FF',
        text: '#F5FAFD', muted: '#9CB5C3', fontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif', radius: 28,
      },
    },
    assets: [],
    storySpec: {
      logline: summary,
      audience: '由 Agent 从需求中规划',
      scenes: [{
        id: 'generation-canvas', purpose: '等待原生 Pi Agent 生成原创分镜', narration: '原生 Pi Agent 正在创建这条视频。',
        visualIntent: '仅用作生成期间的空白工作画布', evidenceRefs: [], tempo: 'steady', mustShow: [], mustAvoid: ['复用示例视频'], approvalState: 'draft',
      }],
    },
    editSpec: {
      tracks: defaultTracks(),
      scenes: [scene('generation-canvas', 0, durationFrames, 'TextHero', {
        eyebrow: 'π AGENT SESSION · PLANNING', title: '正在从零创建', subtitle: summary, metric: 'OBSERVE → TOOL → VALIDATE',
      })],
      globalAudio: {
        narrationAssetId: null, narrationSegments: [],
        tts: {provider: 'siliconflow', model: 'fnlp/MOSS-TTSD-v0.5', voice: 'FunAudioLLM/CosyVoice2-0.5B:charles', speed: 1.08, gainDb: 0, responseFormat: 'wav', sampleRate: 44100},
        bgmAssetId: null, bgmGainDb: -18,
      },
    },
    constraints: {maxDurationMs: Math.max(durationMs, 180_000), safeAreaPct: 6, loudnessTargetLUFS: -14},
    provenance: {createdBy: 'system', createdAt: now, updatedAt: now, agentKernel: '@earendil-works/pi-coding-agent@0.84.2/AgentSession · pending'},
  };
}
