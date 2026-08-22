import 'server-only';

import {Agent, type AgentEvent, type AgentMessage, type AgentTool} from '@earendil-works/pi-agent-core';
import {
  Type,
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type StreamFunction,
  type ToolCall,
  type Usage,
} from '@earendil-works/pi-ai';
import {streamSimple} from '@earendil-works/pi-ai/compat';
import {
  approvePendingChangeSet,
  autoRepairProject,
  getProject,
  replaceProject,
  rejectPendingChangeSet,
  resetProject,
  stagePendingChangeSet,
  updateProject,
  type ProjectRecord,
} from '@/lib/project/store';
import {getModelApiKey} from '@/lib/server/model-secret';
import {videoSpecFromAgentPlan, type AgentVideoPlan} from '@/lib/video-spec/generation';
import {validateVideoSpec} from '@/lib/video-spec/validation';
import {changeSetFromInstruction} from './prompt-patch';

export const PICUT_AGENT_TOOL_NAMES = [
  'create_project',
  'draft_storyboard',
  'apply_spec_patch',
  'validate_spec',
  'search_media',
  'synthesize_narration',
  'render_preview',
  'render_final',
] as const;

export interface SerializableAgentEvent {
  type: AgentEvent['type'];
  toolName?: string;
  summary: string;
  at: string;
  status?: 'info' | 'success' | 'error';
  detail?: string;
}

const usage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
};

const model: Model<'openai-responses'> = {
  id: 'picut-deterministic-planner',
  name: 'πCut Deterministic Planner',
  api: 'openai-responses',
  provider: 'picut-local',
  baseUrl: 'local://picut',
  reasoning: true,
  input: ['text'],
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
  contextWindow: 64_000,
  maxTokens: 8_000,
};

function configuredRemoteModels(): Model<'openai-completions'>[] {
  const primaryId = process.env.PICUT_MODEL_ID;
  const baseUrl = process.env.PICUT_MODEL_BASE_URL;
  const apiKey = getModelApiKey();
  if (!primaryId || !baseUrl || !apiKey) return [];
  const fallbackIds = (process.env.PICUT_MODEL_FALLBACK_IDS ?? process.env.PICUT_MODEL_FALLBACKS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const ids = [...new Set([primaryId, ...fallbackIds])];
  return ids.map((id) => ({
    id,
    name: id,
    api: 'openai-completions',
    provider: process.env.PICUT_MODEL_PROVIDER ?? 'siliconflow',
    baseUrl,
    reasoning: true,
    input: ['text'],
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
    contextWindow: 256_000,
    maxTokens: 16_384,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
      supportsUsageInStreaming: true,
      supportsStrictMode: true,
    },
  }));
}

function assistant(content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason,
    timestamp: Date.now(),
  };
}

function streamToolCall(call: ToolCall) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    const start = assistant([], 'pending');
    stream.push({type: 'start', partial: start});
    stream.push({type: 'toolcall_start', contentIndex: 0, partial: start});
    const complete = assistant([call], 'toolUse');
    stream.push({type: 'toolcall_end', contentIndex: 0, toolCall: call, partial: complete});
    stream.push({type: 'done', reason: 'toolUse', message: complete});
  });
  return stream;
}

function streamText(text: string) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    const start = assistant([], 'pending');
    stream.push({type: 'start', partial: start});
    stream.push({type: 'text_start', contentIndex: 0, partial: start});
    const complete = assistant([{type: 'text', text}], 'stop');
    stream.push({type: 'text_delta', contentIndex: 0, delta: text, partial: complete});
    stream.push({type: 'text_end', contentIndex: 0, content: text, partial: complete});
    stream.push({type: 'done', reason: 'stop', message: complete});
  });
  return stream;
}

function latestUserText(context: Context) {
  const message = [...context.messages].reverse().find((item) => item.role === 'user');
  if (!message || message.role !== 'user') return '';
  if (typeof message.content === 'string') return message.content;
  return message.content.filter((item) => item.type === 'text').map((item) => item.text).join(' ');
}

