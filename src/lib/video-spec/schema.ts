import {z} from 'zod';

export const COMPONENT_TYPES = [
  'TextHero',
  'SplitScreen',
  'DynamicChart',
  'CaptionKaraoke',
  'MediaBroll',
] as const;

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const optionalAccent = {accentColor: colorSchema.optional()};

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
