import {createHash} from 'node:crypto';
import {COMPONENT_TYPES, componentPropsSchemas, videoSpecSchema, type SceneCanvasProps, type VideoSpec} from './schema';

export type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7';
export type GateStatus = 'pass' | 'warn' | 'fail';
export interface GateResult {
  id: GateId;
  name: string;
  status: GateStatus;
  summary: string;
  details: string[];
}
export interface ValidationReport {
  valid: boolean;
  revision: number;
  checkedAt: string;
  digest: string;
  gates: GateResult[];
}

const gate = (id: GateId, name: string, details: string[], warnings: string[] = []): GateResult => ({
  id,
  name,
  status: details.length ? 'fail' : warnings.length ? 'warn' : 'pass',
  summary: details.length ? `${details.length} 项阻断问题` : warnings.length ? `${warnings.length} 项提醒` : '通过',
  details: details.length ? details : warnings,
});

const textLayerTypes = new Set(['text', 'badge', 'metric', 'formula', 'code']);
const decorativeLayerTypes = new Set(['shape', 'line', 'particles', 'gradientMesh', 'noise']);
const semanticVisualTypes = new Set(['image', 'video', 'chart', 'metric', 'formula', 'code', 'svg', 'icon', 'subComposition']);

function overlapRatio(left: SceneCanvasProps['layers'][number], right: SceneCanvasProps['layers'][number]) {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const smaller = Math.min(left.width * left.height, right.width * right.height);
  return smaller > 0 ? width * height / smaller : 0;
}

function canvasCompositionWarnings(spec: VideoSpec) {
  const warnings: string[] = [];
  const shallowScenes: string[] = [];
  spec.editSpec.scenes.filter((scene) => scene.component === 'SceneCanvas').forEach((scene) => {
    const canvas = scene.props as unknown as SceneCanvasProps;
    const layers = canvas.layers ?? [];
    const textLayers = layers.filter((layer) => textLayerTypes.has(layer.type));
    const contentLayers = layers.filter((layer) => !decorativeLayerTypes.has(layer.type));
    const decorativeLayers = layers.filter((layer) => decorativeLayerTypes.has(layer.type));
    if (decorativeLayers.length > contentLayers.length) {
      warnings.push(`${scene.id}：装饰图层 ${decorativeLayers.length} 个，多于内容图层 ${contentLayers.length} 个；形状应服务于信息关系而不是填满画面`);
    }
    const missingTypeScale = textLayers.filter((layer) => layer.style?.fontSize === undefined).map((layer) => layer.id);
    if (missingTypeScale.length) warnings.push(`${scene.id}：文字图层 ${missingTypeScale.join('、')} 未明确视频字号，双引擎可能出现层级差异`);
    const sizes = textLayers.map((layer) => layer.style?.fontSize).filter((size): size is number => size !== undefined);
    if (sizes.length >= 2 && Math.max(...sizes) / Math.max(1, Math.min(...sizes)) < 1.35) {
      warnings.push(`${scene.id}：主次文字字号过于接近，缺少清晰的视觉层级`);
    }
    if (sizes.length && Math.max(...sizes) < 64) warnings.push(`${scene.id}：最大文字仅 ${Math.max(...sizes)}px，主信息在 1920×1080 视频中偏弱`);
    const unsafe = textLayers.filter((layer) => layer.x < 4 || layer.y < 4 || layer.x + layer.width > 96 || layer.y + layer.height > 96).map((layer) => layer.id);
    if (unsafe.length) warnings.push(`${scene.id}：文字图层 ${unsafe.join('、')} 进入 4% 安全边界，移动端裁切风险较高`);
    for (let left = 0; left < textLayers.length; left += 1) {
      for (let right = left + 1; right < textLayers.length; right += 1) {
        if (overlapRatio(textLayers[left], textLayers[right]) > 0.12) {
          warnings.push(`${scene.id}：文字图层 ${textLayers[left].id} 与 ${textLayers[right].id} 明显重叠，需重新建立对齐与留白`);
        }
      }
    }
    if (!layers.some((layer) => semanticVisualTypes.has(layer.type))) shallowScenes.push(scene.id);
  });
  if (shallowScenes.length > 1) warnings.push(`${shallowScenes.join('、')}：连续自由画布只有文字与装饰图形；建议按内容加入实拍、数据、公式、代码或关系图解`);
  return [...new Set(warnings)];
}

