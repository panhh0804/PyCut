import {NextResponse} from 'next/server';
import {z} from 'zod';
import {enrichProjectWithCommonsMedia} from '@/lib/research/wikimedia';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(_request: Request, context: {params: Promise<{projectId: string}>}) {
  try {
    const projectId = z.string().regex(/^[a-zA-Z0-9-_]+$/).parse((await context.params).projectId);
    return NextResponse.json(await enrichProjectWithCommonsMedia(projectId));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : '联网素材丰富失败'}, {status: 400});
  }
}