function deterministicStream(projectId: string): StreamFunction {
  return (_activeModel, context) => {
    const latest = context.messages.at(-1);
    const prompt = latestUserText(context);
    const wantsPreview = /预览渲染|渲染预览|导出预览|render\s+preview/i.test(prompt);
    const wantsFinal = /正式导出|导出(?:最终|成片|视频)|渲染成片|render\s+final|export\s+final/i.test(prompt);
    const wantsNarration = /(?:生成|合成|添加|配上).*(?:旁白|配音|语音|音频)|(?:旁白|配音|语音).*(?:生成|合成)|\btts\b/i.test(prompt);
    const wantsMedia = /(?:联网|搜索|查找|增加|添加|丰富|需要|想要|使用).*(?:实拍|真实)?(?:素材|图片|b-?roll|画面)|(?:实拍|真实)?(?:素材|b-?roll).*(?:搜索|添加|丰富|需要|想要|使用)|(?:素材|b-?roll)\s*$/i.test(prompt);
    if (latest?.role === 'toolResult') {
      if (latest.toolName === 'validate_spec') {
        const report = latest.details as {valid?: boolean; revision?: number} | undefined;
        if (report?.valid && (wantsPreview || wantsFinal)) {
          return streamToolCall({
            type: 'toolCall',
            id: `tool-${crypto.randomUUID()}`,
            name: wantsFinal ? 'render_final' : 'render_preview',
            arguments: {projectId, backend: 'remotion'},
          });
        }
        return streamText(
          report?.valid
            ? `观察完成：r${report.revision ?? '?'} 已通过全部阻断质量门，预览已同步。你可以继续修改局部参数、拖动时间轴，或导出视频。`
            : '观察完成：质量门发现阻断问题。我已保留当前版本，请根据检查结果继续修订。',
        );
      }
      if (latest.toolName === 'render_preview' || latest.toolName === 'render_final') {
        const rendered = latest.details as {backend?: string; mode?: string; video?: string} | undefined;
        return streamText(`渲染完成：${rendered?.backend ?? 'remotion'} ${rendered?.mode ?? 'final'} 产物已生成${rendered?.video ? `，视频路径 ${rendered.video}` : ''}。`);
      }
      if (latest.toolName === 'synthesize_narration') {
        return streamToolCall({type: 'toolCall', id: `tool-${crypto.randomUUID()}`, name: 'validate_spec', arguments: {projectId}});
      }
      if (latest.toolName === 'search_media') {
        return streamToolCall({type: 'toolCall', id: `tool-${crypto.randomUUID()}`, name: 'validate_spec', arguments: {projectId}});
      }
      if (latest.toolName === 'apply_spec_patch') {
        const patchResult = latest.details as {pendingApproval?: boolean; cancelled?: boolean; approved?: boolean; intent?: string} | undefined;
        if (patchResult?.pendingApproval) return streamText(`结构修改提案已暂存：${patchResult.intent ?? '待确认操作'}。我不会在你确认前改写时间轴。`);
        if (patchResult?.cancelled) return streamText('已拒绝并清除待确认的结构修改，当前版本保持不变。');
        if (patchResult?.approved) return streamToolCall({type: 'toolCall', id: `tool-${crypto.randomUUID()}`, name: 'validate_spec', arguments: {projectId}});
      }
      return streamToolCall({
        type: 'toolCall',
        id: `tool-${crypto.randomUUID()}`,
        name: 'validate_spec',
        arguments: {projectId},
      });
    }
    const wantsReset = /重新创建|重置项目|reset project/i.test(prompt);
    const wantsDraft = /创建|生成|做一|transformer|注意力|新建/i.test(prompt) && !/修改|改成|换成|延长|锁定|解锁/i.test(prompt);
    if (wantsPreview || wantsFinal) {
      return streamToolCall({
        type: 'toolCall',
        id: `tool-${crypto.randomUUID()}`,
        name: 'validate_spec',
        arguments: {projectId},
      });
    }
    if (wantsNarration) {
      return streamToolCall({
        type: 'toolCall',
        id: `tool-${crypto.randomUUID()}`,
        name: 'synthesize_narration',
        arguments: {projectId},
      });
    }
    if (wantsMedia) {
      return streamToolCall({type: 'toolCall', id: `tool-${crypto.randomUUID()}`, name: 'search_media', arguments: {projectId, query: prompt}});
    }
    return streamToolCall({
      type: 'toolCall',
      id: `tool-${crypto.randomUUID()}`,
      name: wantsReset ? 'create_project' : wantsDraft ? 'draft_storyboard' : 'apply_spec_patch',
      arguments: wantsReset ? {projectId, title: '60 秒理解 Transformer 注意力机制'} : {projectId, instruction: prompt},
    });
  };
}

