import 'server-only';

import {mkdir, readdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createDefaultVideoSpec} from '@/lib/video-spec/defaults';
import {applyChangeSet, createChangeSet} from '@/lib/video-spec/patch';
import {repairVideoSpec} from '@/lib/video-spec/repair';
import {videoSpecSchema, type ChangeSet, type VideoSpec} from '@/lib/video-spec/schema';
import {validateVideoSpec} from '@/lib/video-spec/validation';

export interface ProjectRecord {
  spec: VideoSpec;
  history: VideoSpec[];
  changeSets: ChangeSet[];
  pendingChangeSet: ChangeSet | null;
  chatMessages: ProjectChatMessage[];
  agentRuns: ProjectAgentRun[];
}

export interface ProjectAgentEvent {
  type: string;
  toolName?: string;
  summary: string;
  at: string;
  status?: 'info' | 'success' | 'error';
  detail?: string;
}

export interface ProjectAgentRun {
  id: string;
  prompt: string;
  model: string;
  executionMode: string;
  createdAt: string;
  events: ProjectAgentEvent[];
}

export interface ProjectChatMessage {
  id: string;
  role: 'agent' | 'human';
  text: string;
  meta: string;
  createdAt: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  durationMs: number;
  revision: number;
  updatedAt: string;
  hasNarration: boolean;
}

const root = path.join(process.cwd(), '.picut', 'projects');
const archiveRoot = path.join(process.cwd(), '.picut', 'projects-archive');
const queues = new Map<string, Promise<void>>();

const fileFor = (projectId: string) => path.join(root, `${projectId.replaceAll(/[^a-zA-Z0-9-_]/g, '-')}.json`);

async function persist(projectId: string, record: ProjectRecord) {
  await mkdir(root, {recursive: true});
  await writeFile(fileFor(projectId), JSON.stringify(record, null, 2), 'utf8');
}

