import {NextResponse} from 'next/server';
import {getModelApiKey} from '@/lib/server/model-secret';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    agentMode: process.env.PICUT_AGENT_MODE ?? 'auto',
    provider: process.env.PICUT_MODEL_PROVIDER ?? 'local',
    model: process.env.PICUT_MODEL_ID ?? 'picut-deterministic-planner',
    configured: Boolean(getModelApiKey()),
  });
}