function makeTools(projectId: string, directUserPrompt: string): AgentTool[] {
  const createProject: AgentTool = {
    name: 'create_project',
    label: '创建项目',
    description: '创建或重置一个 πCut 项目。',
    parameters: Type.Object({projectId: Type.String(), title: Type.Optional(Type.String())}),
    execute: async () => {
      const record = await resetProject(projectId);
      return {content: [{type: 'text', text: `项目 ${record.spec.project.title} 已创建`}], details: {revision: record.spec.revision}};
    },
  };
  const draftStoryboard: AgentTool = {
    name: 'draft_storyboard',
    label: '生成分镜',
    description: '由 π Agent 原生规划一条全新视频的 StorySpec 与 EditSpec；标题、叙事、镜头和画面参数必须针对用户本次需求从零生成。',
    parameters: Type.Object({
      projectId: Type.String({description: '当前项目 ID'}),
      title: Type.String({minLength: 2, maxLength: 80, description: '针对本次需求创作的视频标题'}),
      logline: Type.String({minLength: 4, maxLength: 240, description: '一句话叙事目标'}),
      audience: Type.String({minLength: 2, maxLength: 160, description: '目标观众'}),
      durationSeconds: Type.Number({minimum: 0.1, maximum: 180, description: '用户要求的总时长，必须精确遵守'}),
      theme: Type.Union([
        Type.Literal('editorial'), Type.Literal('science'), Type.Literal('nature'),
        Type.Literal('warm'), Type.Literal('neon'), Type.Literal('minimal'),
      ], {description: '与主题匹配的视觉主题'}),
      scenes: Type.Array(Type.Object({
        purpose: Type.String({minLength: 2, maxLength: 180}),
        narration: Type.String({minLength: 1, maxLength: 500}),
        visualIntent: Type.String({minLength: 2, maxLength: 300}),
        tempo: Type.Union([Type.Literal('calm'), Type.Literal('steady'), Type.Literal('fast')]),
        durationSeconds: Type.Number({minimum: 0.1, maximum: 180}),
        visualType: Type.Union([Type.Literal('hero'), Type.Literal('split'), Type.Literal('chart'), Type.Literal('caption'), Type.Literal('media')]),
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
        mediaQuery: Type.Optional(Type.String({minLength: 2, maxLength: 180, description: '英文 Wikimedia Commons 检索词，仅 media 镜头需要'})),
        evidenceRefs: Type.Optional(Type.Array(Type.String({minLength: 1, maxLength: 160}), {maxItems: 8})),
        mustShow: Type.Optional(Type.Array(Type.String({minLength: 1, maxLength: 80}), {maxItems: 8})),
        mustAvoid: Type.Optional(Type.Array(Type.String({minLength: 1, maxLength: 120}), {maxItems: 8})),
      }), {minItems: 1, maxItems: 12}),
    }),
    execute: async (_id, params) => {
      const plan = params as unknown as AgentVideoPlan & {projectId: string};
      const spec = videoSpecFromAgentPlan(projectId, directUserPrompt, plan);
      const record = await replaceProject(projectId, spec);
      const mediaQueries = record.spec.editSpec.scenes
        .map((scene) => typeof scene.props.mediaQuery === 'string' ? scene.props.mediaQuery : null)
        .filter((query): query is string => Boolean(query));
      return {
        content: [{type: 'text', text: `已生成 ${record.spec.project.title}，共 ${record.spec.storySpec.scenes.length} 个分镜`}],
        details: {revision: record.spec.revision, sceneCount: record.spec.storySpec.scenes.length, generatedFromScratch: true, mediaQueries},
      };
    },
  };
  const applyPatch: AgentTool = {
    name: 'apply_spec_patch',
    label: '应用 VideoSpec Patch',
    description: '将自然语言编辑意图转换为可审计的 ChangeSet 并应用。',
    parameters: Type.Object({projectId: Type.String(), instruction: Type.String()}),
    execute: async (_id, params) => {
      const instruction = (params as {instruction: string}).instruction;
      if (/取消|拒绝|不同意|reject|cancel/i.test(instruction)) {
        const record = await rejectPendingChangeSet(projectId);
        return {
          content: [{type: 'text', text: '已取消待确认的结构修改'}],
          details: {revision: record.spec.revision, cancelled: true},
        };
      }
      if (/确认|批准|同意|approve|confirm/i.test(instruction)) {
        const before = await getProject(projectId);
        const pending = before.pendingChangeSet;
        const record = await approvePendingChangeSet(projectId);
        return {
          content: [{type: 'text', text: pending ? `已确认结构修改并提交到 r${record.spec.revision}` : '当前没有待确认的结构修改'}],
          details: {revision: record.spec.revision, approved: Boolean(pending), intent: pending?.intent},
        };
      }
      const record = await getProject(projectId);
      const changeSet = changeSetFromInstruction(record.spec, instruction, 'agent');
      if (changeSet.approval === 'pending') {
        await stagePendingChangeSet(projectId, changeSet);
        return {
          content: [{type: 'text', text: '该操作属于结构重构，已生成待确认 ChangeSet'}],
          details: {pendingApproval: true, intent: changeSet.intent, changeSetId: changeSet.changeSetId, risk: changeSet.risk},
        };
      }
      const updated = await updateProject(projectId, changeSet);
      return {
        content: [{type: 'text', text: `ChangeSet ${changeSet.changeSetId} 已应用到 r${updated.spec.revision}`}],
        details: {revision: updated.spec.revision, changeSet},
      };
    },
  };
  const validateSpec: AgentTool = {
    name: 'validate_spec',
    label: '运行 G1-G7',
    description: '运行 VideoSpec 七级质量门。',
    parameters: Type.Object({projectId: Type.String()}),
    execute: async () => {
      const repaired = await autoRepairProject(projectId, 3);
      const report = repaired.validation;
      const repairSummary = repaired.repairs.length ? `，已自动完成 ${repaired.repairs.length} 项修复` : '';
      return {content: [{type: 'text', text: report.valid ? `G1-G7 无阻断项${repairSummary}` : `自动迭代 ${repaired.attempts} 轮后仍有阻断项，已保留可预览草稿`}], details: {...report, repairs: repaired.repairs, repairAttempts: repaired.attempts}};
    },
  };
  const synthesizeNarration: AgentTool = {
    name: 'synthesize_narration',
    label: '合成旁白',
    description: '按分镜调用服务端 TTS，校准时长、生成真实波形并写入 VideoSpec 音频资产。',
    parameters: Type.Object({
      projectId: Type.String(),
      model: Type.Optional(Type.String()),
      voice: Type.Optional(Type.String()),
      speed: Type.Optional(Type.Number({minimum: 0.25, maximum: 4})),
      gainDb: Type.Optional(Type.Number({minimum: -10, maximum: 10})),
    }),
    execute: async (_id, params) => {
      const {synthesizeProjectNarration} = await import('@/lib/audio/service');
      const request = params as {model?: string; voice?: string; speed?: number; gainDb?: number};
      const result = await synthesizeProjectNarration(projectId, request);
      return {
        content: [{type: 'text', text: `已合成 ${result.audio.segments.length} 段旁白并完成音画对齐`}],
        details: {revision: result.spec.revision, masterUrl: result.audio.masterUrl, segments: result.audio.segments},
      };
    },
  };
  const searchMedia: AgentTool = {
    name: 'search_media',
    label: '联网搜索素材',
    description: '根据当前 VideoSpec 与用户指代，按主题路由到 NOAA Ocean Explorer、NASA Image Library、Wikimedia Commons 等可信来源，自动换源搜索带作者、许可和来源的视觉素材，下载到项目资产库并注入 MediaBroll 镜头。用户只说“需要实拍素材”时也应直接调用，不要重复询问当前项目已经具备的主题、时长和观众。',
    parameters: Type.Object({projectId: Type.String(), query: Type.Optional(Type.String())}),
    execute: async (_id, params) => {
      const {enrichProjectWithCommonsMedia} = await import('@/lib/research/wikimedia');
      const query = (params as {query?: string}).query;
      const result = await enrichProjectWithCommonsMedia(projectId, query);
      const text = result.degraded
        ? result.assets.length
          ? `已自动换源并注入 ${result.assets.length} 个 B-roll；部分目标暂未找到，工作台与当前视频不受阻断`
          : result.message ?? '可信素材源暂不可用，已保留当前可编辑视频且不阻断工作台'
        : `已检索、授权过滤并注入 ${result.assets.length} 个 B-roll 素材`;
      return {content: [{type: 'text', text}], details: {revision: result.spec.revision, assets: result.assets, degraded: result.degraded, warnings: result.warnings}};
    },
  };
  const renderPreview: AgentTool = {
    name: 'render_preview',
    label: '渲染预览',
    description: '在 G1-G7 无阻断项后，使用 Remotion 或 HyperFrames 生成可检查的预览产物。',
    parameters: Type.Object({
      projectId: Type.String(),
      backend: Type.Optional(Type.Union([Type.Literal('remotion'), Type.Literal('hyperframes'), Type.Literal('auto')])),
    }),
    execute: async (_id, params) => {
      const backend = (params as {backend?: 'remotion' | 'hyperframes' | 'auto'}).backend ?? 'auto';
      const repaired = await autoRepairProject(projectId, 3);
      const validation = repaired.validation;
      if (!validation.valid) {
        return {
          content: [{type: 'text', text: '已自动修复可确定问题；剩余问题不会关闭工作台实时预览，仅暂停生成独立预览文件'}],
          details: {...validation, repairs: repaired.repairs, previewStillAvailable: true},
        };
      }
      const {renderProject} = await import('@/lib/render/service');
      const result = await renderProject(projectId, backend, 'preview');
      return {
        content: [{type: 'text', text: `${backend} 预览已生成：${result.urls.video}`}],
        details: {backend: result.manifest.backend, requestedBackend: backend, routing: result.routing, mode: 'preview', video: result.urls.video, manifest: result.urls.manifest},
      };
    },
  };
  const renderFinal: AgentTool = {
    name: 'render_final',
    label: '正式导出',
    description: '仅在用户本轮明确要求正式导出时，通过质量门后生成不可变成片与交付清单。',
    parameters: Type.Object({
      projectId: Type.String(),
      backend: Type.Optional(Type.Union([Type.Literal('remotion'), Type.Literal('hyperframes'), Type.Literal('auto')])),
    }),
    execute: async (_id, params) => {
      const explicitlyAuthorized = /正式导出|导出(?:最终|成片|视频)|渲染成片|render\s+final|export\s+final/i.test(directUserPrompt);
      if (!explicitlyAuthorized) {
        return {
          content: [{type: 'text', text: '正式导出属于高影响操作，需要用户明确确认'}],
          details: {pendingApproval: true, action: 'render_final'},
          terminate: true,
        };
      }
      const backend = (params as {backend?: 'remotion' | 'hyperframes' | 'auto'}).backend ?? 'auto';
      const repaired = await autoRepairProject(projectId, 3);
      const validation = repaired.validation;
      if (!validation.valid) {
        return {
          content: [{type: 'text', text: '正式导出被 G1-G7 阻断'}],
          details: validation,
          terminate: true,
        };
      }
      const {renderProject} = await import('@/lib/render/service');
      const result = await renderProject(projectId, backend, 'final');
      return {
        content: [{type: 'text', text: `${backend} 正式成片已生成：${result.urls.video}`}],
        details: {backend: result.manifest.backend, requestedBackend: backend, routing: result.routing, mode: 'final', video: result.urls.video, manifest: result.urls.manifest},
      };
    },
  };
  return [createProject, draftStoryboard, applyPatch, validateSpec, searchMedia, synthesizeNarration, renderPreview, renderFinal];
}

