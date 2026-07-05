export function Score({ label, value }: { label: string; value: number | null }) {
  const safeValue = value ?? 0;
  const tone =
    value === null ? 'neutral' : safeValue >= 85 ? 'good' : safeValue >= 65 ? 'medium' : 'low';

  return (
    <div className="score-card">
      <div className="score-heading">
        <span>{label}</span>
        <strong>{value === null ? '—' : Math.round(value)}</strong>
      </div>
      <div className="score-track" aria-hidden="true">
        <span className={`score-fill score-${tone}`} style={{ width: `${safeValue}%` }} />
      </div>
      <small>{value === null ? 'Sem avaliação' : `${value.toFixed(1)} de 100`}</small>
    </div>
  );
}
