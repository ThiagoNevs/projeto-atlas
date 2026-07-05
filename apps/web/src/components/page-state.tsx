export function LoadingState({ label = 'Carregando dados…' }: { label?: string }) {
  return (
    <div className="state-card" role="status">
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="state-card state-error" role="alert">
      <span className="state-icon" aria-hidden="true">
        !
      </span>
      <div>
        <strong>Não foi possível carregar</strong>
        <p>{message}</p>
      </div>
      <button className="button button-secondary" type="button" onClick={retry}>
        Tentar novamente
      </button>
    </div>
  );
}
