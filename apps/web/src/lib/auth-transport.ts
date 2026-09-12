type FetchImplementation = (input: string, init: RequestInit) => Promise<Response>;

let accessToken: string | null = null;
let unauthorizedHandler: (() => Promise<void>) | null = null;
let unauthorizedFlight: Promise<void> | null = null;

export function configureAuthenticatedTransport(
  token: string,
  onUnauthorized: () => Promise<void>,
): void {
  accessToken = token;
  unauthorizedHandler = onUnauthorized;
}

export function clearAuthenticatedTransport(): void {
  accessToken = null;
  unauthorizedHandler = null;
  unauthorizedFlight = null;
}

export async function authenticatedFetch(
  input: string,
  init: RequestInit,
  fetchImplementation: FetchImplementation = fetch,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetchImplementation(input, { ...init, headers });
  if (response.status === 401 && unauthorizedHandler) {
    unauthorizedFlight ??= unauthorizedHandler().finally(() => {
      unauthorizedFlight = null;
    });
    await unauthorizedFlight;
  }
  return response;
}
