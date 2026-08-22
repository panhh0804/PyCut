import {Studio} from '@/components/studio/Studio';
import {getProject} from '@/lib/project/store';
import {validateVideoSpec} from '@/lib/video-spec/validation';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const record = await getProject('transformer-60s');
  return <Studio initialSpec={record.spec} initialValidation={validateVideoSpec(record.spec)} initialPendingApproval={record.pendingChangeSet} />;
}
