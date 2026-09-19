import type { AtlasPermission } from '@atlas/shared';

import { ATLAS_PERMISSIONS } from './permissions';

const SAFE_IDENTIFIER = /^[\x21-\x7e]{1,200}$/;
const SAFE_DISPLAY_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._:/()-]{0,99}$/;
const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(Object.values(ATLAS_PERMISSIONS));

export interface ServiceActorRegistration {
  readonly clientId: string;
  readonly subject: string;
  readonly displayName: string;
  readonly permissions: readonly AtlasPermission[];
}

export class ServiceActorPolicy {
  readonly #registrationsByClientId: ReadonlyMap<string, ServiceActorRegistration>;

  private constructor(registrations: readonly ServiceActorRegistration[]) {
    this.#registrationsByClientId = new Map(
      registrations.map((registration) => [registration.clientId, registration]),
    );
    Object.freeze(this);
  }

  static fromEnvironment(raw: string | undefined, humanClientId: string): ServiceActorPolicy {
    if (raw === undefined || raw === '') return new ServiceActorPolicy([]);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error('AUTH_SERVICE_ACTORS_JSON deve conter JSON válido.');
    }
    if (!Array.isArray(parsed)) {
      throw new Error('AUTH_SERVICE_ACTORS_JSON deve ser um array.');
    }

    const clientIds = new Set<string>();
    const subjects = new Set<string>();
    const registrations = parsed.map((value, index) => {
      if (!isPlainObject(value)) {
        throw new Error(`AUTH_SERVICE_ACTORS_JSON[${index}] deve ser um objeto.`);
      }
      const keys = Object.keys(value);
      const expectedKeys = ['clientId', 'displayName', 'permissions', 'subject'];
      if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) {
        throw new Error(`AUTH_SERVICE_ACTORS_JSON[${index}] contém campos inválidos.`);
      }

      const { clientId, subject, displayName, permissions } = value;
      if (typeof clientId !== 'string' || !SAFE_IDENTIFIER.test(clientId)) {
        throw new Error(`AUTH_SERVICE_ACTORS_JSON[${index}].clientId é inválido.`);
      }
      if (typeof subject !== 'string' || !SAFE_IDENTIFIER.test(subject)) {
        throw new Error(`AUTH_SERVICE_ACTORS_JSON[${index}].subject é inválido.`);
      }
      if (typeof displayName !== 'string' || !SAFE_DISPLAY_NAME.test(displayName)) {
        throw new Error(`AUTH_SERVICE_ACTORS_JSON[${index}].displayName é inválido.`);
      }
      if (!isStringArray(permissions)) {
        throw new Error(
          `AUTH_SERVICE_ACTORS_JSON[${index}].permissions deve ser um array de strings.`,
        );
      }
      if (clientId === humanClientId) {
        throw new Error('Uma registration SERVICE não pode usar AUTH_HUMAN_CLIENT_ID.');
      }
      if (clientIds.has(clientId)) {
        throw new Error('AUTH_SERVICE_ACTORS_JSON contém clientId duplicado.');
      }
      if (subjects.has(subject)) {
        throw new Error('AUTH_SERVICE_ACTORS_JSON contém subject duplicado.');
      }
      if (new Set(permissions).size !== permissions.length) {
        throw new Error(`AUTH_SERVICE_ACTORS_JSON[${index}].permissions contém duplicata.`);
      }
      if (permissions.includes('atlas:access')) {
        throw new Error('atlas:access deve vir do token e não da registration SERVICE.');
      }
      if (permissions.some((permission) => !KNOWN_PERMISSIONS.has(permission))) {
        throw new Error(`AUTH_SERVICE_ACTORS_JSON[${index}] contém permission desconhecida.`);
      }

      clientIds.add(clientId);
      subjects.add(subject);
      return Object.freeze({
        clientId,
        subject,
        displayName,
        permissions: Object.freeze([...permissions] as AtlasPermission[]),
      });
    });

    return new ServiceActorPolicy(Object.freeze(registrations));
  }

  findByClientId(clientId: string): ServiceActorRegistration | undefined {
    return this.#registrationsByClientId.get(clientId);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string');
}
