import { Inject, Injectable } from '@nestjs/common';

import { SecretResolutionError } from './secret-resolution.errors';
import type { SecretProvider } from './secret-provider.interface';
import type { SecretProviderKind } from './secret-reference.types';

export const SECRET_PROVIDERS = Symbol('SECRET_PROVIDERS');

@Injectable()
export class SecretProviderRegistry {
  readonly #providers: ReadonlyMap<SecretProviderKind, SecretProvider>;

  constructor(@Inject(SECRET_PROVIDERS) providers: readonly SecretProvider[]) {
    const registered = new Map<SecretProviderKind, SecretProvider>();

    for (const provider of providers) {
      if (registered.has(provider.kind)) {
        throw new Error('A configuração de provedores de segredo contém tipos duplicados.');
      }
      registered.set(provider.kind, provider);
    }

    this.#providers = registered;
  }

  get(providerKind: SecretProviderKind): SecretProvider {
    const provider = this.#providers.get(providerKind);
    if (!provider) {
      throw new SecretResolutionError('PROVIDER_NOT_SUPPORTED');
    }
    return provider;
  }
}
