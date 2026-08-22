import {NextResponse} from 'next/server';
import {getAgentDir, SettingsManager} from '@earendil-works/pi-coding-agent';
import {getModelApiKey} from '@/lib/server/model-secret';

export const runtime = 'nodejs';

export async function GET() {
  const settings = SettingsManager.create(process.cwd(), getAgentDir());
  return NextResponse.json({
    agentMode: 'native-session',
    runtime: '@earendil-works/pi-coding-agent@0.84.2/AgentSession',
    provider: settings.getDefaultProvider() ?? 'openai-codex',
    model: settings.getDefaultModel() ?? 'gpt-5.5',
    thinkingLevel: settings.getDefaultThinkingLevel() ?? 'medium',
    fullPiResources: true,
    ttsConfigured: Boolean(getModelApiKey()),
  });
}