export function validateVideoSpec(input: VideoSpec): ValidationReport {
  const parsed = videoSpecSchema.safeParse(input);
  const schemaErrors = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const spec = input;
  const storyIds = new Set(spec.storySpec?.scenes?.map((scene) => scene.id) ?? []);
  const editIds = new Set(spec.editSpec?.scenes?.map((scene) => scene.id) ?? []);
  const trackIds = new Set(spec.editSpec?.tracks?.map((track) => track.id) ?? []);
  const semanticErrors = [
    ...[...storyIds].filter((id) => !editIds.has(id)).map((id) => `StoryScene ${id} 没有对应 EditScene`),
    ...[...editIds].filter((id) => !storyIds.has(id)).map((id) => `EditScene ${id} 没有对应 StoryScene`),
    ...(spec.editSpec?.scenes ?? []).filter((scene) => !trackIds.has(scene.trackId)).map((scene) => `${scene.id} 引用了不存在的轨道 ${scene.trackId}`),
  ];
  const timelineErrors: string[] = [];
  const timelineWarnings: string[] = [];
  const ordered = [...(spec.editSpec?.scenes ?? [])].sort((a, b) => a.startFrame - b.startFrame);
  const visualTrackIds = (spec.editSpec?.tracks ?? []).filter((track) => track.kind === 'video' || track.kind === 'overlay').map((track) => track.id);
  visualTrackIds.forEach((trackId) => {
    const clips = ordered.filter((scene) => scene.trackId === trackId);
    clips.forEach((scene, index) => {
      const previous = clips[index - 1];
      if (previous) {
        const previousEnd = previous.startFrame + previous.durationFrames;
        if (scene.startFrame < previousEnd) timelineErrors.push(`${trackId}：${previous.id} 与 ${scene.id} 时间重叠`);
        if (scene.startFrame > previousEnd) timelineWarnings.push(`${trackId}：${previous.id} 与 ${scene.id} 之间有 ${scene.startFrame - previousEnd} 帧空隙`);
      }
    });
  });
  const totalFrames = ordered.reduce((max, scene) => Math.max(max, scene.startFrame + scene.durationFrames), 0);
  const maxFrames = Math.round((spec.constraints.maxDurationMs / 1000) * spec.canvas.fps);
  if (totalFrames > maxFrames) timelineErrors.push(`总时长 ${totalFrames} 帧超过上限 ${maxFrames} 帧`);
  const assetErrors = (spec.assets ?? [])
    .filter((asset) => !asset.src.trim())
    .map((asset) => `资产 ${asset.id} 缺少 src`);
  const componentErrors = (spec.editSpec?.scenes ?? []).flatMap((scene) => {
    if (!COMPONENT_TYPES.includes(scene.component)) return [`${scene.id} 使用未注册组件 ${scene.component}`];
    const result = componentPropsSchemas[scene.component].safeParse(scene.props);
    return result.success ? [] : result.error.issues.map((issue) => `${scene.id}.${issue.path.join('.')}: ${issue.message}`);
  });
  const audiovisualWarnings: string[] = [];
  const narrationId = spec.editSpec?.globalAudio?.narrationAssetId;
  const narrationAsset = (spec.assets ?? []).find((asset) => asset.id === narrationId);
  const segments = spec.editSpec?.globalAudio?.narrationSegments ?? [];
  if (!narrationId) audiovisualWarnings.push('当前使用文本旁白节奏模拟，未绑定旁白音频');
  else if (!narrationAsset) audiovisualWarnings.push('旁白主音轨没有对应资产');
  else if (segments.length !== (spec.editSpec?.scenes?.length ?? 0)) audiovisualWarnings.push('旁白分段数量与镜头数量不一致');
  else if (segments.some((segment) => Math.abs(segment.renderedDurationMs - segment.durationFrames / spec.canvas.fps * 1000) > 80)) audiovisualWarnings.push('至少一段旁白与镜头时长偏差超过 80ms');
  if (!spec.editSpec?.globalAudio?.bgmAssetId) audiovisualWarnings.push('未绑定 BGM，最终输出将保持干净无配乐');
  const deliveryErrors = spec.schemaVersion !== '1.0.0' ? ['交付版本不是 1.0.0'] : [];
  const gates = [
    gate('G1', 'Schema 结构校验', schemaErrors),
    gate('G2', '语义与引用完整性', semanticErrors),
    gate('G3', '时间轴与边界', timelineErrors, timelineWarnings),
    gate('G4', '资产可用性', assetErrors),
    gate('G5', '组件、构建与画面构图', componentErrors, canvasCompositionWarnings(spec)),
    gate('G6', '视听同步', [], audiovisualWarnings),
    gate('G7', '交付完整性', deliveryErrors),
  ] satisfies GateResult[];
  return {
    valid: gates.every((item) => item.status !== 'fail'),
    revision: spec.revision ?? -1,
    checkedAt: new Date().toISOString(),
    digest: createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 16),
    gates,
  };
}
