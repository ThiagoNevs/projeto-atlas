import { FindingReviewCasesPage } from '../../components/finding-review-cases-page';

interface Props { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function FindingReviewCasesRoute({ searchParams }: Props) {
  return <FindingReviewCasesPage initialSearchParams={await searchParams} />;
}
