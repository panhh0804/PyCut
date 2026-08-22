import {NextResponse} from 'next/server';
import {z} from 'zod';
import {synthesizeProjectNarration} from '@/lib/audio/service';

export const runtime = 'nodejs';
export const maxDuration = 300;

const inputSchema = z.object({
  model: z.string().min(1).optional(),
  voice: z.string().min(1).optional(),
  speed: z.number().min(0.25).max(4).optional(),
  gainDb: z.number().min(-10).max(10).optional(),
});

export async function POST(request: Request, context: {params: Promise<{projectId: string}>}) {
  try {
    const {projectId} = await context.params;
    const input = inputSchema.parse(await request.json());
    return NextResponse.json(await synthesizeProjectNarration(projectId, input));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : '旁白合成失败'}, {status: 400});
  }
}
