import { ConflictFindingsPage } from '../../components/conflict-findings-page';

interface ConflictFindingsRouteProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ConflictFindingsRoute({
  searchParams,
}: ConflictFindingsRouteProps) {
  return <ConflictFindingsPage initialSearchParams={await searchParams} />;
}
