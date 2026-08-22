import {Studio} from '@/components/studio/Studio';
import {autoRepairProject, listProjects} from '@/lib/project/store';
import {validateVideoSpec} from '@/lib/video-spec/validation';

export const dynamic = 'force-dynamic';

export default async function HomePage({searchParams}: {searchParams: Promise<{project?: string}>}) {
  const requested = (await searchParams).project ?? 'transformer-60s';
  const projectId = /^[a-zA-Z0-9-_]+$/.test(requested) ? requested : 'transformer-60s';
  const {record} = await autoRepairProject(projectId);
  const projects = await listProjects();
  return <Studio key={projectId} projectId={projectId} sessions={projects} initialMessages={record.chatMessages} initialAgentRuns={record.agentRuns} initialSpec={record.spec} initialValidation={validateVideoSpec(record.spec)} initialPendingApproval={record.pendingChangeSet} />;
}
