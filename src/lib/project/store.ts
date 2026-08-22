import 'server-only';

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createDefaultVideoSpec} from '@/lib/video-spec/defaults';
import {applyChangeSet} from '@/lib/video-spec/patch';
import {videoSpecSchema, type ChangeSet, type VideoSpec} from '@/lib/video-spec/schema';

export interface ProjectRecord {
  spec: VideoSpec;
  history: VideoSpec[];
  changeSets: ChangeSet[];
  pendingChangeSet: ChangeSet | null;
}

const root = path.join(process.cwd(), '.picut', 'projects');
const queues = new Map<string, Promise<void>>();

const fileFor = (projectId: string) => path.join(root, `${projectId.replaceAll(/[^a-zA-Z0-9-_]/g, '-')}.json`);

async function persist(projectId: string, record: ProjectRecord) {
  await mkdir(root, {recursive: true});
  await writeFile(fileFor(projectId), JSON.stringify(record, null, 2), 'utf8');
}

export async function getProject(projectId = 'transformer-60s'): Promise<ProjectRecord> {
  try {
    const raw = JSON.parse(await readFile(fileFor(projectId), 'utf8')) as ProjectRecord;
    return {...raw, spec: videoSpecSchema.parse(raw.spec), pendingChangeSet: raw.pendingChangeSet ?? null};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const record: ProjectRecord = {spec: createDefaultVideoSpec(projectId), history: [], changeSets: [], pendingChangeSet: null};
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
    const next = applyChangeSet(record.spec, changeSet);
    const updated = {
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
  const restored = {
    spec: {...previous, revision: record.spec.revision + 1, provenance: {...previous.provenance, updatedAt: new Date().toISOString()}},
    history: record.history.slice(0, -1),
    changeSets: record.changeSets,
    pendingChangeSet: record.pendingChangeSet,
  };
  await persist(projectId, restored);
  return restored;
}

export async function resetProject(projectId: string): Promise<ProjectRecord> {
  const record: ProjectRecord = {spec: createDefaultVideoSpec(projectId), history: [], changeSets: [], pendingChangeSet: null};
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
  const next = videoSpecSchema.parse(applyChangeSet(record.spec, approved));
  const updated: ProjectRecord = {
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
