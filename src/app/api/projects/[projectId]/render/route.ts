import {NextResponse} from 'next/server';
import {z} from 'zod';
import {renderProject} from '@/lib/render/service';

export const runtime = 'nodejs';
export const maxDuration = 800;

const inputSchema = z.object({
  backend: z.enum(['remotion', 'hyperframes']),
  mode: z.enum(['preview', 'final']).default('final'),
});

export async function POST(request: Request, context: {params: Promise<{projectId: string}>}) {
  try {
    const {projectId} = await context.params;
    const input = inputSchema.parse(await request.json());
    return NextResponse.json(await renderProject(projectId, input.backend, input.mode));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : '渲染失败'}, {status: 500});
  }
}
