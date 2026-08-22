import 'server-only';

import {mkdir, readdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {runPiCutAgent} from './runtime';
import type {EditIntentContext, SerializableAgentEvent} from './types';
import {appendProjectAgentRun, appendProjectChat, getProject, projectExists, type ProjectAgentRun} from '@/lib/project/store';
import {validateVideoSpec} from '@/lib/video-spec/validation';

export type AgentJobKind = 'edit' | 'create';
export type AgentJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface AgentJob {
  id: string;
  projectId: string;
  kind: AgentJobKind;
  prompt: string;
  context: EditIntentContext;
  status: AgentJobStatus;
  attempts: number;
  events: SerializableAgentEvent[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: {
    response: string;
    provider: string;
    model: string;
    thinkingLevel: string;
    executionMode: string;
    sessionId: string;
    generatedFromScratch: boolean;
    traceRunId: string;
  };
}

const jobsRoot = path.join(process.cwd(), '.picut', 'jobs');
const jobCache = new Map<string, AgentJob>();
const jobQueues = new Map<string, Promise<void>>();
const workers = new Map<string, Promise<void>>();

function safeId(value: string) {
  return value.replaceAll(/[^a-zA-Z0-9-_]/g, '-');
}

function fileFor(jobId: string) {
  return path.join(jobsRoot, `${safeId(jobId)}.json`);
}

function redact(value: string) {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/authorization\s*[:=]\s*[^\s,}\]]+/gi, 'authorization=[REDACTED]')
    .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');
}

async function persist(job: AgentJob) {
  await mkdir(jobsRoot, {recursive: true});
  const target = fileFor(job.id);
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(job, null, 2), 'utf8');
  await rename(temporary, target);
  jobCache.set(job.id, job);
}

async function withJobQueue<T>(jobId: string, operation: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = jobQueues.get(jobId) ?? Promise.resolve();
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  jobQueues.set(jobId, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (jobQueues.get(jobId) === queued) jobQueues.delete(jobId);
  }
}

async function updateJob(jobId: string, updater: (job: AgentJob) => AgentJob) {
  return withJobQueue(jobId, async () => {
    const current = await getAgentJob(jobId);
    const updated = updater(current);
    await persist(updated);
    return updated;
  });
}

function jobEvent(type: string, summary: string, status: SerializableAgentEvent['status'] = 'info', detail?: string): SerializableAgentEvent {
  return {type, summary, status, detail, at: new Date().toISOString()};
}

async function appendEvent(jobId: string, event: SerializableAgentEvent) {
  await updateJob(jobId, (job) => ({...job, updatedAt: event.at, events: [...job.events, event].slice(-240)}));
}

async function waitForEventWrites(jobId: string) {
  while (jobQueues.has(jobId)) await jobQueues.get(jobId);
}

export async function getAgentJob(jobId: string): Promise<AgentJob> {
  const cached = jobCache.get(jobId);
  if (cached) return cached;
  const parsed = JSON.parse(await readFile(fileFor(jobId), 'utf8')) as AgentJob;
  jobCache.set(jobId, parsed);
  return parsed;
}

