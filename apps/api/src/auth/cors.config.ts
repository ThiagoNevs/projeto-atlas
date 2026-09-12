import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1']);

export function readWebOrigin(value = process.env.WEB_ORIGIN): string {
  if (!value || value !== value.trim() || value === '*' || value === 'null') {
    throw new Error('WEB_ORIGIN deve conter uma origem HTTP ou HTTPS explícita.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('WEB_ORIGIN deve conter uma origem HTTP ou HTTPS válida.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('WEB_ORIGIN deve usar HTTP ou HTTPS.');
  }
  if (url.protocol === 'http:' && !LOCAL_HTTP_HOSTS.has(url.hostname)) {
    throw new Error('WEB_ORIGIN deve usar HTTPS fora do ambiente local.');
  }
  if (url.username || url.password) {
    throw new Error('WEB_ORIGIN não pode conter credenciais.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('WEB_ORIGIN deve conter somente a origem, sem path, query ou fragment.');
  }

  return url.origin;
}

export function createCorsOptions(value = process.env.WEB_ORIGIN): CorsOptions {
  const webOrigin = readWebOrigin(value);
  return {
    origin(requestOrigin, callback) {
      callback(null, requestOrigin === undefined || requestOrigin === webOrigin);
    },
    credentials: false,
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  };
}
