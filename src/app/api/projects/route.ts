import {NextResponse} from 'next/server';
import {z} from 'zod';
import {runPiCutAgent} from '@/lib/agent/runtime';
import {appendProjectAgentRun, appendProjectChat, archiveProject, listProjects, projectExists} from '@/lib/project/store';

export const runtime = 'nodejs';

const inputSchema = z.object({
  brief: z.string().min(6).max(4000),
  projectId: z.string().regex(/^[a-zA-Z0-9-_]+$/).optional(),
});

function projectIdFromBrief(brief: string) {
  const seconds = brief.match(/(\d+(?:\.\d+)?)\s*(?:秒|s)/i)?.[1]?.replace('.', '-') ?? 'video';
  return `picut-${seconds}s-${Date.now().toString(36)}`;
}

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : 'π Agent 创建项目失败';
  return message
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/authorization\s*[:=]\s*[^\s,}]+/gi, 'authorization=[REDACTED]');
}

export async function GET() {
  return NextResponse.json({projects: await listProjects()});
}

export async function POST(request: Request) {
  let projectId: string | null = null;
  try {
    const input = inputSchema.parse(await request.json());
    const baseProjectId = input.projectId ?? projectIdFromBrief(input.brief);
    projectId = baseProjectId;
    let suffix = 2;
    while (await projectExists(projectId)) projectId = `${baseProjectId}-${suffix++}`;
    const result = await runPiCutAgent(projectId, input.brief, {requireRemote: true, creatingProject: true});
    if (!result.generatedFromScratch) throw new Error('π Agent 没有生成新的 VideoSpec，已拒绝载入任何预设视频');
    const now = new Date().toISOString();
    await appendProjectChat(projectId, [
      {id: crypto.randomUUID(), role: 'human', text: input.brief, meta: 'You · creation brief', createdAt: now},
      {id: crypto.randomUUID(), role: 'agent', text: result.response, meta: `${result.model} · π Agent native`, createdAt: new Date().toISOString()},
    ]);
    const traceRun = {
      id: crypto.randomUUID(),
      prompt: input.brief,
      model: result.model,
      executionMode: result.executionMode,
      createdAt: now,
      events: result.events,
    };
    await appendProjectAgentRun(projectId, traceRun);
    return NextResponse.json({
      projectId,
      url: `/?project=${encodeURIComponent(projectId)}`,
      spec: result.spec,
      validation: result.validation,
      agent: {kernel: '@earendil-works/pi-agent-core', model: result.model, executionMode: result.executionMode, generatedFromScratch: true},
      events: result.events,
      traceRun,
    }, {status: 201, headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    if (projectId && await projectExists(projectId)) {
      try {
        await archiveProject(projectId);
      } catch {
        // Failed creation must never be returned as a usable cached session.
      }
    }
    const status = error instanceof z.ZodError ? 400 : 502;
    return NextResponse.json({error: publicError(error), generatedFromScratch: false}, {status, headers: {'Cache-Control': 'no-store'}});
  }
}
