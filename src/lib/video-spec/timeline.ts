import type {VideoSpec} from './schema';

export interface RippleReorderResult {
  changed: boolean;
  targetStartFrame: number;
  editScenes: VideoSpec['editSpec']['scenes'];
  storyScenes: VideoSpec['storySpec']['scenes'];
  narrationSegments: VideoSpec['editSpec']['globalAudio']['narrationSegments'];
}

/**
 * Reorders one visual track as a contiguous ripple block while preserving
 * every scene ID. StorySpec and scene-bound narration timing follow the same
 * order so the canvas, timeline, subtitles and audio cannot disagree.
 */
export function rippleReorderScene(spec: VideoSpec, sceneId: string, desiredStartFrame: number): RippleReorderResult {
  const dragged = spec.editSpec.scenes.find((scene) => scene.id === sceneId);
  if (!dragged) throw new Error(`找不到待重排镜头 ${sceneId}`);
  const ordered = spec.editSpec.scenes
    .filter((scene) => scene.trackId === dragged.trackId)
    .sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id));
  const previousIds = ordered.map((scene) => scene.id);
  const remaining = ordered.filter((scene) => scene.id !== sceneId);
  const desiredCenter = Math.max(0, desiredStartFrame) + dragged.durationFrames / 2;
  const insertionIndex = remaining.findIndex((scene) => scene.startFrame + scene.durationFrames / 2 > desiredCenter);
  const nextOrder = [...remaining];
  nextOrder.splice(insertionIndex < 0 ? remaining.length : insertionIndex, 0, dragged);
  const changed = nextOrder.some((scene, index) => scene.id !== previousIds[index]);
  if (!changed) return {
    changed: false,
    targetStartFrame: dragged.startFrame,
    editScenes: spec.editSpec.scenes,
    storyScenes: spec.storySpec.scenes,
    narrationSegments: spec.editSpec.globalAudio.narrationSegments,
  };

  let cursor = Math.min(...ordered.map((scene) => scene.startFrame));
  const reordered = nextOrder.map((scene) => {
    const next = {...scene, startFrame: cursor};
    cursor += scene.durationFrames;
    return next;
  });
  const reorderedById = new Map(reordered.map((scene) => [scene.id, scene]));
  let editCursor = 0;
  const editScenes = spec.editSpec.scenes.map((scene) => reorderedById.has(scene.id) ? reordered[editCursor++] : scene);

  const storyById = new Map(spec.storySpec.scenes.map((scene) => [scene.id, scene]));
  const reorderedStories = reordered.map((scene) => storyById.get(scene.id)).filter((scene): scene is VideoSpec['storySpec']['scenes'][number] => Boolean(scene));
  let storyCursor = 0;
  const storyScenes = spec.storySpec.scenes.map((scene) => reorderedById.has(scene.id) ? reorderedStories[storyCursor++] ?? scene : scene);
  const narrationSegments = spec.editSpec.globalAudio.narrationSegments.map((segment) => {
    const scene = reorderedById.get(segment.sceneId);
    return scene ? {...segment, startFrame: scene.startFrame, durationFrames: scene.durationFrames} : segment;
  });

  return {
    changed: true,
    targetStartFrame: reorderedById.get(sceneId)?.startFrame ?? dragged.startFrame,
    editScenes,
    storyScenes,
    narrationSegments,
  };
}
