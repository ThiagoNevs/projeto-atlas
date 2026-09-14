import { Injectable } from '@nestjs/common';

import { ResolvedSecret } from './resolved-secret';
import { SecretResolutionError } from './secret-resolution.errors';
import { SecretProviderRegistry } from './secret-provider.registry';
import { parseSecretReference } from './secret-reference.types';

@Injectable()
export class SecretResolver {
  constructor(private readonly providers: SecretProviderRegistry) {}

  async resolve(referenceInput: unknown): Promise<ResolvedSecret> {
    const reference = parseSecretReference(referenceInput);
    const provider = this.providers.get(reference.providerKind);

    try {
      return await provider.resolve(reference);
    } catch (error) {
      if (error instanceof SecretResolutionError) {
        throw error;
      }
      throw new SecretResolutionError('PROVIDER_UNAVAILABLE', reference.providerKind);
    }
  }
}