function eventSummary(event: AgentEvent) {
  switch (event.type) {
    case 'agent_start': return 'π Agent 开始观察任务';
    case 'agent_end': return 'π Agent 完成本轮循环';
    case 'turn_start': return '开始推理与工具选择';
    case 'turn_end': return '完成一次 Observe → Act';
    case 'tool_execution_start': return `调用 ${event.toolName}`;
    case 'tool_execution_end': return `${event.toolName} ${event.isError ? '失败' : (event.result as {details?: {degraded?: boolean}} | undefined)?.details?.degraded ? '已降级，工作台继续可用' : '完成'}`;
    case 'message_end': return '生成协作回复';
    default: return event.type;
  }
}

function persistedConversation(record: ProjectRecord, activeModel: Model<string>): AgentMessage[] {
  return record.chatMessages.slice(-12).map((message): AgentMessage => {
    const timestamp = Number.isFinite(Date.parse(message.createdAt)) ? Date.parse(message.createdAt) : Date.now();
    if (message.role === 'human') return {role: 'user', content: message.text, timestamp};
    return {
      role: 'assistant',
      content: [{type: 'text', text: message.text}],
      api: activeModel.api,
      provider: activeModel.provider,
      model: activeModel.id,
      usage,
      stopReason: 'stop',
      timestamp,
    };
  });
}

