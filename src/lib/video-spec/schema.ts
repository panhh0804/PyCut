import {z} from 'zod';

export const COMPONENT_TYPES = [
  'TextHero',
  'SplitScreen',
  'DynamicChart',
  'CaptionKaraoke',
  'MediaBroll',
  'MediaClip',
  'SceneCanvas',
] as const;

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const optionalAccent = {accentColor: colorSchema.optional()};

const sceneCanvasLayerSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-_]+$/),
  type: z.enum(['text', 'badge', 'metric', 'formula', 'code', 'shape', 'line', 'chart', 'image', 'video', 'particles', 'group', 'svg', 'mask', 'icon', 'gradientMesh', 'noise', 'subComposition']),
  x: z.number().min(-100).max(200),
  y: z.number().min(-100).max(200),
  width: z.number().min(0.1).max(200),
  height: z.number().min(0.1).max(200),
  zIndex: z.number().int().min(0).max(100).default(1),
  content: z.string().max(2_000).optional(),
  assetId: z.string().min(1).optional(),
  fit: z.enum(['cover', 'contain']).default('cover'),
  focalX: z.number().min(0).max(100).default(50),
  focalY: z.number().min(0).max(100).default(50),
  sourceStartFrame: z.number().int().nonnegative().default(0),
  playbackRate: z.number().min(0.1).max(5).default(1),
  volumeDb: z.number().min(-60).max(6).default(-60),
  loop: z.boolean().default(false),
  muted: z.boolean().default(true),
  labels: z.array(z.string().max(48)).max(12).optional(),
  values: z.array(z.number().finite()).max(12).optional(),
  chartType: z.enum(['bar', 'line', 'area', 'donut', 'scatter', 'timeline', 'network', 'flow', 'map']).default('bar'),
  memberIds: z.array(z.string().min(1)).max(24).default([]),
  path: z.string().max(8_000).optional(),
  viewBox: z.string().max(120).default('0 0 100 100'),
  icon: z.enum(['cloud', 'sun', 'droplet', 'arrow', 'check', 'sparkles', 'globe', 'atom', 'play']).optional(),
  maskShape: z.enum(['rounded', 'circle', 'diagonal', 'hexagon']).default('rounded'),
  style: z.object({
    color: colorSchema.optional(),
    backgroundColor: colorSchema.optional(),
    borderColor: colorSchema.optional(),
    fontSize: z.number().min(10).max(240).optional(),
    fontWeight: z.number().int().min(100).max(950).optional(),
    lineHeight: z.number().min(0.7).max(2.5).optional(),
    letterSpacing: z.number().min(-12).max(30).optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    radius: z.number().min(0).max(240).optional(),
    padding: z.number().min(0).max(120).optional(),
    borderWidth: z.number().min(0).max(16).optional(),
    opacity: z.number().min(0).max(1).optional(),
    rotation: z.number().min(-360).max(360).optional(),
    shadow: z.number().min(0).max(120).optional(),
    blur: z.number().min(0).max(60).optional(),
  }).default({}),
  motion: z.object({
    preset: z.enum(['none', 'fade', 'rise', 'slide-left', 'slide-right', 'scale', 'reveal', 'float', 'pulse', 'count', 'draw']),
    delayFrames: z.number().int().nonnegative().max(5_400).default(0),
    durationFrames: z.number().int().positive().max(1_800).default(18),
    intensity: z.number().min(0).max(4).default(1),
  }).default({preset: 'rise', delayFrames: 0, durationFrames: 18, intensity: 1}),
}).superRefine((layer, context) => {
  if ((layer.type === 'image' || layer.type === 'video') && !layer.assetId) context.addIssue({code: 'custom', path: ['assetId'], message: `${layer.type} 图层必须引用 assetId`});
  if ((layer.type === 'group' || layer.type === 'mask') && !layer.memberIds.length) context.addIssue({code: 'custom', path: ['memberIds'], message: `${layer.type} 必须引用至少一个成员图层`});
  if (layer.type === 'svg' && !layer.path) context.addIssue({code: 'custom', path: ['path'], message: 'svg 图层必须提供 path'});
  if (layer.type === 'icon' && !layer.icon) context.addIssue({code: 'custom', path: ['icon'], message: 'icon 图层必须选择受控图标'});
  if (layer.type === 'chart' && (!layer.labels?.length || layer.labels.length !== layer.values?.length)) {
    context.addIssue({code: 'custom', path: ['values'], message: 'chart 图层的 labels 与 values 必须存在且数量一致'});
  }
});

