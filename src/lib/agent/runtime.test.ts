import {describe, expect, it} from 'vitest';
import {appendProjectChat, getProject, replaceProject, replaceProjectSpec} from '@/lib/project/store';
import {createDefaultVideoSpec, createPendingVideoSpec} from '@/lib/video-spec/defaults';
import {PICUT_AGENT_TOOL_NAMES} from './runtime';
import {createVideoTools} from './video-tools';

function tool(projectId: string, name: string, prompt = '修改视频', selectedSceneId = 'scene-03') {
  const found = createVideoTools(projectId, prompt, {selectedSceneId}).find((item) => item.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

describe('native Pi AgentSession video tool contract', () => {
  it('exposes complete Pi-friendly observation, general patch, typed edit, structure and delivery tools', () => {
    expect(PICUT_AGENT_TOOL_NAMES).toEqual([
      'get_video_spec',
      'create_project',
      'draft_storyboard',
      'update_scene',
      'apply_video_patch',
      'insert_scene',
      'reorder_scenes',
      'delete_scene',
      'resolve_change',
      'validate_spec',
      'search_media',
      'synthesize_narration',
      'compose_bgm',
      'render_preview',
      'render_final',
    ]);
  });

  it('edits the UI-selected scene through real rendered fields without a regex instruction parser', async () => {
    const projectId = `native-tool-edit-${Date.now()}`;
    const update = tool(projectId, 'update_scene');
    await update.execute('call-1', {
      intent: '第三幕改为更强的蓝色并缩小 15%',
      props: {accentColor: '#4D8DFF'},
      transform: {scale: 0.85},
      durationFrames: 360,
    }, undefined, undefined, {} as never);
    const record = await getProject(projectId);
    expect(record.spec.editSpec.scenes[2].props.accentColor).toBe('#4D8DFF');
    expect(record.spec.editSpec.scenes[2].transform.scale).toBe(0.85);
    expect(record.spec.editSpec.scenes[2].durationFrames).toBe(360);
    expect(record.spec.editSpec.scenes[3].startFrame).toBe(930);
  });

  it('refuses the old non-rendered editorNote fallback instead of reporting false success', async () => {
    const projectId = `native-tool-noop-${Date.now()}`;
    const patch = tool(projectId, 'apply_video_patch');
    await expect(patch.execute('call-2', {
      intent: '伪修改',
      operations: [{op: 'replace', path: '/editSpec/scenes/0/props/editorNote', value: '看似成功'}],
    }, undefined, undefined, {} as never)).rejects.toThrow(/editorNote/);
    expect((await getProject(projectId)).spec.revision).toBe(0);
  });

  it('stages a complete structural delete and applies it only after explicit approval', async () => {
    const projectId = `native-tool-approval-${Date.now()}`;
    await tool(projectId, 'delete_scene', '删除第五幕', 'scene-05').execute('call-3', {intent: '删除第五幕'}, undefined, undefined, {} as never);
    const staged = await getProject(projectId);
    expect(staged.spec.editSpec.scenes).toHaveLength(6);
    expect(staged.pendingChangeSet?.patch).toHaveLength(2);
    await tool(projectId, 'resolve_change', '确认上述修改').execute('call-4', {decision: 'approve'}, undefined, undefined, {} as never);
    const approved = await getProject(projectId);
    expect(approved.pendingChangeSet).toBeNull();
    expect(approved.spec.editSpec.scenes).toHaveLength(5);
    expect(approved.spec.storySpec.scenes).toHaveLength(5);
  });

  it('preserves the queued creation brief when the draft replaces the temporary canvas', async () => {
    const projectId = `native-draft-envelope-${Date.now()}`;
    await replaceProject(projectId, createPendingVideoSpec(projectId, '制作一个原创云朵科普视频', 6_000));
    await appendProjectChat(projectId, [{
      id: 'human-create-job',
      role: 'human',
      text: '制作一个原创云朵科普视频',
      meta: 'You · creation brief',
      createdAt: new Date().toISOString(),
    }]);
    const generated = createDefaultVideoSpec(projectId);
    generated.project.title = '原创云朵科普视频';
    await replaceProjectSpec(projectId, generated);
    const record = await getProject(projectId);
    expect(record.spec.project.title).toBe('原创云朵科普视频');
    expect(record.chatMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'human-create-job', text: '制作一个原创云朵科普视频'}),
    ]));
  });
});
