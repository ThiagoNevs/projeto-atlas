import type { ResolvedSecret } from './resolved-secret';
import type { SecretProviderKind, SecretReference } from './secret-reference.types';

export interface SecretProvider<TReference extends SecretReference = SecretReference> {
  readonly kind: SecretProviderKind;
  resolve(reference: TReference): Promise<ResolvedSecret>;
}