export const sceneCanvasPropsSchema = z.object({
  background: z.object({
    type: z.enum(['solid', 'linear', 'radial']),
    colors: z.array(colorSchema).min(1).max(4),
    angle: z.number().min(-360).max(360).default(135),
    focalX: z.number().min(0).max(100).default(50),
    focalY: z.number().min(0).max(100).default(50),
  }),
  texture: z.enum(['none', 'grid', 'dots', 'scanlines']).default('none'),
  camera: z.object({
    startScale: z.number().min(0.5).max(2).default(1),
    endScale: z.number().min(0.5).max(2).default(1),
    panX: z.number().min(-30).max(30).default(0),
    panY: z.number().min(-30).max(30).default(0),
  }).default({startScale: 1, endScale: 1, panX: 0, panY: 0}),
  layers: z.array(sceneCanvasLayerSchema).min(1).max(40),
  mediaQuery: z.string().min(2).max(180).optional(),
  ...optionalAccent,
}).superRefine((canvas, context) => {
  const ids = new Set<string>();
  canvas.layers.forEach((layer, index) => {
    if (ids.has(layer.id)) context.addIssue({code: 'custom', path: ['layers', index, 'id'], message: `图层 id 重复：${layer.id}`});
    ids.add(layer.id);
    if (['text', 'badge', 'metric', 'formula', 'code', 'chart'].includes(layer.type)
      && (layer.x < 0 || layer.y < 0 || layer.x + layer.width > 100 || layer.y + layer.height > 100)) {
      context.addIssue({code: 'custom', path: ['layers', index], message: `${layer.type} 内容图层必须完整位于 0–100% 可视画布内；只有装饰图层可进入出血区`});
    }
  });
  const layerIds = new Set(canvas.layers.map((layer) => layer.id));
  const claimed = new Set<string>();
  canvas.layers.forEach((layer, index) => {
    layer.memberIds.forEach((memberId) => {
      if (!layerIds.has(memberId)) context.addIssue({code: 'custom', path: ['layers', index, 'memberIds'], message: `${layer.id} 引用了不存在的成员 ${memberId}`});
      if (memberId === layer.id) context.addIssue({code: 'custom', path: ['layers', index, 'memberIds'], message: `${layer.id} 不能包含自身`});
      if (claimed.has(memberId)) context.addIssue({code: 'custom', path: ['layers', index, 'memberIds'], message: `${memberId} 不能同时属于多个 group/mask`});
      claimed.add(memberId);
    });
  });
});

export const componentPropsSchemas = {
  TextHero: z.object({
    eyebrow: z.string().min(1),
    title: z.string().min(1),
    subtitle: z.string().min(1),
    metric: z.string().optional(),
    ...optionalAccent,
  }).passthrough(),
  SplitScreen: z.object({
    kicker: z.string().min(1),
    title: z.string().min(1),
    leftTitle: z.string().min(1),
    leftBody: z.string().min(1),
    rightTitle: z.string().min(1),
    rightBody: z.string().min(1),
    tags: z.array(z.string().min(1)).max(8).default([]),
    ...optionalAccent,
  }).passthrough(),
  DynamicChart: z.object({
    kicker: z.string().min(1),
    title: z.string().min(1),
    chartType: z.enum(['bar', 'line']),
    labels: z.array(z.string().min(1)).min(1).max(12),
    values: z.array(z.number().finite()).min(1).max(12),
    unit: z.string().optional(),
    highlightIndex: z.number().int().nonnegative(),
    formula: z.string().min(1),
    ...optionalAccent,
  }).superRefine((props, context) => {
    if (props.labels.length !== props.values.length) {
      context.addIssue({code: 'custom', message: '图表 labels 与 values 数量必须一致'});
    }
    if (props.highlightIndex >= props.values.length) {
      context.addIssue({code: 'custom', message: 'highlightIndex 越界'});
    }
  }),
  CaptionKaraoke: z.object({
    kicker: z.string().min(1),
    title: z.string().min(1),
    formula: z.string().min(1),
    words: z.array(z.string().min(1)).min(1).max(8),
    footer: z.string().min(1),
    ...optionalAccent,
  }).passthrough(),
  MediaBroll: z.object({
    assetId: z.string().min(1),
    kicker: z.string().min(1),
    headline: z.string().min(1),
    caption: z.string().min(1),
    credit: z.string().min(1),
    focalX: z.number().min(0).max(100).default(50),
    focalY: z.number().min(0).max(100).default(50),
    ...optionalAccent,
  }).passthrough(),
  MediaClip: z.object({
    assetId: z.string().min(1),
    kicker: z.string().min(1),
    headline: z.string().min(1),
    caption: z.string().min(1),
    credit: z.string().min(1),
    fit: z.enum(['cover', 'contain']).default('cover'),
    focalX: z.number().min(0).max(100).default(50),
    focalY: z.number().min(0).max(100).default(50),
    sourceStartFrame: z.number().int().nonnegative().default(0),
    playbackRate: z.number().min(0.1).max(5).default(1),
    volumeDb: z.number().min(-60).max(6).default(-60),
    loop: z.boolean().default(false),
    muted: z.boolean().default(true),
    startScale: z.number().min(0.5).max(3).default(1.03),
    endScale: z.number().min(0.5).max(3).default(1.12),
    panX: z.number().min(-30).max(30).default(-2),
    panY: z.number().min(-30).max(30).default(0),
    mask: z.enum(['none', 'rounded', 'circle', 'diagonal']).default('none'),
    ...optionalAccent,
  }),
  SceneCanvas: sceneCanvasPropsSchema,
} satisfies Record<(typeof COMPONENT_TYPES)[number], z.ZodType>;

