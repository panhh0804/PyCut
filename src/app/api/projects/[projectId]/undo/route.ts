import {NextResponse} from 'next/server';
import {appendProjectChat, undoProject} from '@/lib/project/store';
import {validateVideoSpec} from '@/lib/video-spec/validation';

export const runtime = 'nodejs';

export async function POST(_request: Request, context: {params: Promise<{projectId: string}>}) {
  const {projectId} = await context.params;
  const record = await undoProject(projectId);
  const withChat = await appendProjectChat(projectId, [{id: crypto.randomUUID(), role: 'agent', text: `已撤销上一项变更，并生成可追踪的新版本 r${record.spec.revision}。`, meta: 'Undo · revisioned', createdAt: new Date().toISOString()}]);
  return NextResponse.json({...withChat, validation: validateVideoSpec(withChat.spec)});
}
