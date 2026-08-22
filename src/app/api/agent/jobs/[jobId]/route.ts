import {NextResponse} from 'next/server';
import {z} from 'zod';
import {agentJobSnapshot, retryAgentJob} from '@/lib/agent/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const jobIdSchema = z.string().regex(/^[a-zA-Z0-9-_]+$/);

function publicError(error: unknown) {
  return (error instanceof Error ? error.message : 'Agent Job 请求失败')
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/authorization\s*[:=]\s*[^\s,}\]]+/gi, 'authorization=[REDACTED]')
    .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');
}

export async function GET(_request: Request, context: {params: Promise<{jobId: string}>}) {
  try {
    const jobId = jobIdSchema.parse((await context.params).jobId);
    return NextResponse.json(await agentJobSnapshot(jobId), {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    return NextResponse.json({error: publicError(error)}, {status: 404, headers: {'Cache-Control': 'no-store'}});
  }
}

export async function POST(_request: Request, context: {params: Promise<{jobId: string}>}) {
  try {
    const jobId = jobIdSchema.parse((await context.params).jobId);
    const job = await retryAgentJob(jobId);
    return NextResponse.json({job}, {status: 202, headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    return NextResponse.json({error: publicError(error)}, {status: 409, headers: {'Cache-Control': 'no-store'}});
  }
}
