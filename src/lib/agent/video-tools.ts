import 'server-only';

import {Type} from '@earendil-works/pi-ai';
import {defineTool, type ToolDefinition} from '@earendil-works/pi-coding-agent';
import {
  approvePendingChangeSet,
  autoRepairProject,
  getProject,
  rejectPendingChangeSet,
  replaceProjectSpec,
  resetProject,
  stagePendingChangeSet,
  updateProject,
} from '@/lib/project/store';
import {createChangeSet} from '@/lib/video-spec/patch';
import {patchOperationSchema, type PatchOperation, type VideoSpec} from '@/lib/video-spec/schema';
import {videoSpecFromAgentPlan, type AgentVideoPlan} from '@/lib/video-spec/generation';
import {validateVideoSpec} from '@/lib/video-spec/validation';
import type {EditIntentContext} from './types';

export const PICUT_AGENT_TOOL_NAMES = [
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
  'render_preview',
  'render_final',
] as const;

const componentType = Type.Union([
  Type.Literal('TextHero'),
  Type.Literal('SplitScreen'),
  Type.Literal('DynamicChart'),
  Type.Literal('CaptionKaraoke'),
  Type.Literal('MediaBroll'),
]);

const visualPlanType = Type.Union([
  Type.Literal('hero'), Type.Literal('split'), Type.Literal('chart'), Type.Literal('caption'), Type.Literal('media'),
]);

function textResult(text: string, details?: unknown) {
  return {content: [{type: 'text' as const, text}], details};
}

function sanitizePatchOperations(raw: unknown): PatchOperation[] {
  const operations = Type.Array(Type.Any());
  void operations;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('Patch 至少需要一项实际修改');
  return raw.map((operation) => {
    const parsed = patchOperationSchema.parse(operation);
    if (/editorNote/i.test(parsed.path)) throw new Error('editorNote 不参与渲染，拒绝提交无视觉效果的修改');
    if (/^\/(?:revision|schemaVersion|provenance)(?:\/|$)/.test(parsed.path)) throw new Error(`不允许直接修改系统字段：${parsed.path}`);
    if (!/^\/(?:project|style|assets|storySpec|editSpec|constraints)(?:\/|$)/.test(parsed.path)) throw new Error(`Patch 路径不属于 VideoSpec 可编辑域：${parsed.path}`);
    return parsed;
  });
}

function structuralPatch(operations: PatchOperation[]) {
  return operations.some((operation) => (
    /^\/(?:storySpec\/scenes|editSpec\/scenes)(?:\/\d+)?$/.test(operation.path)
    || operation.op === 'remove' && /^\/(?:storySpec|editSpec)\/scenes\//.test(operation.path)
  ));
}

async function commitOperations(projectId: string, intent: string, rawOperations: unknown, requestedRisk?: 'low' | 'medium' | 'high') {
  const record = await getProject(projectId);
  const operations = sanitizePatchOperations(rawOperations);
  const risk = structuralPatch(operations) ? 'high' : requestedRisk ?? 'medium';
  const changeSet = createChangeSet({
    baseRevision: record.spec.revision,
    actor: 'agent',
    intent,
    risk,
    approval: risk === 'high' ? 'pending' : 'not-required',
    patch: operations,
  });
  if (changeSet.approval === 'pending') {
    await stagePendingChangeSet(projectId, changeSet);
    return {record, changeSet, pendingApproval: true};
  }
  const updated = await updateProject(projectId, changeSet);
  return {record: updated, changeSet, pendingApproval: false};
}

function currentScene(spec: VideoSpec, sceneId: string) {
  const index = spec.editSpec.scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) throw new Error(`场景不存在：${sceneId}`);
  const edit = spec.editSpec.scenes[index];
  const storyIndex = spec.storySpec.scenes.findIndex((scene) => scene.id === sceneId);
  if (storyIndex < 0) throw new Error(`${sceneId} 缺少 StoryScene`);
  return {index, storyIndex, edit, story: spec.storySpec.scenes[storyIndex]};
}

function reflowScenes(scenes: VideoSpec['editSpec']['scenes']) {
  let cursor = 0;
  return scenes.map((scene) => {
    const next = {...scene, startFrame: cursor};
    cursor += next.durationFrames;
    return next;
  });
}

