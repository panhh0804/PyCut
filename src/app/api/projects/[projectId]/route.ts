import {NextResponse} from 'next/server';
import {z} from 'zod';
import {archiveProject, autoRepairProject, getProject, listProjects, updateProject} from '@/lib/project/store';
import {createChangeSet} from '@/lib/video-spec/patch';
import {validateVideoSpec} from '@/lib/video-spec/validation';

export const runtime = 'nodejs';

const projectIdSchema = z.string().regex(/^[a-zA-Z0-9-_]+$/);
const updateSchema = z.object({title: z.string().trim().min(1).max(80)});

export async function GET(_request: Request, context: {params: Promise<{projectId: string}>}) {
  const projectId = projectIdSchema.parse((await context.params).projectId);
  const repaired = await autoRepairProject(projectId);
  return NextResponse.json({...repaired.record, validation: repaired.validation, autoRepair: {attempts: repaired.attempts, actions: repaired.repairs}});
}

export async function PATCH(request: Request, context: {params: Promise<{projectId: string}>}) {
  try {
    const projectId = projectIdSchema.parse((await context.params).projectId);
    const input = updateSchema.parse(await request.json());
    const record = await getProject(projectId);
    const updated = await updateProject(projectId, createChangeSet({
      baseRevision: record.spec.revision,
      actor: 'human',
      intent: `重命名项目为「${input.title}」`,
      risk: 'low',
      approval: 'not-required',
      patch: [{op: 'replace', path: '/project/title', value: input.title}],
    }));
    return NextResponse.json({spec: updated.spec, validation: validateVideoSpec(updated.spec), projects: await listProjects()});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : '重命名失败'}, {status: 400});
  }
}

export async function DELETE(_request: Request, context: {params: Promise<{projectId: string}>}) {
  try {
    const projectId = projectIdSchema.parse((await context.params).projectId);
    const result = await archiveProject(projectId);
    return NextResponse.json({...result, projects: await listProjects()});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : '归档项目失败'}, {status: 400});
  }
}
