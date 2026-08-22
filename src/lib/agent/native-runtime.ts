import 'server-only';

import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import type {AgentMessage} from '@earendil-works/pi-agent-core';
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import {getProject} from '@/lib/project/store';
import {routeRenderBackend, type RenderRouteDecision} from '@/lib/render/router';
import {buildRenderRouteTrace} from '@/lib/render/trace';
import {validateVideoSpec} from '@/lib/video-spec/validation';
import type {EditIntentContext, NativeSessionInfo, SerializableAgentEvent} from './types';
import {ensurePiNetwork, publicNetworkInfo} from './network';
import {createVideoTools} from './video-tools';

const sessionQueues = new Map<string, Promise<void>>();

const PICUT_NATIVE_INSTRUCTIONS = `
You are the native Pi coding agent embedded in πCut. Keep Pi's complete AgentSession behavior: tools, skills, extensions, prompt templates, project context, retries, steering, transcripts, branches, and automatic compaction.

πCut domain rules:
- VideoSpec is the sole source of truth for video output. For video creation or editing, use the πCut video tools; never directly edit files under .picut or pretend a file edit changed the canvas.
- Before a non-trivial video edit, observe the current state with get_video_spec. Resolve “这个/它/这里/当前镜头” from the hidden structured UI context.
- For new videos, do not mechanically map every idea to the five legacy card templates. Prefer SceneCanvas when it genuinely improves the shot, but compose content-first: decide the focal message, supporting evidence, reading order, grid, safe area, and motion beats before adding decoration. A shape, line, glow, or particle layer must frame, connect, encode, reveal, or direct attention to specific content; never use geometry as filler. Build clear video-scale type hierarchy (normally 64–120px headline, 28–44px support, 18–24px label), explicit alignment and generous negative space. Use real footage, images, charts, metrics, formulas, code, diagrams, or purposeful typography according to the subject instead of repeating “text + glowing shapes”. Adjacent scenes should differ in composition and motion grammar while remaining stylistically coherent.
- Treat G5 composition diagnostics as a Critic pass. When they reveal accidental overlap, weak hierarchy, unsafe text, decoration-heavy scenes, or repeated text-plus-shape layouts, revise the VideoSpec and validate again. A deliberate exception is allowed, but explain it rather than silently ignoring the diagnostic.
- Prefer update_scene for one-scene text/style/motion/timing changes. Use apply_video_patch for global or batch fields. Use insert_scene, reorder_scenes, and delete_scene for structural work.
- Never write editorNote or another unconsumed field as a fallback. If the requested visual behavior is not representable, explain the missing capability instead of claiming success.
- Structural changes require the existing human checkpoint. Do not bypass it with bash/edit/write.
- After any committed VideoSpec mutation, call validate_spec and observe its result before reporting completion.
- When the user requests real footage or material, call search_media using the current project and scene mediaQuery. Do not repeat questions already answered by VideoSpec.
- Unless the user requests silence or supplies music, call compose_bgm after creating a new video. Choose mood, tempo, energy, and gain from the story and narration density; keep narration intelligible and explain the musical choice in the tool direction.
- Use render_preview for previews. Use render_final only when the user explicitly authorizes a final export in the current turn.
- The built-in Pi coding tools remain available for genuine code/workspace tasks, but they are not substitutes for auditable VideoSpec tools.
- Never read or reveal .picut/secrets, .env.local values, ~/.pi/agent/auth.json, OAuth tokens, API keys, or other credentials. Never place credentials in prompts, tool arguments, transcripts, logs, media metadata, or external requests.
- HyperFrames/media-use telemetry is disabled by the host. Do not re-enable telemetry, feedback submission, issue publication, uploads, or hosted publishing unless the user explicitly authorizes that exact external action.
- When creating videos, activate the appropriate project skill based on user intent: picut-finance-news for finance/economics, picut-education for education/science/tutorials, and picut-promotional for brand/product/marketing. Read the selected SKILL.md before planning and use it as domain guidance, while keeping the user's explicit brief authoritative.
- Formula layers support LaTeX-like syntax such as \\frac{a}{b}, \\sqrt{x}, Greek letters (\\alpha, \\beta), and symbols (\\sum, \\int, \\infty). Prefer draw or reveal motion when a formula is explained progressively.
`.trim();