function currentProjectContext(record: ProjectRecord) {
  const {spec} = record;
  const scenes = spec.editSpec.scenes.map((scene) => {
    const story = spec.storySpec.scenes.find((item) => item.id === scene.id);
    const mediaQuery = typeof scene.props.mediaQuery === 'string' ? scene.props.mediaQuery : '';
    return `${scene.id}: ${scene.component}, ${(scene.durationFrames / spec.canvas.fps).toFixed(1)}s, 目的=${story?.purpose ?? '未填写'}, 旁白=${story?.narration ?? '未填写'}${mediaQuery ? `, 素材检索词=${mediaQuery}` : ''}`;
  });
  const assets = spec.assets.map((asset) => `${asset.id}:${asset.kind}${asset.sourceUrl ? ` source=${asset.sourceUrl}` : ''}`).slice(-16);
  return `\n\n【当前持久化会话上下文】\n项目：${spec.project.title}\n项目 ID：${spec.project.id}\n当前版本：r${spec.revision}\n目标时长：${(spec.project.targetDurationMs / 1000).toFixed(1)} 秒\n叙事目标：${spec.storySpec.logline}\n目标观众：${spec.storySpec.audience}\n分镜：\n- ${scenes.join('\n- ')}\n已有资产：${assets.length ? assets.join('；') : '无'}\n待确认结构修改：${record.pendingChangeSet?.intent ?? '无'}\n规则：本轮中的“这个视频”“它”“素材”“实拍”等省略表达都指向上述当前项目。不要重复询问这里已有的主题、时长、观众或旁白语言；应基于当前 VideoSpec 直接选择并调用工具。`;
}

