export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const API_CONNECTION_ERROR_MESSAGE =
  'Não foi possível conectar ao servidor. Verifique se a API está disponível e tente novamente.';

export function normalizeApiError(error: unknown): Error {
  if (error instanceof ApiError) return error;

  const message = error instanceof Error ? error.message : '';
  const isConnectionError =
    error instanceof TypeError ||
    /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(message);

  if (isConnectionError) return new ApiError(API_CONNECTION_ERROR_MESSAGE, 0);
  return error instanceof Error ? error : new Error('Não foi possível concluir a solicitação.');
}
