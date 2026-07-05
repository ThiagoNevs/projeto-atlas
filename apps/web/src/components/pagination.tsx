interface PaginationProps {
  page: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, total, totalPages, onPageChange }: PaginationProps) {
  return (
    <nav className="pagination" aria-label="Paginação">
      <div className="pagination-summary">
        <strong>
          Página {page} de {Math.max(totalPages, 1)}
        </strong>
        <span>
          {total} {total === 1 ? 'resultado' : 'resultados'}
        </span>
      </div>
      <div className="pagination-actions">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <span aria-hidden="true">←</span> Anterior
        </button>
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Próxima <span aria-hidden="true">→</span>
        </button>
      </div>
    </nav>
  );
}
