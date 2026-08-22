import {z} from 'zod';

export const COMPONENT_TYPES = [
  'TextHero',
  'SplitScreen',
  'DynamicChart',
  'CaptionKaraoke',
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
} satisfies Record<(typeof COMPONENT_TYPES)[number], z.ZodType>;

export const assetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['image', 'video', 'audio', 'font', 'data']),
  src: z.string().min(1),
  checksum: z.string().optional(),
  license: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
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

export const editSceneSchema = z.object({
  id: z.string().min(1),
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
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
    scenes: z.array(editSceneSchema).min(1).max(12),
    globalAudio: z.object({
      narrationAssetId: z.string().nullable(),
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
