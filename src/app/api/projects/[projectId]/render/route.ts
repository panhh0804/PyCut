import {NextResponse} from 'next/server';
import {z} from 'zod';
import {renderProject} from '@/lib/render/service';
import {buildRenderRouteTrace} from '@/lib/render/trace';
import {appendProjectAgentRun, type ProjectAgentRun} from '@/lib/project/store';

export const runtime = 'nodejs';
export const maxDuration = 800;

const inputSchema = z.object({
  backend: z.enum(['remotion', 'hyperframes', 'auto']),
  mode: z.enum(['preview', 'final']).default('final'),
});

export async function POST(request: Request, context: {params: Promise<{projectId: string}>}) {
  try {
    const {projectId} = await context.params;
    const input = inputSchema.parse(await request.json());
    const result = await renderProject(projectId, input.backend, input.mode);
    if (!result.routing) return NextResponse.json(result);
    const createdAt = new Date().toISOString();
    const traceRun: ProjectAgentRun = {
      id: crypto.randomUUID(),
      prompt: `${input.mode === 'final' ? '正式导出' : '预览渲染'} · 自主选择视频引擎`,
      model: 'picut-render-router-v1',
      executionMode: 'deterministic-router',
      createdAt,
      events: buildRenderRouteTrace(result.routing, {phase: 'render', at: createdAt}),
    };
    await appendProjectAgentRun(projectId, traceRun);
    return NextResponse.json({...result, traceRun});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : '渲染失败'}, {status: 500});
  }
}