export function createVideoTools(projectId: string, directUserPrompt: string, editIntent: EditIntentContext = {}): ToolDefinition[] {
  const getVideoSpec = defineTool({
    name: 'get_video_spec',
    label: '观察当前 VideoSpec',
    description: '读取当前项目的完整 StorySpec、EditSpec、轨道、素材、锁、修订号、质量门和 UI 选择状态。编辑前优先调用。',
    promptSnippet: '读取当前完整 VideoSpec 与 UI 选区',
    parameters: Type.Object({}),
    execute: async () => {
      const record = await getProject(projectId);
      return textResult(JSON.stringify({spec: record.spec, validation: validateVideoSpec(record.spec), editIntent, pendingChangeSet: record.pendingChangeSet}), {
        revision: record.spec.revision,
        selectedSceneId: editIntent.selectedSceneId,
        playheadFrame: editIntent.playheadFrame,
      });
    },
  });

  const createProject = defineTool({
    name: 'create_project',
    label: '重置项目',
    description: '仅在用户明确要求重置当前项目时使用。新建会话通常直接使用 draft_storyboard。',
    parameters: Type.Object({confirmReset: Type.Boolean()}),
    execute: async (_id, params) => {
      if (!params.confirmReset || !/重置|重新创建|reset/i.test(directUserPrompt)) throw new Error('重置需要用户本轮明确授权');
      const record = await resetProject(projectId);
      return textResult(`项目已重置为 r${record.spec.revision}`, {revision: record.spec.revision});
    },
  });

  const draftStoryboard = defineTool({
    name: 'draft_storyboard',
    label: '从零生成分镜',
    description: '为当前新会话从零生成完整 StorySpec 与 EditSpec。不得复用示例内容。',
    promptSnippet: '从用户 brief 生成完整、可渲染的新视频分镜',
    parameters: Type.Object({
      title: Type.String({minLength: 2, maxLength: 80}),
      logline: Type.String({minLength: 4, maxLength: 240}),
      audience: Type.String({minLength: 2, maxLength: 160}),
      durationSeconds: Type.Number({minimum: 0.1, maximum: 180}),
      theme: Type.Union([
        Type.Literal('editorial'), Type.Literal('science'), Type.Literal('nature'),
        Type.Literal('warm'), Type.Literal('neon'), Type.Literal('minimal'),
      ]),
      scenes: Type.Array(Type.Object({
        purpose: Type.String({minLength: 2, maxLength: 180}),
        narration: Type.String({minLength: 1, maxLength: 500}),
        visualIntent: Type.String({minLength: 2, maxLength: 300}),
        tempo: Type.Union([Type.Literal('calm'), Type.Literal('steady'), Type.Literal('fast')]),
        durationSeconds: Type.Number({minimum: 0.1, maximum: 180}),
        visualType: visualPlanType,
        kicker: Type.String({minLength: 1, maxLength: 80}),
        headline: Type.String({minLength: 1, maxLength: 120}),
        body: Type.String({minLength: 1, maxLength: 320}),
        secondaryTitle: Type.Optional(Type.String({maxLength: 100})),
        secondaryBody: Type.Optional(Type.String({maxLength: 260})),
        tags: Type.Optional(Type.Array(Type.String({minLength: 1, maxLength: 40}), {maxItems: 8})),
        metric: Type.Optional(Type.String({maxLength: 60})),
        formula: Type.Optional(Type.String({maxLength: 160})),
        chartLabels: Type.Optional(Type.Array(Type.String({minLength: 1, maxLength: 40}), {minItems: 1, maxItems: 12})),
        chartValues: Type.Optional(Type.Array(Type.Number(), {minItems: 1, maxItems: 12})),
        mediaQuery: Type.Optional(Type.String({minLength: 2, maxLength: 180, description: '适合可信素材库的简洁英文搜索词'})),
        evidenceRefs: Type.Optional(Type.Array(Type.String({minLength: 1, maxLength: 160}), {maxItems: 8})),
        mustShow: Type.Optional(Type.Array(Type.String({minLength: 1, maxLength: 80}), {maxItems: 8})),
        mustAvoid: Type.Optional(Type.Array(Type.String({minLength: 1, maxLength: 120}), {maxItems: 8})),
      }), {minItems: 1, maxItems: 12}),
    }),
    execute: async (_id, params) => {
      const plan = params as unknown as AgentVideoPlan;
      const spec = videoSpecFromAgentPlan(projectId, directUserPrompt, plan);
      const record = await replaceProjectSpec(projectId, spec);
      const validation = validateVideoSpec(record.spec);
      return textResult(`已从零生成「${record.spec.project.title}」，${record.spec.storySpec.scenes.length} 个分镜，r${record.spec.revision}`, {
        revision: record.spec.revision,
        sceneCount: record.spec.storySpec.scenes.length,
        generatedFromScratch: true,
        validation,
      });
    },
  });

  const updateScene = defineTool({
    name: 'update_scene',
    label: '精确修改镜头',
    description: '按 sceneId 精确修改真实参与渲染的文字、旁白、组件、样式、变换、动画、转场、关键帧、效果和时序。省略 sceneId 时使用 UI 当前选中镜头。',
    promptSnippet: '精确更新一个镜头的可渲染字段',
    parameters: Type.Object({
      sceneId: Type.Optional(Type.String()),
      intent: Type.String({minLength: 2, maxLength: 240}),
      component: Type.Optional(componentType),
      props: Type.Optional(Type.Record(Type.String(), Type.Any())),
      purpose: Type.Optional(Type.String({minLength: 1, maxLength: 180})),
      narration: Type.Optional(Type.String({minLength: 1, maxLength: 500})),
      visualIntent: Type.Optional(Type.String({minLength: 1, maxLength: 300})),
      tempo: Type.Optional(Type.Union([Type.Literal('calm'), Type.Literal('steady'), Type.Literal('fast')])),
      startFrame: Type.Optional(Type.Integer({minimum: 0})),
      durationFrames: Type.Optional(Type.Integer({minimum: 1})),
      sourceStartFrame: Type.Optional(Type.Integer({minimum: 0})),
      playbackRate: Type.Optional(Type.Number({minimum: 0.25, maximum: 4})),
      transform: Type.Optional(Type.Object({
        x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()), scale: Type.Optional(Type.Number({minimum: 0.05, maximum: 10})),
        rotation: Type.Optional(Type.Number({minimum: -360, maximum: 360})), opacity: Type.Optional(Type.Number({minimum: 0, maximum: 1})),
      })),
      animation: Type.Optional(Type.Object({
        preset: Type.Optional(Type.Union([Type.Literal('fade'), Type.Literal('rise'), Type.Literal('spring'), Type.Literal('draw'), Type.Literal('none')])),
        enterFrames: Type.Optional(Type.Integer({minimum: 0})), exitFrames: Type.Optional(Type.Integer({minimum: 0})),
      })),
      layout: Type.Optional(Type.Object({safeAreaPct: Type.Optional(Type.Number({minimum: 0, maximum: 20})), align: Type.Optional(Type.Union([Type.Literal('left'), Type.Literal('center'), Type.Literal('right')]))})),
      transition: Type.Optional(Type.Object({
        in: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('fade'), Type.Literal('wipe'), Type.Literal('slide')])),
        out: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('fade'), Type.Literal('wipe'), Type.Literal('slide')])),
        durationFrames: Type.Optional(Type.Integer({minimum: 0, maximum: 90})),
      })),
      keyframes: Type.Optional(Type.Array(Type.Any(), {maxItems: 200})),
      effects: Type.Optional(Type.Array(Type.Any(), {maxItems: 16})),
    }),
    execute: async (_id, params) => {
      const record = await getProject(projectId);
      const sceneId = params.sceneId ?? editIntent.selectedSceneId;
      if (!sceneId) throw new Error('未指定 sceneId，且工作台没有选中镜头');
      const {index, storyIndex, edit} = currentScene(record.spec, sceneId);
      const operations: PatchOperation[] = [];
      if (params.component !== undefined) operations.push({op: 'replace', path: `/editSpec/scenes/${index}/component`, value: params.component});
      if (params.props !== undefined) operations.push({op: 'replace', path: `/editSpec/scenes/${index}/props`, value: {...edit.props, ...params.props}});
      for (const field of ['startFrame', 'durationFrames', 'sourceStartFrame', 'playbackRate'] as const) {
        if (params[field] !== undefined) operations.push({op: 'replace', path: `/editSpec/scenes/${index}/${field}`, value: params[field]});
      }
      for (const field of ['transform', 'animation', 'layout', 'transition'] as const) {
        if (params[field] !== undefined) operations.push({op: 'replace', path: `/editSpec/scenes/${index}/${field}`, value: {...edit[field], ...params[field]}});
      }
      if (params.keyframes !== undefined) operations.push({op: 'replace', path: `/editSpec/scenes/${index}/keyframes`, value: params.keyframes});
      if (params.effects !== undefined) operations.push({op: 'replace', path: `/editSpec/scenes/${index}/effects`, value: params.effects});
      for (const field of ['purpose', 'narration', 'visualIntent', 'tempo'] as const) {
        if (params[field] !== undefined) operations.push({op: 'replace', path: `/storySpec/scenes/${storyIndex}/${field}`, value: params[field]});
      }
      const result = await commitOperations(projectId, params.intent, operations, 'medium');
      return textResult(result.pendingApproval ? `已暂存高风险镜头修改「${params.intent}」，等待确认` : `${sceneId} 已精确更新到 r${result.record.spec.revision}`, {
        revision: result.record.spec.revision, changeSet: result.changeSet, pendingApproval: result.pendingApproval,
      });
    },
  });

  const applyVideoPatch = defineTool({
    name: 'apply_video_patch',
    label: '应用通用 VideoSpec Patch',
    description: '对完整 VideoSpec 应用 JSON Pointer Patch。用于 update_scene 未覆盖的全局主题、轨道、音频、资产或批量修改；必须修改真实消费字段，禁止 editorNote。结构操作自动进入人工确认。',
    promptSnippet: '以可审计 Patch 修改任意有效 VideoSpec 字段',
    parameters: Type.Object({
      intent: Type.String({minLength: 2, maxLength: 300}),
      risk: Type.Optional(Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')])),
      operations: Type.Array(Type.Object({op: Type.Union([Type.Literal('add'), Type.Literal('replace'), Type.Literal('remove')]), path: Type.String({minLength: 2}), value: Type.Optional(Type.Any())}), {minItems: 1, maxItems: 100}),
    }),
    execute: async (_id, params) => {
      const result = await commitOperations(projectId, params.intent, params.operations, params.risk);
      return textResult(result.pendingApproval ? `结构修改「${params.intent}」已生成完整 ChangeSet，等待用户确认` : `VideoSpec 已更新到 r${result.record.spec.revision}`, {
        revision: result.record.spec.revision, changeSet: result.changeSet, pendingApproval: result.pendingApproval,
      });
    },
  });

  const insertScene = defineTool({
    name: 'insert_scene',
    label: '插入镜头',
    description: '插入一对完整 StoryScene/EditScene，并自动波纹重排开始帧。属于结构变更，始终等待人工确认。',
    parameters: Type.Object({
      intent: Type.String({minLength: 2}),
      afterSceneId: Type.Optional(Type.String()),
      storyScene: Type.Any(),
      editScene: Type.Any(),
    }),
    execute: async (_id, params) => {
      const record = await getProject(projectId);
      const storyScene = params.storyScene as VideoSpec['storySpec']['scenes'][number];
      const editScene = params.editScene as VideoSpec['editSpec']['scenes'][number];
      if (!storyScene?.id || storyScene.id !== editScene?.id) throw new Error('StoryScene 与 EditScene 必须使用相同且非空的 id');
      if (record.spec.editSpec.scenes.some((scene) => scene.id === editScene.id)) throw new Error(`sceneId 已存在：${editScene.id}`);
      const afterIndex = params.afterSceneId ? record.spec.editSpec.scenes.findIndex((scene) => scene.id === params.afterSceneId) : record.spec.editSpec.scenes.length - 1;
      if (params.afterSceneId && afterIndex < 0) throw new Error(`afterSceneId 不存在：${params.afterSceneId}`);
      const editScenes = [...record.spec.editSpec.scenes];
      const storyScenes = [...record.spec.storySpec.scenes];
      editScenes.splice(afterIndex + 1, 0, editScene);
      storyScenes.splice(afterIndex + 1, 0, storyScene);
      const result = await commitOperations(projectId, params.intent, [
        {op: 'replace', path: '/storySpec/scenes', value: storyScenes},
        {op: 'replace', path: '/editSpec/scenes', value: reflowScenes(editScenes)},
      ], 'high');
      return textResult(`插入镜头提案已保存，等待用户确认后写入时间轴`, {changeSet: result.changeSet, pendingApproval: true});
    },
  });

  const reorderScenes = defineTool({
    name: 'reorder_scenes',
    label: '重排镜头',
    description: '按完整 sceneId 顺序重排 StorySpec 与 EditSpec，并自动波纹重排。始终等待人工确认。',
    parameters: Type.Object({intent: Type.String({minLength: 2}), orderedSceneIds: Type.Array(Type.String(), {minItems: 1, maxItems: 12})}),
    execute: async (_id, params) => {
      const record = await getProject(projectId);
      const currentIds = record.spec.editSpec.scenes.map((scene) => scene.id);
      if (params.orderedSceneIds.length !== currentIds.length || new Set(params.orderedSceneIds).size !== currentIds.length || currentIds.some((id) => !params.orderedSceneIds.includes(id))) {
        throw new Error(`orderedSceneIds 必须且只能包含全部现有镜头：${currentIds.join(', ')}`);
      }
      const editById = new Map(record.spec.editSpec.scenes.map((scene) => [scene.id, scene]));
      const storyById = new Map(record.spec.storySpec.scenes.map((scene) => [scene.id, scene]));
      const result = await commitOperations(projectId, params.intent, [
        {op: 'replace', path: '/storySpec/scenes', value: params.orderedSceneIds.map((id) => storyById.get(id)!)},
        {op: 'replace', path: '/editSpec/scenes', value: reflowScenes(params.orderedSceneIds.map((id) => editById.get(id)!))},
      ], 'high');
      return textResult('镜头重排提案已保存，等待用户确认', {changeSet: result.changeSet, pendingApproval: true});
    },
  });

  const deleteScene = defineTool({
    name: 'delete_scene',
    label: '删除镜头',
    description: '同时删除 StoryScene 和 EditScene，并自动波纹重排。始终等待人工确认。',
    parameters: Type.Object({intent: Type.String({minLength: 2}), sceneId: Type.Optional(Type.String())}),
    execute: async (_id, params) => {
      const record = await getProject(projectId);
      const sceneId = params.sceneId ?? editIntent.selectedSceneId;
      if (!sceneId) throw new Error('未指定 sceneId，且工作台没有选中镜头');
      if (record.spec.editSpec.scenes.length <= 1) throw new Error('不能删除最后一个镜头');
      currentScene(record.spec, sceneId);
      const result = await commitOperations(projectId, params.intent, [
        {op: 'replace', path: '/storySpec/scenes', value: record.spec.storySpec.scenes.filter((scene) => scene.id !== sceneId)},
        {op: 'replace', path: '/editSpec/scenes', value: reflowScenes(record.spec.editSpec.scenes.filter((scene) => scene.id !== sceneId))},
      ], 'high');
      return textResult(`删除 ${sceneId} 的完整提案已保存，等待用户确认`, {changeSet: result.changeSet, pendingApproval: true});
    },
  });

  const resolveChange = defineTool({
    name: 'resolve_change',
    label: '处理人工确认',
    description: '用户明确确认或拒绝当前待审批 ChangeSet 时调用。',
    parameters: Type.Object({decision: Type.Union([Type.Literal('approve'), Type.Literal('reject')])}),
    execute: async (_id, params) => {
      if (params.decision === 'approve' && !/确认|批准|同意|approve|confirm/i.test(directUserPrompt)) throw new Error('本轮没有明确的批准指令');
      const record = params.decision === 'approve' ? await approvePendingChangeSet(projectId) : await rejectPendingChangeSet(projectId);
      return textResult(params.decision === 'approve' ? `ChangeSet 已批准并提交到 r${record.spec.revision}` : 'ChangeSet 已拒绝，VideoSpec 保持不变', {
        revision: record.spec.revision, decision: params.decision, pendingApproval: record.pendingChangeSet,
      });
    },
  });

  const validateSpec = defineTool({
    name: 'validate_spec',
    label: '运行 G1–G7',
    description: '运行 VideoSpec 七级质量门并自动修复确定性问题。所有视频修改完成后必须调用。',
    promptSnippet: '校验并自动修复当前 VideoSpec',
    parameters: Type.Object({}),
    execute: async () => {
      const repaired = await autoRepairProject(projectId, 3);
      const report = repaired.validation;
      return textResult(report.valid ? `G1–G7 无阻断项${repaired.repairs.length ? `，自动修复 ${repaired.repairs.length} 项` : ''}` : `自动迭代 ${repaired.attempts} 轮后仍有阻断项，保留可编辑草稿`, {
        ...report, repairs: repaired.repairs, repairAttempts: repaired.attempts,
      });
    },
  });

  const searchMedia = defineTool({
    name: 'search_media',
    label: '联网搜索实拍素材',
    description: '根据当前 VideoSpec 路由 NOAA、NASA、Wikimedia 等可信来源，自动宽化搜索词、换源、下载并注入带许可与署名的 B-roll。',
    promptSnippet: '联网搜索并注入可追溯实拍素材',
    parameters: Type.Object({query: Type.Optional(Type.String({maxLength: 240}))}),
    execute: async (_id, params) => {
      const {enrichProjectWithCommonsMedia} = await import('@/lib/research/wikimedia');
      const result = await enrichProjectWithCommonsMedia(projectId, params.query);
      const text = result.degraded
        ? result.assets.length ? `已注入 ${result.assets.length} 个 B-roll；部分目标暂未找到，工作台不受阻断` : result.message ?? '可信素材源暂不可用，已保留当前视频'
        : `已检索、授权过滤并注入 ${result.assets.length} 个 B-roll 素材`;
      return textResult(text, {revision: result.spec.revision, assets: result.assets, degraded: result.degraded, warnings: result.warnings});
    },
  });

  const synthesizeNarration = defineTool({
    name: 'synthesize_narration',
    label: '合成旁白',
    description: '调用服务端 TTS，按镜头校准音频长度、生成波形并写入多轨 VideoSpec。',
    parameters: Type.Object({model: Type.Optional(Type.String()), voice: Type.Optional(Type.String()), speed: Type.Optional(Type.Number({minimum: 0.25, maximum: 4})), gainDb: Type.Optional(Type.Number({minimum: -10, maximum: 10}))}),
    execute: async (_id, params) => {
      const {synthesizeProjectNarration} = await import('@/lib/audio/service');
      const result = await synthesizeProjectNarration(projectId, params);
      return textResult(`已合成 ${result.audio.segments.length} 段旁白并完成音画对齐`, {revision: result.spec.revision, ...result.audio});
    },
  });

  const renderPreview = defineTool({
    name: 'render_preview',
    label: '渲染预览',
    description: '通过 Remotion、HyperFrames 或自主路由器生成可检查预览。',
    parameters: Type.Object({backend: Type.Optional(Type.Union([Type.Literal('remotion'), Type.Literal('hyperframes'), Type.Literal('auto')]))}),
    execute: async (_id, params) => {
      const repaired = await autoRepairProject(projectId, 3);
      if (!repaired.validation.valid) return textResult('仍有质量门阻断项；工作台实时预览保持可用，未生成独立文件', {...repaired.validation, previewStillAvailable: true});
      const {renderProject} = await import('@/lib/render/service');
      const backend = params.backend ?? 'auto';
      const result = await renderProject(projectId, backend, 'preview');
      return textResult(`预览已生成：${result.urls.video}`, {backend: result.manifest.backend, requestedBackend: backend, routing: result.routing, video: result.urls.video, manifest: result.urls.manifest});
    },
  });

  const renderFinal = defineTool({
    name: 'render_final',
    label: '正式导出',
    description: '仅在用户本轮明确要求正式导出时生成不可变成片。',
    parameters: Type.Object({backend: Type.Optional(Type.Union([Type.Literal('remotion'), Type.Literal('hyperframes'), Type.Literal('auto')]))}),
    execute: async (_id, params) => {
      if (!/正式导出|导出(?:最终|成片|视频)|渲染成片|render\s+final|export\s+final/i.test(directUserPrompt)) throw new Error('正式导出需要用户本轮明确授权');
      const repaired = await autoRepairProject(projectId, 3);
      if (!repaired.validation.valid) throw new Error('正式导出被 G1–G7 阻断');
      const {renderProject} = await import('@/lib/render/service');
      const backend = params.backend ?? 'auto';
      const result = await renderProject(projectId, backend, 'final');
      return textResult(`正式成片已生成：${result.urls.video}`, {backend: result.manifest.backend, requestedBackend: backend, routing: result.routing, video: result.urls.video, manifest: result.urls.manifest});
    },
  });

  return [getVideoSpec, createProject, draftStoryboard, updateScene, applyVideoPatch, insertScene, reorderScenes, deleteScene, resolveChange, validateSpec, searchMedia, synthesizeNarration, renderPreview, renderFinal];
}