export const assetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['image', 'video', 'audio', 'font', 'data']),
  src: z.string().min(1),
  checksum: z.string().optional(),
  license: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  sourceUrl: z.string().url().optional(),
  attribution: z.string().optional(),
  retrievedAt: z.string().datetime().optional(),
});

export const narrationSegmentSchema = z.object({
  sceneId: z.string().min(1),
  assetId: z.string().min(1),
  trackId: z.string().min(1).default('audio-narration'),
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
  sourceDurationMs: z.number().positive(),
  renderedDurationMs: z.number().positive(),
  muted: z.boolean().default(false),
  gainDb: z.number().min(-60).max(12).default(0),
  playbackRate: z.number().min(0.25).max(4).default(1),
  waveform: z.array(z.number().min(0).max(1)).min(16).max(240),
});

export const ttsConfigSchema = z.object({
  provider: z.literal('siliconflow'),
  model: z.string().min(1),
  voice: z.string().min(1),
  speed: z.number().min(0.25).max(4),
  gainDb: z.number().min(-10).max(10),
  responseFormat: z.literal('wav'),
  sampleRate: z.literal(44100),
});

export const storySceneSchema = z.object({
  id: z.string().min(1),
  purpose: z.string().min(1),
  narration: z.string().min(1),
  visualIntent: z.string().min(1),
  evidenceRefs: z.array(z.string()).default([]),
  tempo: z.enum(['calm', 'steady', 'fast']),
  mustShow: z.array(z.string()).default([]),
  mustAvoid: z.array(z.string()).default([]),
  approvalState: z.enum(['draft', 'approved', 'rejected']).default('draft'),
});

export const timelineTrackSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['video', 'audio', 'caption', 'overlay']),
  name: z.string().min(1),
  order: z.number().int().nonnegative(),
  visible: z.boolean().default(true),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  locked: z.boolean().default(false),
  gainDb: z.number().min(-60).max(12).default(0),
});

const keyframeSchema = z.object({
  frame: z.number().int().nonnegative(),
  property: z.enum(['x', 'y', 'scale', 'rotation', 'opacity', 'volumeDb']),
  value: z.number().finite(),
  easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'spring']).default('ease-in-out'),
});

const effectSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['blur', 'brightness', 'contrast', 'saturate', 'hue-rotate', 'drop-shadow']),
  enabled: z.boolean().default(true),
  amount: z.number().finite(),
});

export const editSceneSchema = z.object({
  id: z.string().min(1),
  trackId: z.string().min(1).default('video-main'),
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
  sourceStartFrame: z.number().int().nonnegative().default(0),
  playbackRate: z.number().min(0.25).max(4).default(1),
  backend: z.enum(['remotion', 'hyperframes', 'either']),
  component: z.enum(COMPONENT_TYPES),
  props: z.record(z.string(), z.unknown()),
  animation: z.object({
    preset: z.enum(['fade', 'rise', 'spring', 'draw', 'none']),
    enterFrames: z.number().int().nonnegative(),
    exitFrames: z.number().int().nonnegative(),
  }),
  layout: z.object({
    safeAreaPct: z.number().min(0).max(20),
    align: z.enum(['left', 'center', 'right']),
  }),
  transform: z.object({
    x: z.number().finite().default(0),
    y: z.number().finite().default(0),
    scale: z.number().min(0.05).max(10).default(1),
    rotation: z.number().min(-360).max(360).default(0),
    opacity: z.number().min(0).max(1).default(1),
  }).default({x: 0, y: 0, scale: 1, rotation: 0, opacity: 1}),
  transition: z.object({
    in: z.enum(['none', 'fade', 'wipe', 'slide']).default('fade'),
    out: z.enum(['none', 'fade', 'wipe', 'slide']).default('fade'),
    durationFrames: z.number().int().nonnegative().max(90).default(12),
  }).default({in: 'fade', out: 'fade', durationFrames: 12}),
  keyframes: z.array(keyframeSchema).max(200).default([]),
  effects: z.array(effectSchema).max(16).default([]),
  locks: z.object({
    owner: z.enum(['agent', 'shared', 'human']),
    fields: z.array(z.string()),
    locked: z.boolean(),
  }),
  origin: z.object({
    actor: z.enum(['agent', 'human', 'system']),
    changeSetId: z.string(),
  }),
});

