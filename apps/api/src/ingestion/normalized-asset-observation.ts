import type { CurrentActor } from '../auth/auth.types';
import type { Prisma } from '../generated/prisma/client';

export interface NormalizedAssetObservation {
  readonly source: string;
  readonly sourceRecordId: string;
  readonly hostname: string;
  readonly type: string;
  readonly category?: string;
  readonly serialNumber?: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly operatingSystem?: string;
  readonly osVersion?: string;
  readonly observedAt: Date;
  readonly ipAddresses?: readonly string[];
  readonly macAddresses?: readonly string[];
  readonly confidenceScore?: number;
  readonly dataQualityScore?: number;
  readonly evidenceType: string;
  readonly payload: Prisma.InputJsonObject;
  readonly description: string;
  readonly connectorRunId?: string;
  readonly connectorObservationKey?: string;
  readonly auditActor?: CurrentActor;
}
