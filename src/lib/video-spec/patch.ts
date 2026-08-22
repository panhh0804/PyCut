import {changeSetSchema, type ChangeSet, type PatchOperation, type VideoSpec} from './schema';

export class RevisionConflictError extends Error {}
export class LockedFieldError extends Error {}

const decodePointer = (token: string) => token.replaceAll('~1', '/').replaceAll('~0', '~');

function assertUnlocked(spec: VideoSpec, path: string, actor: ChangeSet['actor']) {
  const match = path.match(/^\/editSpec\/scenes\/(\d+)(?:\/(.*))?$/);
  if (!match) return;
  const scene = spec.editSpec.scenes[Number(match[1])];
  if (!scene) return;
  const relative = match[2] ?? '';
  if (scene.locks.locked && actor !== 'human') {
    throw new LockedFieldError(`场景 ${scene.id} 已由用户锁定`);
  }
  if (actor !== 'human' && scene.locks.fields.some((field) => relative === field || relative.startsWith(`${field}/`))) {
    throw new LockedFieldError(`字段 ${scene.id}.${relative} 已锁定`);
  }
}

function applyOperation(root: unknown, operation: PatchOperation) {
  const tokens = operation.path.split('/').slice(1).map(decodePointer);
  if (tokens.length === 0) throw new Error('不允许替换根节点');
  let cursor = root as Record<string, unknown> | unknown[];
  for (const token of tokens.slice(0, -1)) {
    const next = Array.isArray(cursor) ? cursor[Number(token)] : cursor[token];
    if (!next || typeof next !== 'object') throw new Error(`Patch 路径不存在：${operation.path}`);
    cursor = next as Record<string, unknown> | unknown[];
  }
  const key = tokens.at(-1)!;
  if (operation.op === 'remove') {
    if (Array.isArray(cursor)) cursor.splice(Number(key), 1);
    else delete cursor[key];
    return;
  }
  if (operation.value === undefined) throw new Error(`${operation.op} 操作缺少 value`);
  if (Array.isArray(cursor)) {
    if (operation.op === 'add' && key === '-') cursor.push(operation.value);
    else cursor[Number(key)] = operation.value;
  } else {
    cursor[key] = operation.value;
  }
}

export function applyChangeSet(spec: VideoSpec, rawChangeSet: ChangeSet): VideoSpec {
  const changeSet = changeSetSchema.parse(rawChangeSet);
  if (changeSet.baseRevision !== spec.revision) {
    throw new RevisionConflictError(`版本冲突：当前 r${spec.revision}，请求基于 r${changeSet.baseRevision}`);
  }
  if (changeSet.approval === 'pending' || changeSet.approval === 'rejected') {
    throw new Error('ChangeSet 尚未获批');
  }
  const next = structuredClone(spec);
  for (const operation of changeSet.patch) {
    assertUnlocked(spec, operation.path, changeSet.actor);
    applyOperation(next, operation);
  }
  next.revision += 1;
  next.provenance.updatedAt = new Date().toISOString();
  return next;
}

export function createChangeSet(input: Omit<ChangeSet, 'changeSetId' | 'createdAt'>): ChangeSet {
  return {
    ...input,
    changeSetId: `cs-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
}