function eventDetail(event: AgentEvent) {
  if (event.type !== 'tool_execution_end') return undefined;
  const content = (event.result as {content?: Array<{type?: string; text?: string}>} | undefined)?.content;
  return content?.filter((item) => item.type === 'text' && item.text).map((item) => item.text).join(' · ')
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .slice(0, 420);
}

export async function runPiCutAgent(projectId: string, prompt: string, options: {requireRemote?: boolean; creatingProject?: boolean} = {}) {
  const mode = process.env.PICUT_AGENT_MODE ?? 'auto';
  if (mode === 'local') {
    if (options.requireRemote) throw new Error('新建视频必须调用远程 π Agent，当前服务配置为本地模式');
    return executeAgent(projectId, prompt, model, deterministicStream(projectId), 'local');
  }

  const remotes = configuredRemoteModels();
  if (remotes.length === 0) {
    if (mode === 'remote' || options.requireRemote) throw new Error('远程 π Agent 缺少服务端模型配置');
    return executeAgent(projectId, prompt, model, deterministicStream(projectId), 'local-fallback');
  }

  const failures: string[] = [];
  for (const remote of remotes) {
    try {
      const result = await executeAgent(projectId, prompt, remote, streamSimple, 'remote', options);
      return {...result, attemptedModels: [...failures.map((item) => item.split(': ')[0]), remote.id]};
    } catch (error) {
      failures.push(`${remote.id}: ${error instanceof Error ? error.message : '远程模型不可用'}`);
    }
  }

  if (mode === 'remote' || options.requireRemote) throw new Error(`所有远程 π Agent 模型均失败：${failures.map((item) => item.replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]')).join(' | ')}`);
  const fallback = await executeAgent(projectId, prompt, model, deterministicStream(projectId), 'local-fallback');
  return {...fallback, attemptedModels: remotes.map((item) => item.id), fallbackReason: failures.at(-1)};
}

