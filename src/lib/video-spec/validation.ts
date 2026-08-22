import {createHash} from 'node:crypto';
import {COMPONENT_TYPES, componentPropsSchemas, videoSpecSchema, type VideoSpec} from './schema';

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

export function validateVideoSpec(input: VideoSpec): ValidationReport {
  const parsed = videoSpecSchema.safeParse(input);
  const schemaErrors = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const spec = input;
  const storyIds = new Set(spec.storySpec?.scenes?.map((scene) => scene.id) ?? []);
  const editIds = new Set(spec.editSpec?.scenes?.map((scene) => scene.id) ?? []);
  const semanticErrors = [
    ...[...storyIds].filter((id) => !editIds.has(id)).map((id) => `StoryScene ${id} 没有对应 EditScene`),
    ...[...editIds].filter((id) => !storyIds.has(id)).map((id) => `EditScene ${id} 没有对应 StoryScene`),
  ];
  const timelineErrors: string[] = [];
  const timelineWarnings: string[] = [];
  const ordered = [...(spec.editSpec?.scenes ?? [])].sort((a, b) => a.startFrame - b.startFrame);
  ordered.forEach((scene, index) => {
    const previous = ordered[index - 1];
    if (previous) {
      const previousEnd = previous.startFrame + previous.durationFrames;
      if (scene.startFrame < previousEnd) timelineErrors.push(`${previous.id} 与 ${scene.id} 时间重叠`);
      if (scene.startFrame > previousEnd) timelineWarnings.push(`${previous.id} 与 ${scene.id} 之间有 ${scene.startFrame - previousEnd} 帧空隙`);
    }
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
  if (!spec.editSpec?.globalAudio?.narrationAssetId) audiovisualWarnings.push('当前使用文本旁白节奏模拟，未绑定旁白音频');
  if (!spec.editSpec?.globalAudio?.bgmAssetId) audiovisualWarnings.push('未绑定 BGM，最终输出将保持干净无配乐');
  const deliveryErrors = spec.schemaVersion !== '1.0.0' ? ['交付版本不是 1.0.0'] : [];
  const gates = [
    gate('G1', 'Schema 结构校验', schemaErrors),
    gate('G2', '语义与引用完整性', semanticErrors),
    gate('G3', '时间轴与边界', timelineErrors, timelineWarnings),
    gate('G4', '资产可用性', assetErrors),
    gate('G5', '组件与构建契约', componentErrors),
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
