import {NextResponse} from 'next/server';
import {z} from 'zod';
import {createAgentJob} from '@/lib/agent/jobs';
import {archiveProject, listProjects, projectExists, replaceProject} from '@/lib/project/store';
import {createPendingVideoSpec} from '@/lib/video-spec/defaults';

export const runtime = 'nodejs';

const inputSchema = z.object({
  brief: z.string().min(6).max(4000),
  projectId: z.string().regex(/^[a-zA-Z0-9-_]+$/).optional(),
  targetDurationMs: z.number().int().min(100).max(180_000).optional(),
});

function projectIdFromBrief(brief: string) {
  const seconds = brief.match(/(\d+(?:\.\d+)?)\s*(?:秒|s)/i)?.[1]?.replace('.', '-') ?? 'video';
  return `picut-${seconds}s-${Date.now().toString(36)}`;
}

function durationFromBrief(brief: string) {
  const seconds = Number(brief.match(/(\d+(?:\.\d+)?)\s*(?:秒|s)/i)?.[1]);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.max(100, Math.min(180_000, Math.round(seconds * 1000)))
    : 30_000;
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
    const targetDurationMs = input.targetDurationMs ?? durationFromBrief(input.brief);
    const record = await replaceProject(projectId, createPendingVideoSpec(projectId, input.brief, targetDurationMs));
    const job = await createAgentJob({
      projectId,
      prompt: input.brief,
      kind: 'create',
      context: {revision: record.spec.revision, selectedSceneId: 'generation-canvas', playheadFrame: 0, inspectorTab: 'scene'},
    });
    return NextResponse.json({
      projectId,
      url: `/?project=${encodeURIComponent(projectId)}`,
      spec: record.spec,
      job,
      eventsUrl: `/api/agent/jobs/${encodeURIComponent(job.id)}/events`,
      agent: {kernel: '@earendil-works/pi-coding-agent/AgentSession', executionMode: 'persistent-background-job', generatedFromScratch: false},
    }, {status: 202, headers: {'Cache-Control': 'no-store'}});
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
