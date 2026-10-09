import type { ConnectorSecretReference } from '../generated/prisma/client';
import type { ResolvedSecret } from '../secrets/resolved-secret';
import { SecretResolver } from '../secrets/secret-resolver.service';
import { ConnectorFrameworkError } from './connector-framework.errors';
import type { ConnectorSecretSlots } from './connector-framework.types';

export class ConnectorSecretSlotResolver implements ConnectorSecretSlots {
  private readonly declared: ReadonlySet<string>;
  private readonly references: ReadonlyMap<
    string,
    Pick<ConnectorSecretReference, 'providerKind' | 'logicalKey'>
  >;
  private readonly resolved = new Map<string, Promise<ResolvedSecret>>();

  constructor(
    private readonly resolver: SecretResolver,
    declaredSlots: readonly string[],
    references: readonly Pick<ConnectorSecretReference, 'slot' | 'providerKind' | 'logicalKey'>[],
  ) {
    this.declared = new Set(declaredSlots);
    this.references = new Map(
      references.map(({ slot, providerKind, logicalKey }) => [slot, { providerKind, logicalKey }]),
    );
  }

  async resolve(slot: string): Promise<ResolvedSecret> {
    if (!this.declared.has(slot)) {
      throw new ConnectorFrameworkError('CONNECTOR_SECRET_SLOT_NOT_DECLARED');
    }
    const reference = this.references.get(slot);
    if (!reference) throw new ConnectorFrameworkError('CONNECTOR_SECRET_SLOT_MISSING');
    const pending = this.resolved.get(slot) ?? this.resolver.resolve(reference);
    this.resolved.set(slot, pending);
    return pending;
  }
}
