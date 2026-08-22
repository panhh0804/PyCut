import {NextResponse} from 'next/server';
import {z} from 'zod';
import {createAgentJob, listAgentJobs} from '@/lib/agent/jobs';
import {editIntentContextSchema} from '@/lib/agent/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  projectId: z.string().regex(/^[a-zA-Z0-9-_]+$/),
  prompt: z.string().trim().min(1).max(4_000),
  kind: z.enum(['edit', 'create']).default('edit'),
  context: editIntentContextSchema.optional(),
});

function publicError(error: unknown) {
  return (error instanceof Error ? error.message : '无法创建 Agent Job')
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/authorization\s*[:=]\s*[^\s,}\]]+/gi, 'authorization=[REDACTED]')
    .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? undefined;
  if (projectId && !/^[a-zA-Z0-9-_]+$/.test(projectId)) {
    return NextResponse.json({error: '项目标识无效'}, {status: 400});
  }
  const jobs = await listAgentJobs(projectId);
  return NextResponse.json({jobs}, {headers: {'Cache-Control': 'no-store'}});
}

export async function POST(request: Request) {
  try {
    const input = createSchema.parse(await request.json());
    const job = await createAgentJob(input);
    return NextResponse.json({job, eventsUrl: `/api/agent/jobs/${encodeURIComponent(job.id)}/events`}, {
      status: 202,
      headers: {'Cache-Control': 'no-store'},
    });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 409;
    return NextResponse.json({error: publicError(error)}, {status, headers: {'Cache-Control': 'no-store'}});
  }
}
