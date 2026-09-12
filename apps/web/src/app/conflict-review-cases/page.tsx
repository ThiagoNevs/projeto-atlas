import { ATLAS_PERMISSIONS } from '@atlas/shared';
import { FindingReviewCasesPage } from '../../components/finding-review-cases-page';
import { PermissionBoundary } from '../../components/permission-boundary';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function FindingReviewCasesRoute({ searchParams }: Props) {
  return (
    <PermissionBoundary permission={ATLAS_PERMISSIONS.reviewCaseRead}>
      <FindingReviewCasesPage initialSearchParams={await searchParams} />
    </PermissionBoundary>
  );
}