export const videoSpecSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  revision: z.number().int().nonnegative(),
  project: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    targetDurationMs: z.number().int().positive().max(180_000),
    renderSeed: z.number().int().nonnegative(),
  }),
  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]),
  }),
  style: z.object({
    themeRef: z.string().min(1),
    tokens: z.object({
      background: colorSchema,
      surface: colorSchema,
      primary: colorSchema,
      accent: colorSchema,
      text: colorSchema,
      muted: colorSchema,
      fontFamily: z.string().min(1),
      radius: z.number().min(0).max(96),
    }),
  }),
  assets: z.array(assetSchema),
  storySpec: z.object({
    logline: z.string().min(1),
    audience: z.string().min(1),
    scenes: z.array(storySceneSchema).min(1).max(12),
  }),
  editSpec: z.object({
    tracks: z.array(timelineTrackSchema).min(1).max(24).default([
      {id: 'video-overlay', kind: 'overlay', name: 'V2 · Overlay', order: 0, visible: true, muted: false, solo: false, locked: false, gainDb: 0},
      {id: 'video-main', kind: 'video', name: 'V1 · Main', order: 1, visible: true, muted: false, solo: false, locked: false, gainDb: 0},
      {id: 'caption-main', kind: 'caption', name: 'C1 · Captions', order: 2, visible: true, muted: false, solo: false, locked: false, gainDb: 0},
      {id: 'audio-narration', kind: 'audio', name: 'A1 · Narration', order: 3, visible: true, muted: false, solo: false, locked: false, gainDb: 0},
      {id: 'audio-music', kind: 'audio', name: 'A2 · Music', order: 4, visible: true, muted: false, solo: false, locked: false, gainDb: -18},
    ]),
    scenes: z.array(editSceneSchema).min(1).max(12),
    globalAudio: z.object({
      narrationAssetId: z.string().nullable(),
      narrationSegments: z.array(narrationSegmentSchema).default([]),
      tts: ttsConfigSchema.default({
        provider: 'siliconflow',
        model: 'fnlp/MOSS-TTSD-v0.5',
        voice: 'FunAudioLLM/CosyVoice2-0.5B:charles',
        speed: 1.08,
        gainDb: 0,
        responseFormat: 'wav',
        sampleRate: 44100,
      }),
      bgmAssetId: z.string().nullable(),
      bgmGainDb: z.number().min(-60).max(6),
      bgmMuted: z.boolean().default(false),
    }),
  }),
  constraints: z.object({
    maxDurationMs: z.number().int().positive().max(180_000),
    safeAreaPct: z.number().min(0).max(20),
    loudnessTargetLUFS: z.number().min(-30).max(-5),
  }),
  provenance: z.object({
    createdBy: z.enum(['agent', 'human', 'system']),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    agentKernel: z.string().min(1),
  }),
});

export const patchOperationSchema = z.object({
  op: z.enum(['add', 'replace', 'remove']),
  path: z.string().startsWith('/'),
  value: z.unknown().optional(),
});

export const changeSetSchema = z.object({
  changeSetId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  actor: z.enum(['agent', 'human']),
  intent: z.string().min(1),
  risk: z.enum(['low', 'medium', 'high']),
  patch: z.array(patchOperationSchema).min(1),
  createdAt: z.string().datetime(),
  approval: z.enum(['not-required', 'pending', 'approved', 'rejected']),
});

export type VideoSpec = z.infer<typeof videoSpecSchema>;
export type StoryScene = z.infer<typeof storySceneSchema>;
export type EditScene = z.infer<typeof editSceneSchema>;
export type ChangeSet = z.infer<typeof changeSetSchema>;
export type PatchOperation = z.infer<typeof patchOperationSchema>;
export type ComponentType = (typeof COMPONENT_TYPES)[number];
export type NarrationSegment = z.infer<typeof narrationSegmentSchema>;
export type TtsConfig = z.infer<typeof ttsConfigSchema>;
export type TimelineTrack = z.infer<typeof timelineTrackSchema>;
export type SceneCanvasProps = z.infer<typeof sceneCanvasPropsSchema>;
