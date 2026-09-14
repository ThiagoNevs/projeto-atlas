import { Injectable } from '@nestjs/common';

import { ResolvedSecret } from '../resolved-secret';
import { SecretResolutionError } from '../secret-resolution.errors';
import type { SecretProvider } from '../secret-provider.interface';
import type { EnvironmentSecretReference } from '../secret-reference.types';

const ENVIRONMENT_SECRET_PREFIX = 'ATLAS_SECRET_';

@Injectable()
export class EnvironmentSecretProvider implements SecretProvider<EnvironmentSecretReference> {
  readonly kind = 'ENV' as const;

  resolve(reference: EnvironmentSecretReference): Promise<ResolvedSecret> {
    const value = process.env[`${ENVIRONMENT_SECRET_PREFIX}${reference.logicalKey}`];
    if (value === undefined || value === '') {
      throw new SecretResolutionError('SECRET_NOT_FOUND', this.kind);
    }

    return Promise.resolve(ResolvedSecret.from(value));
  }
}
