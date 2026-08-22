import {createHash} from 'node:crypto';
import {videoSpecSchema, type EditScene, type StoryScene, type VideoSpec} from './schema';
import {VIDEO_THEME_PRESETS} from './themes';

export type AgentVisualType = 'hero' | 'split' | 'chart' | 'caption' | 'media';

export interface AgentScenePlan {
  purpose: string;
  narration: string;
  visualIntent: string;
  tempo: 'calm' | 'steady' | 'fast';
  durationSeconds: number;
  visualType: AgentVisualType;
  kicker: string;
  headline: string;
  body: string;
  secondaryTitle?: string;
  secondaryBody?: string;
  tags?: string[];
  metric?: string;
  formula?: string;
  chartLabels?: string[];
  chartValues?: number[];
  mediaQuery?: string;
  evidenceRefs?: string[];
  mustShow?: string[];
  mustAvoid?: string[];
}

export interface AgentVideoPlan {
  title: string;
  logline: string;
  audience: string;
  durationSeconds: number;
  theme: 'editorial' | 'science' | 'nature' | 'warm' | 'neon' | 'minimal';
  scenes: AgentScenePlan[];
}

function tracks(): VideoSpec['editSpec']['tracks'] {
  return [
    {id: 'video-overlay', kind: 'overlay', name: 'V2 · Overlay', order: 0, visible: true, muted: false, solo: false, locked: false, gainDb: 0},
    {id: 'video-main', kind: 'video', name: 'V1 · Main', order: 1, visible: true, muted: false, solo: false, locked: false, gainDb: 0},
    {id: 'caption-main', kind: 'caption', name: 'C1 · Captions', order: 2, visible: true, muted: false, solo: false, locked: false, gainDb: 0},
    {id: 'audio-narration', kind: 'audio', name: 'A1 · Narration', order: 3, visible: true, muted: false, solo: false, locked: false, gainDb: 0},
    {id: 'audio-music', kind: 'audio', name: 'A2 · Music', order: 4, visible: true, muted: false, solo: false, locked: false, gainDb: -18},
  ];
}

function requestedDuration(brief: string, proposed: number) {
  const explicit = brief.match(/(\d+(?:\.\d+)?)\s*(?:秒|s(?:ec(?:ond)?s?)?)/i)?.[1];
  return Math.min(180, Math.max(0.1, Number(explicit ?? proposed)));
}

function normalizedDurations(scenes: AgentScenePlan[], targetFrames: number, fps: number) {
  const minimum = Math.max(1, Math.round(fps * 0.1));
  const usable = scenes.slice(0, Math.max(1, Math.min(12, Math.floor(targetFrames / minimum))));
  const weights = usable.map((scene) => Number.isFinite(scene.durationSeconds) ? Math.max(0.1, scene.durationSeconds) : 1);
  const distributable = Math.max(0, targetFrames - minimum * usable.length);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || usable.length;
  const durations = weights.map((weight) => minimum + Math.floor(distributable * weight / totalWeight));
  let remainder = targetFrames - durations.reduce((sum, duration) => sum + duration, 0);
  let cursor = 0;
  while (remainder > 0) {
    durations[cursor % durations.length] += 1;
    cursor += 1;
    remainder -= 1;
  }
  return {scenes: usable, durations};
}

