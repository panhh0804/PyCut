import type {VideoSpec} from '@/lib/video-spec/schema';
import type {RenderBackend} from './service';

export interface SceneRouteDecision {
  sceneId: string;
  preferred: RenderBackend;
  reason: string;
}

export interface RenderRouteDecision {
  requested: 'auto';
  selected: RenderBackend;
  confidence: number;
  scores: Record<RenderBackend, number>;
  reasons: string[];
  scenes: SceneRouteDecision[];
  fallback: RenderBackend;
  executed?: RenderBackend;
  fallbackApplied?: boolean;
  fallbackReason?: string;
}

export function routeRenderBackend(spec: VideoSpec): RenderRouteDecision {
  let remotion = 48;
  let hyperframes = 44;
  const reasons: string[] = [];
  const hasNarration = Boolean(spec.editSpec.globalAudio.narrationAssetId);
  const visibleScenes = spec.editSpec.scenes.filter((scene) => spec.editSpec.tracks.find((track) => track.id === scene.trackId)?.visible !== false);
  const overlays = visibleScenes.filter((scene) => spec.editSpec.tracks.find((track) => track.id === scene.trackId)?.kind === 'overlay').length;
  const keyframes = visibleScenes.reduce((sum, scene) => sum + scene.keyframes.length, 0);
  const mediaScenes = visibleScenes.filter((scene) => scene.component === 'MediaBroll' || scene.component === 'MediaClip').length;
  const chartScenes = visibleScenes.filter((scene) => scene.component === 'DynamicChart').length;
  const canvasScenes = visibleScenes.filter((scene) => scene.component === 'SceneCanvas');
  const canvasLayers = canvasScenes.flatMap((scene) => Array.isArray(scene.props.layers) ? scene.props.layers as Array<{type?: unknown}> : []);
  const canvasMediaLayers = canvasLayers.filter((layer) => layer.type === 'image' || layer.type === 'video').length;
  const canvasDataLayers = canvasLayers.filter((layer) => layer.type === 'chart').length;
  const canvasDomLayers = canvasLayers.filter((layer) => ['text', 'badge', 'metric', 'formula', 'code', 'shape', 'line', 'particles', 'svg', 'icon', 'gradientMesh', 'noise', 'group', 'mask', 'subComposition'].includes(String(layer.type))).length;
  const editorialScenes = visibleScenes.filter((scene) => ['TextHero', 'SplitScreen', 'CaptionKaraoke'].includes(scene.component)).length;

  if (hasNarration) {
    remotion += 18;
    reasons.push('已绑定分段旁白，Remotion 的帧级音画合成更稳定');
  } else {
    hyperframes += 5;
    reasons.push('无主旁白轨，HTML/GSAP 渲染没有音频复用负担');
  }
  if (mediaScenes) {
    remotion += mediaScenes * 7;
    reasons.push(`${mediaScenes} 个实拍 B-roll 镜头需要稳定的本地资产解码与逐帧运镜`);
  }
  if (chartScenes) {
    remotion += chartScenes * 8;
    reasons.push(`${chartScenes} 个动态图表更适合 Remotion 的确定性帧插值`);
  }
  if (canvasScenes.length) {
    remotion += canvasScenes.length * 3 + canvasMediaLayers * 5 + canvasDataLayers * 4;
    hyperframes += Math.min(18, canvasScenes.length * 2 + Math.round(canvasDomLayers / 4));
    reasons.push(`${canvasScenes.length} 个自由画布包含 ${canvasLayers.length} 个独立图层，双引擎均可原生表达`);
  }
  if (overlays) {
    remotion += overlays * 6;
    reasons.push(`${overlays} 个叠加轨镜头需要多轨合成与可见性控制`);
  }
  if (keyframes) {
    remotion += Math.min(16, keyframes);
    reasons.push(`${keyframes} 个关键帧需要与时间轴严格一致`);
  }
  if (editorialScenes === visibleScenes.length && !hasNarration && !overlays && !keyframes) {
    hyperframes += 20;
    reasons.push('全部为网页式排版镜头，HyperFrames 的 DOM/GSAP 编排成本更低');
  } else if (editorialScenes >= 3) {
    hyperframes += Math.min(12, editorialScenes * 2);
    reasons.push(`${editorialScenes} 个排版型镜头可由 HyperFrames 高效表达`);
  }
  if (spec.project.targetDurationMs <= 30_000 && !hasNarration) hyperframes += 6;

  const scenes = visibleScenes.map((scene): SceneRouteDecision => {
    if (scene.backend !== 'either') return {sceneId: scene.id, preferred: scene.backend, reason: `VideoSpec 将该镜头显式限定为 ${scene.backend}`};
    if (scene.component === 'SceneCanvas') {
      const layers = Array.isArray(scene.props.layers) ? scene.props.layers as Array<{type?: unknown}> : [];
      const frameHeavy = layers.some((layer) => ['image', 'video', 'chart', 'subComposition', 'noise'].includes(String(layer.type))) || scene.keyframes.length > 0;
      return frameHeavy
        ? {sceneId: scene.id, preferred: 'remotion', reason: `SceneCanvas 的 ${layers.length} 个图层包含媒体、图表或关键帧，需要逐帧插值`}
        : {sceneId: scene.id, preferred: 'hyperframes', reason: `SceneCanvas 的 ${layers.length} 个排版与图形图层适合 DOM/GSAP 编排`};
    }
    if (scene.component === 'MediaBroll' || scene.component === 'MediaClip' || scene.component === 'DynamicChart' || scene.keyframes.length || scene.trackId === 'video-overlay') {
      return {sceneId: scene.id, preferred: 'remotion', reason: `${scene.component} 需要逐帧媒体、图表或关键帧能力`};
    }
    return {sceneId: scene.id, preferred: 'hyperframes', reason: `${scene.component} 是网页排版型组件`};
  });
  const selected: RenderBackend = remotion >= hyperframes ? 'remotion' : 'hyperframes';
  const spread = Math.abs(remotion - hyperframes);
  return {
    requested: 'auto',
    selected,
    confidence: Math.min(0.98, Math.max(0.55, 0.55 + spread / Math.max(100, remotion + hyperframes))),
    scores: {remotion, hyperframes},
    reasons: reasons.slice(0, 5),
    scenes,
    fallback: selected === 'remotion' ? 'hyperframes' : 'remotion',
  };
}
