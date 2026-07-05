import { getStatusMetadata, StatusCode } from '@/lib/status';

export function StatusBadge({
  status,
  showDescription = false,
}: {
  status: StatusCode;
  showDescription?: boolean;
}) {
  const metadata = getStatusMetadata(status);

  return (
    <div className="status-display">
      <span className={`status-badge status-${metadata.tone}`}>{metadata.label}</span>
      {showDescription ? <span className="status-description">{metadata.description}</span> : null}
    </div>
  );
}