function safeText(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function componentFor(scene: AgentScenePlan, accentColor: string): Pick<EditScene, 'component' | 'props'> {
  const tags = (scene.tags ?? []).filter(Boolean).slice(0, 8);
  if (scene.visualType === 'chart') {
    const labels = (scene.chartLabels ?? []).filter(Boolean).slice(0, 12);
    const values = (scene.chartValues ?? []).filter(Number.isFinite).slice(0, 12);
    if (labels.length > 0 && labels.length === values.length) {
      const maximum = Math.max(...values);
      return {
        component: 'DynamicChart',
        props: {
          kicker: scene.kicker,
          title: scene.headline,
          chartType: values.length > 5 ? 'line' : 'bar',
          labels,
          values,
          unit: '',
          highlightIndex: Math.max(0, values.indexOf(maximum)),
          formula: safeText(scene.formula, scene.body),
          accentColor,
        },
      };
    }
  }
  if (scene.visualType === 'split' || scene.visualType === 'chart') {
    return {
      component: 'SplitScreen',
      props: {
        kicker: scene.kicker,
        title: scene.headline,
        leftTitle: safeText(tags[0], scene.headline),
        leftBody: scene.body,
        rightTitle: safeText(scene.secondaryTitle, tags[1] ?? scene.kicker),
        rightBody: safeText(scene.secondaryBody, scene.visualIntent),
        tags,
        accentColor,
      },
    };
  }
  if (scene.visualType === 'caption') {
    const words = tags.length ? tags : scene.mustShow?.slice(0, 8) ?? [scene.headline];
    return {
      component: 'CaptionKaraoke',
      props: {
        kicker: scene.kicker,
        title: scene.headline,
        formula: safeText(scene.formula, scene.body),
        words,
        footer: scene.body,
        accentColor,
      },
    };
  }
  return {
    component: 'TextHero',
    props: {
      eyebrow: scene.kicker,
      title: scene.headline,
      subtitle: scene.body,
      metric: scene.metric,
      mediaQuery: scene.visualType === 'media' ? scene.mediaQuery : undefined,
      accentColor,
    },
  };
}

export function videoSpecFromAgentPlan(projectId: string, brief: string, plan: AgentVideoPlan): VideoSpec {
  const fps = 30;
  const durationSeconds = requestedDuration(brief, plan.durationSeconds);
  const targetFrames = Math.max(1, Math.round(durationSeconds * fps));
  if (!plan.scenes.length) throw new Error('π Agent 没有生成任何分镜，已拒绝创建空视频');
  const normalized = normalizedDurations(plan.scenes, targetFrames, fps);
  const tokens = VIDEO_THEME_PRESETS[plan.theme]?.tokens ?? VIDEO_THEME_PRESETS.editorial.tokens;
  let startFrame = 0;
  const storyScenes: StoryScene[] = [];
  const editScenes: EditScene[] = [];
  normalized.scenes.forEach((scenePlan, index) => {
    const id = `scene-${String(index + 1).padStart(2, '0')}`;
    const durationFrames = normalized.durations[index];
    const mapped = componentFor(scenePlan, tokens.primary);
    storyScenes.push({
      id,
      purpose: scenePlan.purpose,
      narration: scenePlan.narration,
      visualIntent: scenePlan.visualIntent,
      evidenceRefs: (scenePlan.evidenceRefs ?? []).filter(Boolean),
      tempo: scenePlan.tempo,
      mustShow: (scenePlan.mustShow ?? []).filter(Boolean),
      mustAvoid: (scenePlan.mustAvoid ?? []).filter(Boolean),
      approvalState: 'approved',
    });
    const transitionFrames = Math.min(Math.max(0, Math.round(durationFrames * 0.12)), Math.round(fps * 0.4));
    editScenes.push({
      id,
      trackId: 'video-main',
      startFrame,
      durationFrames,
      sourceStartFrame: 0,
      playbackRate: 1,
      backend: scenePlan.visualType === 'media' ? 'remotion' : 'either',
      component: mapped.component,
      props: mapped.props,
      animation: {preset: scenePlan.tempo === 'fast' ? 'spring' : scenePlan.visualType === 'chart' ? 'draw' : 'rise', enterFrames: transitionFrames, exitFrames: transitionFrames},
      layout: {safeAreaPct: 6, align: 'left'},
      transform: {x: 0, y: 0, scale: 1, rotation: 0, opacity: 1},
      transition: {in: index === 0 ? 'fade' : scenePlan.tempo === 'fast' ? 'slide' : 'wipe', out: index === normalized.scenes.length - 1 ? 'fade' : 'none', durationFrames: transitionFrames},
      keyframes: [],
      effects: scenePlan.visualType === 'media' ? [{id: `fx-${id}-saturate`, type: 'saturate', enabled: true, amount: 1.08}] : [],
      locks: {owner: 'shared', fields: [], locked: false},
      origin: {actor: 'agent', changeSetId: 'pi-agent-create'},
    });
    startFrame += durationFrames;
  });
  const now = new Date().toISOString();
  const seed = Number.parseInt(createHash('sha256').update(`${projectId}\n${brief}\n${plan.title}`).digest('hex').slice(0, 8), 16);
  return videoSpecSchema.parse({
    schemaVersion: '1.0.0',
    revision: 0,
    project: {id: projectId, title: plan.title.trim(), targetDurationMs: Math.round(targetFrames / fps * 1000), renderSeed: seed},
    canvas: {width: 1920, height: 1080, fps},
    style: {themeRef: `pi-agent-${plan.theme}`, tokens},
    assets: [],
    storySpec: {logline: plan.logline.trim(), audience: plan.audience.trim(), scenes: storyScenes},
    editSpec: {
      tracks: tracks(),
      scenes: editScenes,
      globalAudio: {
        narrationAssetId: null,
        narrationSegments: [],
        tts: {provider: 'siliconflow', model: 'fnlp/MOSS-TTSD-v0.5', voice: 'FunAudioLLM/CosyVoice2-0.5B:claire', speed: 1.04, gainDb: 0, responseFormat: 'wav', sampleRate: 44100},
        bgmAssetId: null,
        bgmGainDb: -18,
      },
    },
    constraints: {maxDurationMs: Math.max(100, Math.round(targetFrames / fps * 1000)), safeAreaPct: 6, loudnessTargetLUFS: -14},
    provenance: {createdBy: 'agent', createdAt: now, updatedAt: now, agentKernel: '@earendil-works/pi-agent-core@0.84.2 · native-tool-plan'},
  });
}