export async function replaceProject(projectId: string, spec: VideoSpec): Promise<ProjectRecord> {
  const parsed = videoSpecSchema.parse({...spec, project: {...spec.project, id: projectId}});
  const record: ProjectRecord = {spec: parsed, history: [], changeSets: [], pendingChangeSet: null, chatMessages: [], agentRuns: []};
  await persist(projectId, record);
  return record;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await mkdir(root, {recursive: true});
  const entries = await readdir(root, {withFileTypes: true});
  const projects = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map(async (entry) => {
      try {
        const raw = JSON.parse(await readFile(path.join(root, entry.name), 'utf8')) as ProjectRecord;
        const spec = videoSpecSchema.parse(raw.spec);
        return {
          id: spec.project.id,
          title: spec.project.title,
          durationMs: spec.project.targetDurationMs,
          revision: spec.revision,
          updatedAt: spec.provenance.updatedAt,
          hasNarration: Boolean(spec.editSpec.globalAudio.narrationAssetId),
        } satisfies ProjectSummary;
      } catch {
        return null;
      }
    }));
  return projects.filter((project): project is ProjectSummary => project !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function projectExists(projectId: string) {
  try {
    await readFile(fileFor(projectId), 'utf8');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function archiveProject(projectId: string) {
  const record = await getProject(projectId);
  if (record.spec.project.id !== projectId) throw new Error('项目标识与存储记录不匹配');
  await mkdir(archiveRoot, {recursive: true});
  const archivedAt = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const target = path.join(archiveRoot, `${projectId.replaceAll(/[^a-zA-Z0-9-_]/g, '-')}-${archivedAt}.json`);
  await rename(fileFor(projectId), target);
  return {projectId, archivedAt, recoverable: true};
}

export async function appendProjectChat(projectId: string, messages: ProjectChatMessage[]) {
  const record = await getProject(projectId);
  const updated = {...record, chatMessages: [...record.chatMessages, ...messages].slice(-80)};
  await persist(projectId, updated);
  return updated;
}

export async function appendProjectAgentRun(projectId: string, run: ProjectAgentRun) {
  const record = await getProject(projectId);
  const updated = {...record, agentRuns: [...record.agentRuns, run].slice(-40)};
  await persist(projectId, updated);
  return updated;
}

export async function getProject(projectId = 'transformer-60s'): Promise<ProjectRecord> {
  try {
    const raw = JSON.parse(await readFile(fileFor(projectId), 'utf8')) as ProjectRecord;
    return {...raw, spec: videoSpecSchema.parse(raw.spec), pendingChangeSet: raw.pendingChangeSet ?? null, chatMessages: raw.chatMessages ?? [], agentRuns: raw.agentRuns ?? []};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const record: ProjectRecord = {spec: createDefaultVideoSpec(projectId), history: [], changeSets: [], pendingChangeSet: null, chatMessages: [], agentRuns: []};
    await persist(projectId, record);
    return record;
  }
}

export async function updateProject(projectId: string, changeSet: ChangeSet): Promise<ProjectRecord> {
  let resolveQueue!: () => void;
  const previous = queues.get(projectId) ?? Promise.resolve();
  const current = new Promise<void>((resolve) => { resolveQueue = resolve; });
  const queued = previous.then(() => current);
  queues.set(projectId, queued);
  await previous;
  try {
    const record = await getProject(projectId);
    const applied = applyChangeSet(record.spec, changeSet);
    const next = repairVideoSpec(applied).spec;
    const updated = {
      ...record,
      spec: videoSpecSchema.parse(next),
      history: [...record.history, record.spec].slice(-40),
      changeSets: [...record.changeSets, changeSet].slice(-100),
      pendingChangeSet: null,
    };
    await persist(projectId, updated);
    return updated;
  } finally {
    resolveQueue();
    if (queues.get(projectId) === queued) queues.delete(projectId);
  }
}

export async function undoProject(projectId: string): Promise<ProjectRecord> {
  const record = await getProject(projectId);
  const previous = record.history.at(-1);
  if (!previous) return record;
  const repaired = repairVideoSpec(previous).spec;
  const restored = {
    ...record,
    spec: {...repaired, revision: record.spec.revision + 1, provenance: {...repaired.provenance, updatedAt: new Date().toISOString()}},
    history: record.history.slice(0, -1),
    changeSets: record.changeSets,
  };
  await persist(projectId, restored);
  return restored;
}

export async function resetProject(projectId: string): Promise<ProjectRecord> {
  const record: ProjectRecord = {spec: createDefaultVideoSpec(projectId), history: [], changeSets: [], pendingChangeSet: null, chatMessages: [], agentRuns: []};
  await persist(projectId, record);
  return record;
}

export async function stagePendingChangeSet(projectId: string, changeSet: ChangeSet): Promise<ProjectRecord> {
  const record = await getProject(projectId);
  if (changeSet.baseRevision !== record.spec.revision) {
    throw new Error(`版本冲突：当前 r${record.spec.revision}，提案基于 r${changeSet.baseRevision}`);
  }
  const staged = {...record, pendingChangeSet: changeSet};
  await persist(projectId, staged);
  return staged;
}

export async function approvePendingChangeSet(projectId: string): Promise<ProjectRecord> {
  const record = await getProject(projectId);
  if (!record.pendingChangeSet) return record;
  const approved: ChangeSet = {...record.pendingChangeSet, baseRevision: record.spec.revision, approval: 'approved'};
  const next = videoSpecSchema.parse(repairVideoSpec(applyChangeSet(record.spec, approved)).spec);
  const updated: ProjectRecord = {
    ...record,
    spec: next,
    history: [...record.history, record.spec].slice(-40),
    changeSets: [...record.changeSets, approved].slice(-100),
    pendingChangeSet: null,
  };
  await persist(projectId, updated);
  return updated;
}

export async function rejectPendingChangeSet(projectId: string): Promise<ProjectRecord> {
  const record = await getProject(projectId);
  if (!record.pendingChangeSet) return record;
  const rejected: ChangeSet = {...record.pendingChangeSet, approval: 'rejected'};
  const updated = {
    ...record,
    changeSets: [...record.changeSets, rejected].slice(-100),
    pendingChangeSet: null,
  };
  await persist(projectId, updated);
  return updated;
}

export async function autoRepairProject(projectId: string, maxAttempts = 3) {
  let record = await getProject(projectId);
  const repairs: string[] = [];
  let attempts = 0;
  while (attempts < maxAttempts) {
    const validation = validateVideoSpec(record.spec);
    if (validation.valid) return {record, validation, repairs, attempts};
    const plan = repairVideoSpec(record.spec);
    if (!plan.patch.length) return {record, validation, repairs, attempts};
    attempts += 1;
    const changeSet = createChangeSet({
      baseRevision: record.spec.revision,
      actor: 'agent',
      intent: `自动修复质量门（第 ${attempts} 轮）：${plan.actions.join('；')}`,
      risk: 'low',
      approval: 'not-required',
      patch: plan.patch,
    });
    record = await updateProject(projectId, changeSet);
    repairs.push(...plan.actions);
  }
  return {record, validation: validateVideoSpec(record.spec), repairs, attempts};
}
