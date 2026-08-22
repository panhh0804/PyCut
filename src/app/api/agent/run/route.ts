import {NextResponse} from 'next/server';
import {z} from 'zod';
import {runPiCutAgent} from '@/lib/agent/runtime';
import {editIntentContextSchema} from '@/lib/agent/types';
import {appendProjectAgentRun, appendProjectChat} from '@/lib/project/store';

export const runtime = 'nodejs';

const requestSchema = z.object({
  projectId: z.string().min(1).default('transformer-60s'),
  prompt: z.string().min(1).max(4_000),
  context: editIntentContextSchema.optional(),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const result = await runPiCutAgent(input.projectId, input.prompt, {editIntent: input.context});
    const now = new Date().toISOString();
    await appendProjectChat(input.projectId, [
      {id: crypto.randomUUID(), role: 'human', text: input.prompt, meta: 'You', createdAt: now},
      {id: crypto.randomUUID(), role: 'agent', text: result.response, meta: `${result.provider}/${result.model} · ${result.thinkingLevel} · ${result.executionMode}`, createdAt: new Date().toISOString()},
    ]);
    const traceRun = {
      id: crypto.randomUUID(),
      prompt: input.prompt,
      model: result.model,
      executionMode: result.executionMode,
      sessionId: result.session.sessionId,
      provider: result.provider,
      thinkingLevel: result.thinkingLevel,
      activeTools: result.session.activeTools,
      createdAt: now,
      events: result.events,
    };
    await appendProjectAgentRun(input.projectId, traceRun);
    return NextResponse.json({...result, traceRun});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : 'Agent 执行失败'}, {status: 400});
  }
}
