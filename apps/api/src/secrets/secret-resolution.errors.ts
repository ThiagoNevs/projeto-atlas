import type { SecretProviderKind } from './secret-reference.types';

export type SecretResolutionErrorCode =
  | 'INVALID_REFERENCE'
  | 'PROVIDER_NOT_SUPPORTED'
  | 'SECRET_NOT_FOUND'
  | 'PROVIDER_UNAVAILABLE'
  | 'ACCESS_DENIED';

const SAFE_ERROR_MESSAGES: Readonly<Record<SecretResolutionErrorCode, string>> = Object.freeze({
  INVALID_REFERENCE: 'A referência de segredo é inválida.',
  PROVIDER_NOT_SUPPORTED: 'O provedor de segredo não é suportado.',
  SECRET_NOT_FOUND: 'O segredo solicitado não está disponível.',
  PROVIDER_UNAVAILABLE: 'O provedor de segredo está indisponível.',
  ACCESS_DENIED: 'O acesso ao segredo foi negado pelo provedor.',
});

export class SecretResolutionError extends Error {
  readonly code: SecretResolutionErrorCode;
  readonly providerKind?: SecretProviderKind;

  constructor(code: SecretResolutionErrorCode, providerKind?: SecretProviderKind) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = 'SecretResolutionError';
    this.code = code;
    this.providerKind = providerKind;
  }
}
