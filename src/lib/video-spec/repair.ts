import type {PatchOperation, VideoSpec} from './schema';

export interface RepairResult {
  spec: VideoSpec;
  actions: string[];
  patch: PatchOperation[];
}

export function repairVideoSpec(input: VideoSpec): RepairResult {
  const next = structuredClone(input);
  const actions: string[] = [];
  const patch: PatchOperation[] = [];
  const trackById = new Map(next.editSpec.tracks.map((track) => [track.id, track]));
  const fallbackVisualTrack = next.editSpec.tracks.find((track) => track.kind === 'video')?.id
    ?? next.editSpec.tracks.find((track) => track.kind === 'overlay')?.id;

  let scenesChanged = false;
  next.editSpec.scenes.forEach((scene) => {
    const safeStart = Math.max(0, Math.round(scene.startFrame));
    const safeDuration = Math.max(1, Math.round(scene.durationFrames));
    if (safeStart !== scene.startFrame) { scene.startFrame = safeStart; scenesChanged = true; }
    if (safeDuration !== scene.durationFrames) { scene.durationFrames = safeDuration; scenesChanged = true; }
    if (!trackById.has(scene.trackId) && fallbackVisualTrack) {
      scene.trackId = fallbackVisualTrack;
      scenesChanged = true;
      actions.push(`${scene.id} 已改用可用的视频轨 ${fallbackVisualTrack}`);
    }
  });

  const visualTracks = next.editSpec.tracks.filter((track) => track.kind === 'video' || track.kind === 'overlay');
  visualTracks.forEach((track) => {
    const clips = next.editSpec.scenes.filter((scene) => scene.trackId === track.id && scene.durationFrames > 0).sort((a, b) => a.startFrame - b.startFrame);
    let cursor = 0;
    clips.forEach((scene) => {
      if (scene.startFrame < cursor) {
        actions.push(`${track.name} 中 ${scene.id} 已波纹后移 ${cursor - scene.startFrame} 帧以消除重叠`);
        scene.startFrame = cursor;
        scenesChanged = true;
      }
      cursor = Math.max(cursor, scene.startFrame + scene.durationFrames);
    });
  });

  if (scenesChanged) patch.push({op: 'replace', path: '/editSpec/scenes', value: next.editSpec.scenes});
  const totalFrames = next.editSpec.scenes.reduce((maximum, scene) => Math.max(maximum, scene.startFrame + scene.durationFrames), 1);
  const totalMs = Math.max(1, Math.round(totalFrames / next.canvas.fps * 1000));
  if (next.project.targetDurationMs !== totalMs) {
    next.project.targetDurationMs = totalMs;
    patch.push({op: 'replace', path: '/project/targetDurationMs', value: totalMs});
    actions.push(`项目目标时长已同步为 ${(totalMs / 1000).toFixed(2)} 秒`);
  }
  if (next.constraints.maxDurationMs < totalMs) {
    next.constraints.maxDurationMs = Math.min(180_000, totalMs);
    patch.push({op: 'replace', path: '/constraints/maxDurationMs', value: next.constraints.maxDurationMs});
    actions.push(`时间轴上限已扩展到 ${(next.constraints.maxDurationMs / 1000).toFixed(2)} 秒`);
  }

  const activeScenes = next.editSpec.scenes.filter((scene) => scene.durationFrames > 0);
  const segments = next.editSpec.globalAudio.narrationSegments;
  const segmentTimingMatches = segments.length === activeScenes.length && activeScenes.every((scene) => {
    const segment = segments.find((item) => item.sceneId === scene.id);
    return segment?.startFrame === scene.startFrame && segment.durationFrames === scene.durationFrames;
  });
  if (next.editSpec.globalAudio.narrationAssetId && !segmentTimingMatches) {
    const narrationIds = new Set([next.editSpec.globalAudio.narrationAssetId, ...segments.map((segment) => segment.assetId)]);
    next.assets = next.assets.filter((asset) => !narrationIds.has(asset.id));
    next.editSpec.globalAudio.narrationAssetId = null;
    next.editSpec.globalAudio.narrationSegments = [];
    patch.push(
      {op: 'replace', path: '/assets', value: next.assets},
      {op: 'replace', path: '/editSpec/globalAudio/narrationAssetId', value: null},
      {op: 'replace', path: '/editSpec/globalAudio/narrationSegments', value: []},
    );
    actions.push('镜头时序已改变，旧旁白音轨已安全失效，等待重新合成');
  }

  return {spec: next, actions, patch};
}