export async function listAgentJobs(projectId?: string) {
  await mkdir(jobsRoot, {recursive: true});
  const files = await readdir(jobsRoot, {withFileTypes: true});
  const jobs = await Promise.all(files.filter((file) => file.isFile() && file.name.endsWith('.json')).map(async (file) => {
    try {
      return await getAgentJob(file.name.slice(0, -5));
    } catch {
      return null;
    }
  }));
  return jobs.filter((job): job is AgentJob => job !== null)
    .filter((job) => !projectId || job.projectId === projectId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function executeJob(jobId: string) {
  const running = await updateJob(jobId, (job) => {
    const now = new Date().toISOString();
    return {
      ...job,
      status: 'running',
      attempts: job.attempts + 1,
      startedAt: job.startedAt ?? now,
      updatedAt: now,
      error: undefined,
      events: [...job.events, jobEvent(job.attempts ? 'job_resumed' : 'job_started', job.attempts ? '后台任务从原生 transcript 恢复' : '后台 Agent Job 开始执行')].slice(-240),
    };
  });

  const effectivePrompt = running.attempts > 1
    ? `Resume the interrupted background task below. Inspect the persisted native Pi transcript and current VideoSpec first. Do not repeat already completed mutations. Finish the exact objective and validate the result.\n\nOriginal objective:\n${running.prompt}`
    : running.prompt;
  const draftAlreadyCompleted = running.events.some((event) =>
    event.type === 'tool_execution_end'
    && event.toolName === 'draft_storyboard'
    && event.status === 'success');

  try {
    const result = await runPiCutAgent(running.projectId, effectivePrompt, {
      // A recovered create job may already have committed its draft before the
      // process stopped. Resume from the persisted transcript/spec instead of
      // forcing a second destructive storyboard draft.
      creatingProject: running.kind === 'create' && !draftAlreadyCompleted,
      editIntent: running.context,
      onEvent: (event) => { void appendEvent(jobId, event); },
    });
    await waitForEventWrites(jobId);
    const completedAt = new Date().toISOString();
    const traceRunId = `run-${jobId}`;
    const finalJob = await updateJob(jobId, (job) => ({
      ...job,
      status: 'succeeded',
      updatedAt: completedAt,
      completedAt,
      error: undefined,
      events: [...job.events, jobEvent('job_succeeded', '后台 Agent Job 已完成', 'success')].slice(-240),
      result: {
        response: result.response,
        provider: result.provider,
        model: result.model,
        thinkingLevel: result.thinkingLevel,
        executionMode: result.executionMode,
        sessionId: result.session.sessionId,
        generatedFromScratch: running.kind === 'create'
          ? result.generatedFromScratch || draftAlreadyCompleted
          : result.generatedFromScratch,
        traceRunId,
      },
    }));
    await appendProjectChat(running.projectId, [{
      id: `agent-${jobId}`, role: 'agent', text: result.response,
      meta: `${result.provider}/${result.model} · ${result.thinkingLevel} · ${result.executionMode}`,
      createdAt: completedAt,
    }]);
    const traceRun: ProjectAgentRun = {
      id: traceRunId,
      prompt: running.prompt,
      model: result.model,
      executionMode: result.executionMode,
      sessionId: result.session.sessionId,
      provider: result.provider,
      thinkingLevel: result.thinkingLevel,
      activeTools: result.session.activeTools,
      createdAt: running.createdAt,
      events: finalJob.events,
    };
    await appendProjectAgentRun(running.projectId, traceRun);
  } catch (error) {
    await waitForEventWrites(jobId);
    const completedAt = new Date().toISOString();
    const message = redact(error instanceof Error ? error.message : 'Agent 后台任务失败');
    const failed = await updateJob(jobId, (job) => ({
      ...job, status: 'failed', error: message, updatedAt: completedAt, completedAt,
      events: [...job.events, jobEvent('job_failed', '后台 Agent Job 执行失败', 'error', message)].slice(-240),
    }));
    await appendProjectChat(running.projectId, [{id: `agent-${jobId}`, role: 'agent', text: `任务未完成：${message}`, meta: 'π AgentSession · failed', createdAt: completedAt}]);
    await appendProjectAgentRun(running.projectId, {
      id: `run-${jobId}`, prompt: running.prompt, model: 'gpt-5.5', executionMode: 'native-session-failed', provider: 'openai-codex', thinkingLevel: 'medium', createdAt: running.createdAt, events: failed.events,
    });
  }
}

export function ensureAgentJobStarted(jobId: string) {
  const existing = workers.get(jobId);
  if (existing) return existing;
  const worker = getAgentJob(jobId).then((job) => {
    if (job.status === 'succeeded' || job.status === 'failed') return;
    return executeJob(jobId);
  }).finally(() => workers.delete(jobId));
  workers.set(jobId, worker);
  return worker;
}

export async function createAgentJob(input: {projectId: string; prompt: string; kind?: AgentJobKind; context?: EditIntentContext}) {
  if (!await projectExists(input.projectId)) throw new Error('项目不存在，无法创建 Agent Job');
  const active = (await listAgentJobs(input.projectId)).find((job) => job.status === 'queued' || job.status === 'running');
  if (active) throw new Error(`当前会话已有运行中的 Agent Job：${active.id}`);
  const now = new Date().toISOString();
  const job: AgentJob = {
    id: `agent-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    projectId: input.projectId,
    kind: input.kind ?? 'edit',
    prompt: input.prompt,
    context: input.context ?? {},
    status: 'queued',
    attempts: 0,
    events: [jobEvent('job_queued', '已创建可持久化后台 Agent Job')],
    createdAt: now,
    updatedAt: now,
  };
  await persist(job);
  await appendProjectChat(input.projectId, [{id: `human-${job.id}`, role: 'human', text: input.prompt, meta: input.kind === 'create' ? 'You · creation brief' : 'You', createdAt: now}]);
  void ensureAgentJobStarted(job.id);
  return job;
}

export async function retryAgentJob(jobId: string) {
  const job = await updateJob(jobId, (current) => {
    if (current.status !== 'failed') throw new Error('只有失败的 Job 可以重试');
    const now = new Date().toISOString();
    return {...current, status: 'queued', error: undefined, completedAt: undefined, updatedAt: now, events: [...current.events, jobEvent('job_requeued', '用原生 transcript 重试任务')].slice(-240)};
  });
  void ensureAgentJobStarted(job.id);
  return job;
}

export async function agentJobSnapshot(jobId: string) {
  const job = await getAgentJob(jobId);
  if (job.status === 'queued' || job.status === 'running') void ensureAgentJobStarted(job.id);
  const project = await getProject(job.projectId);
  return {
    job,
    spec: project.spec,
    validation: validateVideoSpec(project.spec),
    pendingApproval: project.pendingChangeSet,
    traceRun: project.agentRuns.find((run) => run.id === `run-${job.id}`) ?? null,
  };
}