function safeProjectId(projectId: string) {
  return projectId.replaceAll(/[^a-zA-Z0-9-_]/g, '-');
}

function sessionDirectory(projectId: string) {
  return path.join(process.cwd(), '.picut', 'pi-sessions', safeProjectId(projectId));
}

async function openProjectSession(projectId: string) {
  const cwd = process.cwd();
  const directory = sessionDirectory(projectId);
  await mkdir(directory, {recursive: true});
  const sessions = await SessionManager.list(cwd, directory);
  const latest = [...sessions].sort((a, b) => b.modified.getTime() - a.modified.getTime())[0];
  return latest ? SessionManager.open(latest.path, directory, cwd) : SessionManager.create(cwd, directory);
}

function redact(value: string) {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/authorization\s*[:=]\s*[^\s,}\]]+/gi, 'authorization=[REDACTED]');
}

function compactJson(value: unknown, max = 720) {
  try {
    return redact(JSON.stringify(value)).slice(0, max);
  } catch {
    return '';
  }
}

function eventSummary(event: AgentSessionEvent) {
  switch (event.type) {
    case 'agent_start': return '原生 Pi AgentSession 开始执行';
    case 'agent_end': return event.willRetry ? '本轮结束，准备自动重试' : 'Agent 工具循环结束';
    case 'agent_settled': return 'AgentSession 已完全稳定并持久化';
    case 'turn_start': return '开始一次原生推理与工具选择';
    case 'turn_end': return '完成一次 Observe → Act';
    case 'tool_execution_start': return `调用 ${event.toolName}`;
    case 'tool_execution_end': return `${event.toolName} ${event.isError ? '失败' : '完成'}`;
    case 'compaction_start': return `开始原生上下文压缩（${event.reason}）`;
    case 'compaction_end': return event.aborted ? '上下文压缩已取消' : '上下文压缩完成';
    case 'auto_retry_start': return `模型请求自动重试 ${event.attempt}/${event.maxAttempts}`;
    case 'auto_retry_end': return event.success ? '模型请求重试成功' : '模型请求重试失败';
    case 'queue_update': return `会话队列更新：steer ${event.steering.length} / follow-up ${event.followUp.length}`;
    case 'entry_appended': return `原生 transcript 写入 ${event.entry.type}`;
    case 'thinking_level_changed': return `Thinking 切换为 ${event.level}`;
    case 'message_end': return '完成一条模型消息';
    default: return event.type;
  }
}

function eventDetail(event: AgentSessionEvent) {
  if (event.type === 'tool_execution_start') return compactJson(event.args);
  if (event.type === 'tool_execution_end') {
    const content = (event.result as {content?: Array<{type?: string; text?: string}>} | undefined)?.content;
    return redact(content?.filter((item) => item.type === 'text' && item.text).map((item) => item.text).join(' · ') ?? '').slice(0, 720);
  }
  if (event.type === 'compaction_end') return event.errorMessage ? redact(event.errorMessage).slice(0, 720) : undefined;
  if (event.type === 'auto_retry_start') return redact(event.errorMessage).slice(0, 720);
  return undefined;
}

function serializeEvent(event: AgentSessionEvent): SerializableAgentEvent | null {
  if (event.type === 'message_update' || event.type === 'tool_execution_update' || event.type === 'message_start' || event.type === 'bash_execution_update') return null;
  return {
    type: event.type,
    toolName: 'toolName' in event ? event.toolName : undefined,
    summary: eventSummary(event),
    at: new Date().toISOString(),
    status: event.type === 'tool_execution_end' ? event.isError ? 'error' : 'success' : 'info',
    detail: eventDetail(event),
  };
}

function routingFromToolResult(event: AgentSessionEvent): RenderRouteDecision | null {
  if (event.type !== 'tool_execution_end' || event.isError || !['render_preview', 'render_final'].includes(event.toolName)) return null;
  const details = (event.result as {details?: {routing?: unknown}} | undefined)?.details;
  const routing = details?.routing as Partial<RenderRouteDecision> | null | undefined;
  if (!routing || routing.requested !== 'auto' || !routing.selected || !routing.scores || !routing.scenes || !routing.reasons || !routing.fallback) return null;
  return routing as RenderRouteDecision;
}