async function executeAgent(
  projectId: string,
  prompt: string,
  activeModel: Model<string>,
  streamFn: StreamFunction,
  executionMode: 'remote' | 'local' | 'local-fallback',
  options: {creatingProject?: boolean} = {},
) {
  const events: SerializableAgentEvent[] = [];
  const existingRecord = options.creatingProject ? null : await getProject(projectId);
  const sessionContext = existingRecord ? currentProjectContext(existingRecord) : '';
  const agent = new Agent({
    initialState: {
      systemPrompt: `你是 πCut 的原生 π Agent 导演与剪辑师。以 VideoSpec 为唯一事实源，严格遵循 ReAct：观察当前任务，调用项目工具，观察工具结果，再调用 validate_spec，最后用简洁中文汇报。${options.creatingProject ? '这是一个全新空白会话：必须直接调用 draft_storyboard，并在工具参数中从零完成完整的视频规划；严禁复用 Transformer、云朵或任何示例文案，严禁只回复文字而不调用工具。' : '创建新视频调用 draft_storyboard；局部修改与结构提案调用 apply_spec_patch。'} 时长不超过 15 秒时规划 3–5 个节奏紧凑的镜头，16–60 秒规划 4–8 个镜头，更长视频规划 6–12 个镜头；镜头必须在 hero、split、chart、caption、media 中形成视觉变化。涉及现实世界主体或用户要求丰富素材时，至少规划一个 media 镜头并提供准确的英文 mediaQuery；图表只有在有意义的数据和等长 labels/values 时使用。旁白要能在镜头时长内自然说完。生成配音调用 synthesize_narration；用户说需要实拍、真实画面或素材时，立即基于当前分镜的英文 mediaQuery 调用 search_media，不要重新询问当前项目已有信息；用户确认或拒绝待审批结构修改时调用 apply_spec_patch 并传入原话；预览渲染调用 render_preview，默认将 backend 设为 auto 让路由器根据镜头和音频自主选择；只有用户明确要求正式导出时调用 render_final，默认 backend 同样设为 auto，且渲染前必须 validate_spec。只有用户明确要求重置时才调用 create_project。不要臆造工具结果，不要输出 JSON 或代码代替工具调用。项目 ID：${projectId}。${sessionContext}`,
      model: activeModel,
      thinkingLevel: 'medium',
      tools: makeTools(projectId, prompt),
      messages: existingRecord ? persistedConversation(existingRecord, activeModel) : [],
    },
    streamFn,
    getApiKey: getModelApiKey,
    toolExecution: 'sequential',
    sessionId: projectId,
    shouldStopAfterTurn: ({newMessages}) => newMessages.filter((item) => item.role === 'assistant').length >= 6,
  });
  agent.subscribe((event) => {
    if (event.type === 'message_update' || event.type === 'tool_execution_update' || event.type === 'message_start') return;
    events.push({
      type: event.type,
      toolName: 'toolName' in event ? event.toolName : undefined,
      summary: eventSummary(event),
      at: new Date().toISOString(),
      status: event.type === 'tool_execution_end' ? event.isError || (event.result as {details?: {degraded?: boolean}} | undefined)?.details?.degraded ? 'error' : 'success' : 'info',
      detail: eventDetail(event),
    });
  });
  await agent.prompt(prompt);
  if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
  const record = await getProject(projectId);
  const lastAssistant = [...agent.state.messages].reverse().find((message) => message.role === 'assistant');
  const modelResponse = lastAssistant?.role === 'assistant'
    ? lastAssistant.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
    : '任务已完成。';
  const response = record.pendingChangeSet
    ? `已生成高风险结构修改提案「${record.pendingChangeSet.intent}」。当前仍保持 r${record.spec.revision}，确认前不会改写 VideoSpec 或时间轴。`
    : options.creatingProject && (!modelResponse || modelResponse === '任务已完成。')
      ? `已由 π Agent 从零生成「${record.spec.project.title}」：${record.spec.storySpec.scenes.length} 个分镜，${(record.spec.project.targetDurationMs / 1000).toFixed(1)} 秒，已完成 VideoSpec 校验与独立会话持久化。`
      : modelResponse || '任务已完成。';
  const generatedFromScratch = events.some((event) => event.type === 'tool_execution_end' && event.toolName === 'draft_storyboard');
  if (options.creatingProject && !generatedFromScratch) throw new Error('π Agent 未执行 draft_storyboard，本次创建已拒绝，未回退到预设视频');
  return {response, events, spec: record.spec, validation: validateVideoSpec(record.spec), pendingApproval: record.pendingChangeSet, executionMode, model: activeModel.id, generatedFromScratch};
}
