import {NextResponse} from 'next/server';
import {undoProject} from '@/lib/project/store';
import {validateVideoSpec} from '@/lib/video-spec/validation';

export const runtime = 'nodejs';

export async function POST(_request: Request, context: {params: Promise<{projectId: string}>}) {
  const {projectId} = await context.params;
  const record = await undoProject(projectId);
  return NextResponse.json({...record, validation: validateVideoSpec(record.spec)});
}
