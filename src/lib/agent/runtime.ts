import 'server-only';

import {Agent, type AgentEvent, type AgentTool} from '@earendil-works/pi-agent-core';
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
  getProject,
  rejectPendingChangeSet,
  resetProject,
  stagePendingChangeSet,
  updateProject,
} from '@/lib/project/store';
import {getModelApiKey} from '@/lib/server/model-secret';
import {validateVideoSpec} from '@/lib/video-spec/validation';
import {changeSetFromInstruction} from './prompt-patch';

export const PICUT_AGENT_TOOL_NAMES = [
  'create_project',
  'draft_storyboard',
  'apply_spec_patch',
  'validate_spec',
  'render_preview',
  'render_final',
] as const;

export interface SerializableAgentEvent {
  type: AgentEvent['type'];
  toolName?: string;
  summary: string;
  at: string;
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
    description: '读取或生成 StorySpec 与 EditSpec 双层分镜。',
    parameters: Type.Object({projectId: Type.String(), instruction: Type.Optional(Type.String())}),
    execute: async () => {
      const record = await getProject(projectId);
      return {
        content: [{type: 'text', text: `已观察并生成 ${record.spec.storySpec.scenes.length} 个分镜`}],
        details: {revision: record.spec.revision, sceneCount: record.spec.storySpec.scenes.length},
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
      const record = await getProject(projectId);
      const report = validateVideoSpec(record.spec);
      return {content: [{type: 'text', text: report.valid ? 'G1-G7 无阻断项' : '质量门未通过'}], details: report};
    },
  };
  const renderPreview: AgentTool = {
    name: 'render_preview',
    label: '渲染预览',
    description: '在 G1-G7 无阻断项后，使用 Remotion 或 HyperFrames 生成可检查的预览产物。',
    parameters: Type.Object({
      projectId: Type.String(),
      backend: Type.Optional(Type.Union([Type.Literal('remotion'), Type.Literal('hyperframes')])),
    }),
    execute: async (_id, params) => {
      const backend = (params as {backend?: 'remotion' | 'hyperframes'}).backend ?? 'remotion';
      const record = await getProject(projectId);
      const validation = validateVideoSpec(record.spec);
      if (!validation.valid) {
        return {
          content: [{type: 'text', text: '预览渲染被 G1-G7 阻断'}],
          details: validation,
          terminate: true,
        };
      }
      const {renderProject} = await import('@/lib/render/service');
      const result = await renderProject(projectId, backend, 'preview');
      return {
        content: [{type: 'text', text: `${backend} 预览已生成：${result.urls.video}`}],
        details: {backend, mode: 'preview', video: result.urls.video, manifest: result.urls.manifest},
      };
    },
  };
  const renderFinal: AgentTool = {
    name: 'render_final',
    label: '正式导出',
    description: '仅在用户本轮明确要求正式导出时，通过质量门后生成不可变成片与交付清单。',
    parameters: Type.Object({
      projectId: Type.String(),
      backend: Type.Optional(Type.Union([Type.Literal('remotion'), Type.Literal('hyperframes')])),
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
      const backend = (params as {backend?: 'remotion' | 'hyperframes'}).backend ?? 'remotion';
      const record = await getProject(projectId);
      const validation = validateVideoSpec(record.spec);
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
        details: {backend, mode: 'final', video: result.urls.video, manifest: result.urls.manifest},
      };
    },
  };
  return [createProject, draftStoryboard, applyPatch, validateSpec, renderPreview, renderFinal];
}

function eventSummary(event: AgentEvent) {
  switch (event.type) {
    case 'agent_start': return 'π Agent 开始观察任务';
    case 'agent_end': return 'π Agent 完成本轮循环';
    case 'turn_start': return '开始推理与工具选择';
    case 'turn_end': return '完成一次 Observe → Act';
    case 'tool_execution_start': return `调用 ${event.toolName}`;
    case 'tool_execution_end': return `${event.toolName} ${event.isError ? '失败' : '完成'}`;
    case 'message_end': return '生成协作回复';
    default: return event.type;
  }
}

export async function runPiCutAgent(projectId: string, prompt: string) {
  const mode = process.env.PICUT_AGENT_MODE ?? 'auto';
  if (mode === 'local') return executeAgent(projectId, prompt, model, deterministicStream(projectId), 'local');

  const remotes = configuredRemoteModels();
  if (remotes.length === 0) {
    if (mode === 'remote') throw new Error('远程 Agent 模式缺少服务端模型配置');
    return executeAgent(projectId, prompt, model, deterministicStream(projectId), 'local-fallback');
  }

  const failures: string[] = [];
  for (const remote of remotes) {
    try {
      const result = await executeAgent(projectId, prompt, remote, streamSimple, 'remote');
      return {...result, attemptedModels: [...failures.map((item) => item.split(': ')[0]), remote.id]};
    } catch (error) {
      failures.push(`${remote.id}: ${error instanceof Error ? error.message : '远程模型不可用'}`);
    }
  }

  if (mode === 'remote') throw new Error(`所有远程模型均失败：${failures.join(' | ')}`);
  const fallback = await executeAgent(projectId, prompt, model, deterministicStream(projectId), 'local-fallback');
  return {...fallback, attemptedModels: remotes.map((item) => item.id), fallbackReason: failures.at(-1)};
}

async function executeAgent(
  projectId: string,
  prompt: string,
  activeModel: Model<string>,
  streamFn: StreamFunction,
  executionMode: 'remote' | 'local' | 'local-fallback',
) {
  const events: SerializableAgentEvent[] = [];
  const agent = new Agent({
    initialState: {
      systemPrompt: `你是 πCut 剪辑 Agent。以 VideoSpec 为唯一事实源，严格遵循 ReAct：观察当前任务，调用且只调用最合适的项目工具，观察工具结果，再调用 validate_spec，最后用简洁中文汇报。创建视频调用 draft_storyboard；局部修改与结构提案调用 apply_spec_patch；用户确认或拒绝待审批结构修改时，仍调用 apply_spec_patch 但传入用户的原话；预览渲染调用 render_preview；仅在用户本轮明确要求正式导出时调用 render_final，并且渲染前必须先调用 validate_spec。只有用户明确要求重置时才调用 create_project。不要臆造工具结果，不要输出 JSON 或代码代替工具调用。项目 ID：${projectId}。`,
      model: activeModel,
      thinkingLevel: 'medium',
      tools: makeTools(projectId, prompt),
    },
    streamFn,
    getApiKey: getModelApiKey,
    toolExecution: 'sequential',
    shouldStopAfterTurn: ({newMessages}) => newMessages.filter((item) => item.role === 'assistant').length >= 6,
  });
  agent.subscribe((event) => {
    if (event.type === 'message_update' || event.type === 'tool_execution_update' || event.type === 'message_start') return;
    events.push({
      type: event.type,
      toolName: 'toolName' in event ? event.toolName : undefined,
      summary: eventSummary(event),
      at: new Date().toISOString(),
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
    : modelResponse || '任务已完成。';
  return {response, events, spec: record.spec, validation: validateVideoSpec(record.spec), pendingApproval: record.pendingChangeSet, executionMode, model: activeModel.id};
}
