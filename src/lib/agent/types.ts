import {z} from 'zod';

export const editIntentContextSchema = z.object({
  revision: z.number().int().nonnegative().optional(),
  selectedSceneId: z.string().min(1).nullable().optional(),
  playheadFrame: z.number().int().nonnegative().optional(),
  inspectorTab: z.enum(['scene', 'style', 'motion']).optional(),
  selectedField: z.string().min(1).nullable().optional(),
});

export type EditIntentContext = z.infer<typeof editIntentContextSchema>;

export interface SerializableAgentEvent {
  type: string;
  toolName?: string;
  summary: string;
  at: string;
  status?: 'info' | 'success' | 'error';
  detail?: string;
}

export interface NativeSessionInfo {
  sessionId: string;
  model: string;
  provider: string;
  thinkingLevel: string;
  activeTools: string[];
  skills: string[];
  promptTemplates: string[];
  contextFiles: string[];
  autoCompaction: boolean;
  network: {
    route: 'proxy' | 'direct';
    source: 'pi-settings' | 'picut-env' | 'process-env' | 'macos-system' | 'direct';
    proxy?: string;
    timeoutMs: number;
  };
  stats: {
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    toolResults: number;
    totalMessages: number;
    tokens: number;
  };
}