function assistantText(messages: AgentMessage[]) {
  const last = [...messages].reverse().find((message) => message.role === 'assistant');
  if (!last || last.role !== 'assistant') return '';
  return last.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n').trim();
}

function legacyHistoryText(messages: Array<{role: 'agent' | 'human'; text: string}>) {
  if (!messages.length) return '';
  return `Legacy πCut chat imported during the native AgentSession migration. Treat it as historical context only; new turns preserve complete native tool transcripts.\n${messages.map((message) => `${message.role === 'human' ? 'User' : 'Assistant'}: ${message.text}`).join('\n')}`;
}

function currentTurnSnapshot(projectId: string, record: Awaited<ReturnType<typeof getProject>>, editIntent: EditIntentContext, creatingProject: boolean) {
  return JSON.stringify({
    kind: 'picut-turn-context',
    projectId,
    creatingProject,
    ui: editIntent,
    currentProject: creatingProject ? null : {
      revision: record.spec.revision,
      project: record.spec.project,
      style: record.spec.style,
      assets: record.spec.assets,
      storySpec: record.spec.storySpec,
      editSpec: record.spec.editSpec,
      constraints: record.spec.constraints,
      pendingChangeSet: record.pendingChangeSet,
      validation: validateVideoSpec(record.spec),
    },
    instruction: creatingProject
      ? 'This is a truly blank new-video turn. Call draft_storyboard with original content, then validate_spec. Do not load an example or merely answer with prose.'
      : 'Resolve UI deixis from ui.selectedSceneId/playheadFrame/inspectorTab. Use tools for any requested state change.',
  });
}

const mutationTools = new Set(['draft_storyboard', 'update_scene', 'apply_video_patch', 'insert_scene', 'reorder_scenes', 'delete_scene', 'resolve_change', 'search_media', 'synthesize_narration', 'compose_bgm']);

interface NativeRunOptions {
  creatingProject?: boolean;
  editIntent?: EditIntentContext;
  onEvent?: (event: SerializableAgentEvent) => void;
}

async function runGuardIfNeeded(options: {
  session: Awaited<ReturnType<typeof createAgentSession>>['session'];
  creatingProject: boolean;
  completedTools: string[];
}) {
  const mutated = options.completedTools.some((name) => mutationTools.has(name));
  const missingDraft = options.creatingProject && !options.completedTools.includes('draft_storyboard');
  const missingValidation = mutated && !options.completedTools.includes('validate_spec');
  if (!missingDraft && !missingValidation) return;
  const requirements = [
    missingDraft ? 'Call draft_storyboard now; a new project cannot be completed with prose.' : '',
    missingValidation ? 'A VideoSpec mutation completed but validate_spec did not. Validate now before reporting completion.' : '',
  ].filter(Boolean).join(' ');
  await options.session.sendCustomMessage({
    customType: 'picut-runtime-guard',
    content: requirements,
    display: false,
    details: {missingDraft, missingValidation},
  }, {triggerTurn: true});
  await options.session.waitForIdle();
}

async function nativeSessionInfo(
  session: Awaited<ReturnType<typeof createAgentSession>>['session'],
  network: Awaited<ReturnType<typeof ensurePiNetwork>>,
): Promise<NativeSessionInfo> {
  const stats = session.getSessionStats();
  const loader = session.resourceLoader;
  return {
    sessionId: session.sessionId,
    model: session.model?.id ?? 'unconfigured',
    provider: session.model?.provider ?? 'unconfigured',
    thinkingLevel: session.thinkingLevel,
    activeTools: session.getActiveToolNames(),
    skills: loader.getSkills().skills.map((skill) => skill.name),
    promptTemplates: loader.getPrompts().prompts.map((prompt) => prompt.name),
    contextFiles: loader.getAgentsFiles().agentsFiles.map((file) => file.path),
    autoCompaction: session.autoCompactionEnabled,
    network: publicNetworkInfo(network),
    stats: {
      userMessages: stats.userMessages,
      assistantMessages: stats.assistantMessages,
      toolCalls: stats.toolCalls,
      toolResults: stats.toolResults,
      totalMessages: stats.totalMessages,
      tokens: stats.tokens.total,
    },
  };
}

