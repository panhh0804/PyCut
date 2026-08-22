import {NextResponse} from 'next/server';
import {getProject} from '@/lib/project/store';
import {validateVideoSpec} from '@/lib/video-spec/validation';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: {params: Promise<{projectId: string}>}) {
  const {projectId} = await context.params;
  const record = await getProject(projectId);
  return NextResponse.json({...record, validation: validateVideoSpec(record.spec)});
}
