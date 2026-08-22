import {NextResponse} from 'next/server';
import {z} from 'zod';
import {renderProject} from '@/lib/render/service';
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
      events: [
        {type: 'route_observe', summary: `观察 ${result.routing.scenes.length} 个镜头、音频轨与关键帧`, at: createdAt, status: 'info' as const},
        ...result.routing.reasons.map((reason) => ({type: 'route_evidence', summary: reason, at: createdAt, status: 'info' as const})),
        {type: 'route_decision', toolName: 'route_render_backend', summary: `自主选择 ${result.routing.selected === 'remotion' ? 'Remotion' : 'HyperFrames'}，置信度 ${Math.round(result.routing.confidence * 100)}%`, detail: `Remotion ${result.routing.scores.remotion} / HyperFrames ${result.routing.scores.hyperframes}；备用引擎 ${result.routing.fallback}`, at: createdAt, status: 'success' as const},
        ...(result.routing.fallbackApplied ? [{type: 'route_fallback', toolName: 'render_with_fallback', summary: `首选引擎失败，已自动切换到 ${result.routing.executed === 'remotion' ? 'Remotion' : 'HyperFrames'} 并完成渲染`, detail: result.routing.fallbackReason, at: new Date().toISOString(), status: 'info' as const}] : []),
      ],
    };
    await appendProjectAgentRun(projectId, traceRun);
    return NextResponse.json({...result, traceRun});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : '渲染失败'}, {status: 500});
  }
}
