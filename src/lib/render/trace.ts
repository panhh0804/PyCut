import type {RenderRouteDecision} from './router';

export interface RenderRouteTraceEvent {
  type: string;
  toolName?: string;
  summary: string;
  at: string;
  status: 'info' | 'success' | 'error';
  detail?: string;
}

const engineName = (backend: 'remotion' | 'hyperframes') => backend === 'remotion' ? 'Remotion' : 'HyperFrames';

export function buildRenderRouteTrace(
  routing: RenderRouteDecision,
  options: {phase: 'plan' | 'render'; at?: string} = {phase: 'plan'},
): RenderRouteTraceEvent[] {
  const at = options.at ?? new Date().toISOString();
  const executed = routing.executed ?? routing.selected;
  const sceneDetail = routing.scenes
    .slice(0, 8)
    .map((scene) => `${scene.sceneId} → ${engineName(scene.preferred)}：${scene.reason}`)
    .join('\n');
  const decision = options.phase === 'render'
    ? `引擎执行结果：${engineName(executed)}${routing.fallbackApplied ? '（自动回退）' : ''}`
    : `引擎规划结果：推荐 ${engineName(routing.selected)}，置信度 ${Math.round(routing.confidence * 100)}%`;
  return [
    {
      type: 'route_observe',
      toolName: 'route_render_backend',
      summary: `分析 ${routing.scenes.length} 个镜头的媒体、音轨、图层与关键帧`,
      at,
      status: 'info',
      detail: sceneDetail || undefined,
    },
    ...routing.reasons.slice(0, 4).map((reason) => ({
      type: 'route_evidence',
      toolName: 'route_render_backend',
      summary: reason,
      at,
      status: 'info' as const,
    })),
    {
      type: 'route_decision',
      toolName: 'route_render_backend',
      summary: decision,
      detail: `Remotion ${routing.scores.remotion} / HyperFrames ${routing.scores.hyperframes}；首选 ${engineName(routing.selected)}；备用 ${engineName(routing.fallback)}`,
      at,
      status: 'success',
    },
    ...(routing.fallbackApplied ? [{
      type: 'route_fallback',
      toolName: 'render_with_fallback',
      summary: `首选引擎失败，已切换到 ${engineName(executed)} 并完成渲染`,
      detail: routing.fallbackReason,
      at,
      status: 'info' as const,
    }] : []),
  ];
}
