import { ATLAS_PERMISSIONS } from '@atlas/shared';
import { ConflictFindingsPage } from '../../components/conflict-findings-page';
import { PermissionBoundary } from '../../components/permission-boundary';

interface ConflictFindingsRouteProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ConflictFindingsRoute({ searchParams }: ConflictFindingsRouteProps) {
  return (
    <PermissionBoundary permission={ATLAS_PERMISSIONS.analysisRead}>
      <ConflictFindingsPage initialSearchParams={await searchParams} />
    </PermissionBoundary>
  );
}
