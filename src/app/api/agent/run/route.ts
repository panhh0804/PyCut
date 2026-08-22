import {NextResponse} from 'next/server';
import {z} from 'zod';
import {runPiCutAgent} from '@/lib/agent/runtime';

export const runtime = 'nodejs';

const requestSchema = z.object({
  projectId: z.string().min(1).default('transformer-60s'),
  prompt: z.string().min(1).max(4_000),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    return NextResponse.json(await runPiCutAgent(input.projectId, input.prompt));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : 'Agent 执行失败'}, {status: 400});
  }
}

