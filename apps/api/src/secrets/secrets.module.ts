import { Module } from '@nestjs/common';

import { EnvironmentSecretProvider } from './providers/environment-secret.provider';
import type { SecretProvider } from './secret-provider.interface';
import { SECRET_PROVIDERS, SecretProviderRegistry } from './secret-provider.registry';
import { SecretResolver } from './secret-resolver.service';

@Module({
  providers: [
    EnvironmentSecretProvider,
    {
      provide: SECRET_PROVIDERS,
      inject: [EnvironmentSecretProvider],
      useFactory: (environment: EnvironmentSecretProvider): readonly SecretProvider[] => [
        environment,
      ],
    },
    SecretProviderRegistry,
    SecretResolver,
  ],
  exports: [SecretResolver],
})
export class SecretsModule {}