async function runNative(projectId: string, prompt: string, options: NativeRunOptions = {}) {
  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const record = await getProject(projectId);
  const sessionManager = await openProjectSession(projectId);
  const newNativeSession = sessionManager.getEntries().length === 0;
  // The repository owner explicitly opts this embedded runtime into project-local
  // Pi resources (.pi and .agents). This is scoped to πCut and does not change
  // the user's global Pi trust store or global settings.
  const settingsManager = SettingsManager.create(cwd, agentDir, {projectTrusted: true});
  process.env.HYPERFRAMES_NO_TELEMETRY = '1';
  const network = await ensurePiNetwork(settingsManager);
  const resourceLoader = new DefaultResourceLoader({cwd, agentDir, settingsManager, appendSystemPrompt: [PICUT_NATIVE_INSTRUCTIONS]});
  await resourceLoader.reload();
  const events: SerializableAgentEvent[] = [];
  const completedTools: string[] = [];
  const {session, modelFallbackMessage} = await createAgentSession({
    cwd,
    agentDir,
    sessionManager,
    settingsManager,
    resourceLoader,
    customTools: createVideoTools(projectId, prompt, options.editIntent),
  });
  const emitEvent = (event: SerializableAgentEvent) => {
    events.push(event);
    try {
      options.onEvent?.(event);
    } catch {
      // A UI/job trace subscriber must never be able to abort the Pi loop.
    }
  };
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'tool_execution_end' && !event.isError) completedTools.push(event.toolName);
    const serialized = serializeEvent(event);
    if (serialized) emitEvent(serialized);
    const renderedRoute = routingFromToolResult(event);
    if (renderedRoute) buildRenderRouteTrace(renderedRoute, {phase: 'render'}).forEach(emitEvent);
  });
  try {
    if (!session.model) throw new Error(modelFallbackMessage ?? '原生 Pi AgentSession 没有可用模型');
    if (newNativeSession && record.chatMessages.length && !options.creatingProject) {
      await session.sendCustomMessage({customType: 'picut-legacy-history', content: legacyHistoryText(record.chatMessages), display: false});
    }
    await session.sendCustomMessage({
      customType: 'picut-turn-context',
      content: currentTurnSnapshot(projectId, record, options.editIntent ?? {}, Boolean(options.creatingProject)),
      display: false,
      details: {projectId, revision: record.spec.revision, editIntent: options.editIntent},
    });
    const turnMessageStart = session.messages.length;
    await session.prompt(prompt, {source: 'rpc'});
    await session.waitForIdle();
    await runGuardIfNeeded({session, creatingProject: Boolean(options.creatingProject), completedTools});
    const updated = await getProject(projectId);
    if (!completedTools.some((tool) => tool === 'render_preview' || tool === 'render_final')) {
      buildRenderRouteTrace(routeRenderBackend(updated.spec), {phase: 'plan'}).forEach(emitEvent);
    }
    const response = assistantText(session.messages.slice(turnMessageStart));
    const terminalError = session.state.errorMessage;
    if (terminalError) {
      throw new Error(`openai-codex 请求失败：${redact(terminalError)}`);
    }
    const generatedFromScratch = completedTools.includes('draft_storyboard');
    if (options.creatingProject && !generatedFromScratch) throw new Error('原生 Pi AgentSession 未执行 draft_storyboard，本次创建已拒绝');
    const sessionInfo = await nativeSessionInfo(session, network);
    return {
      response: response || '原生 Pi AgentSession 已完成工具循环。',
      events,
      spec: updated.spec,
      validation: validateVideoSpec(updated.spec),
      pendingApproval: updated.pendingChangeSet,
      executionMode: 'native-session' as const,
      model: sessionInfo.model,
      provider: sessionInfo.provider,
      thinkingLevel: sessionInfo.thinkingLevel,
      generatedFromScratch,
      session: sessionInfo,
      modelFallbackMessage,
    };
  } finally {
    unsubscribe();
    session.dispose();
  }
}

export async function runNativePiCutAgent(projectId: string, prompt: string, options: NativeRunOptions = {}) {
  let release!: () => void;
  const previous = sessionQueues.get(projectId) ?? Promise.resolve();
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  sessionQueues.set(projectId, queued);
  await previous;
  try {
    return await runNative(projectId, prompt, options);
  } finally {
    release();
    if (sessionQueues.get(projectId) === queued) sessionQueues.delete(projectId);
  }
}
