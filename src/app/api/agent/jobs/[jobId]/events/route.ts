import {z} from 'zod';
import {agentJobSnapshot} from '@/lib/agent/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const jobIdSchema = z.string().regex(/^[a-zA-Z0-9-_]+$/);

export async function GET(request: Request, context: {params: Promise<{jobId: string}>}) {
  const jobId = jobIdSchema.parse((await context.params).jobId);
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let sending = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try { controller.close(); } catch { /* connection already closed */ }
      };
      const send = async () => {
        if (closed || sending) return;
        sending = true;
        try {
          const snapshot = await agentJobSnapshot(jobId);
          controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
          if (snapshot.job.status === 'succeeded' || snapshot.job.status === 'failed') close();
        } catch (error) {
          const message = error instanceof Error ? error.message : '读取 Agent Job 失败';
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({error: message})}\n\n`));
          close();
        } finally {
          sending = false;
        }
      };
      request.signal.addEventListener('abort', close, {once: true});
      controller.enqueue(encoder.encode(': πCut native AgentSession event stream\n\n'));
      void send();
      timer = setInterval(() => { void send(); }, 650);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
