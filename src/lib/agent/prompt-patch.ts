import {createChangeSet} from '@/lib/video-spec/patch';
import type {ChangeSet, VideoSpec} from '@/lib/video-spec/schema';

const HEX = /#[0-9a-fA-F]{6}/;

export function changeSetFromInstruction(spec: VideoSpec, instruction: string, actor: ChangeSet['actor'] = 'agent'): ChangeSet {
  const normalized = instruction.toLowerCase();
  const sceneMatch = normalized.match(/(?:scene|场景|镜头|第)\s*[-_ ]?(\d+)/);
  const sceneNumber = Math.max(1, Math.min(spec.editSpec.scenes.length, Number(sceneMatch?.[1] ?? (normalized.includes('第三') ? 3 : 1))));
  const index = sceneNumber - 1;
  const scene = spec.editSpec.scenes[index];
  const patch: ChangeSet['patch'] = [];
  const color = instruction.match(HEX)?.[0]
    ?? (normalized.includes('橙') ? '#FF8A5B' : normalized.includes('蓝') ? '#4D8DFF' : normalized.includes('绿') ? '#38E0C1' : undefined);
  if (color) patch.push({op: 'replace', path: `/editSpec/scenes/${index}/props/accentColor`, value: color});

  const secondsMatch = normalized.match(/(?:延长|改成|调整为|duration|时长)[^\d]*(\d+(?:\.\d+)?)\s*(?:秒|s)/);
  if (secondsMatch) {
    const frames = Math.round(Number(secondsMatch[1]) * spec.canvas.fps);
    patch.push({op: 'replace', path: `/editSpec/scenes/${index}/durationFrames`, value: frames});
    const delta = frames - scene.durationFrames;
    spec.editSpec.scenes.slice(index + 1).forEach((_, offset) => {
      const targetIndex = index + offset + 1;
      patch.push({
        op: 'replace',
        path: `/editSpec/scenes/${targetIndex}/startFrame`,
        value: spec.editSpec.scenes[targetIndex].startFrame + delta,
      });
    });
  }

  if (normalized.includes('折线')) patch.push({op: 'replace', path: `/editSpec/scenes/${index}/props/chartType`, value: 'line'});
  if (normalized.includes('柱状') || normalized.includes('柱形')) patch.push({op: 'replace', path: `/editSpec/scenes/${index}/props/chartType`, value: 'bar'});
  if (normalized.includes('锁定')) patch.push({op: 'replace', path: `/editSpec/scenes/${index}/locks/locked`, value: true});
  if (normalized.includes('解锁')) patch.push({op: 'replace', path: `/editSpec/scenes/${index}/locks/locked`, value: false});
  const deletingScene = /删除|delete/.test(normalized);
  if (deletingScene && spec.editSpec.scenes.length > 1) {
    patch.length = 0;
    spec.editSpec.scenes.slice(index + 1).forEach((nextScene, offset) => {
      patch.push({
        op: 'replace',
        path: `/editSpec/scenes/${index + offset + 1}/startFrame`,
        value: nextScene.startFrame - scene.durationFrames,
      });
    });
    patch.push({op: 'remove', path: `/editSpec/scenes/${index}`});
    const storyIndex = spec.storySpec.scenes.findIndex((item) => item.id === scene.id);
    if (storyIndex >= 0) patch.push({op: 'remove', path: `/storySpec/scenes/${storyIndex}`});
  }
  if (!patch.length) {
    patch.push({op: 'replace', path: `/editSpec/scenes/${index}/props/editorNote`, value: instruction});
  }

  const structural = /删除|新增|重排|重构|delete|reorder|insert/.test(normalized);
  return createChangeSet({
    baseRevision: spec.revision,
    actor,
    intent: instruction,
    risk: structural ? 'high' : patch.length > 2 ? 'medium' : 'low',
    patch,
    approval: structural ? 'pending' : 'not-required',
  });
}
