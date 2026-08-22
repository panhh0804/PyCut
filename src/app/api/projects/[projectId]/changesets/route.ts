import {NextResponse} from 'next/server';
import {z} from 'zod';
import {appendProjectChat, updateProject} from '@/lib/project/store';
import {createChangeSet} from '@/lib/video-spec/patch';
import {patchOperationSchema} from '@/lib/video-spec/schema';
import {validateVideoSpec} from '@/lib/video-spec/validation';

export const runtime = 'nodejs';

const inputSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  intent: z.string().min(1),
  risk: z.enum(['low', 'medium', 'high']).default('low'),
  patch: z.array(patchOperationSchema).min(1),
});

export async function POST(request: Request, context: {params: Promise<{projectId: string}>}) {
  try {
    const {projectId} = await context.params;
    const input = inputSchema.parse(await request.json());
    const changeSet = createChangeSet({...input, actor: 'human', approval: 'not-required'});
    const record = await updateProject(projectId, changeSet);
    const now = new Date().toISOString();
    const withChat = await appendProjectChat(projectId, [
      {id: crypto.randomUUID(), role: 'human', text: input.intent, meta: 'Timeline edit', createdAt: now},
      {id: crypto.randomUUID(), role: 'agent', text: `已同步手动编辑：${input.intent}。ChangeSet 已提交到 r${record.spec.revision}。`, meta: 'UI → VideoSpec → Agent', createdAt: now},
    ]);
    return NextResponse.json({...withChat, changeSet, validation: validateVideoSpec(withChat.spec)});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : 'ChangeSet 应用失败'}, {status: 409});
  }
}
