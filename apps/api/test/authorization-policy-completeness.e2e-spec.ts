import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from '@jest/globals';

import { AppModule } from '../src/app.module';
import { PUBLIC_ROUTE } from '../src/auth/public.decorator';
import { REQUIRED_PERMISSIONS } from '../src/auth/require-permissions.decorator';

type NestType = abstract new (...args: never[]) => unknown;

function registeredControllers(root: NestType): NestType[] {
  const visited = new Set<NestType>();
  const controllers = new Set<NestType>();
  function visit(moduleType: NestType): void {
    if (visited.has(moduleType)) return;
    visited.add(moduleType);
    for (const controller of (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleType) ??
      []) as NestType[]) {
      controllers.add(controller);
    }
    for (const imported of (Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) ??
      []) as unknown[]) {
      if (typeof imported === 'function') visit(imported as NestType);
    }
  }
  visit(root);
  return [...controllers];
}

describe('authorization policy completeness', () => {
  it('requires exactly one explicit policy on every registered HTTP handler', () => {
    const handlers: string[] = [];
    const publicHandlers: string[] = [];
    const missingOrAmbiguous: string[] = [];

    const controllers = registeredControllers(AppModule);
    expect(controllers).toHaveLength(16);
    for (const ControllerType of controllers) {
      const prototype = ControllerType.prototype as object;
      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        if (methodName === 'constructor') continue;
        const handler = Reflect.get(prototype, methodName) as unknown;
        if (
          typeof handler !== 'function' ||
          Reflect.getMetadata(METHOD_METADATA, handler) === undefined
        )
          continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
        const label = `${ControllerType.name}.${methodName} (${String(path ?? '')})`;
        handlers.push(label);
        const isPublic = Reflect.getMetadata(PUBLIC_ROUTE, handler) === true;
        const permissions = Reflect.getMetadata(REQUIRED_PERMISSIONS, handler) as
          readonly string[] | undefined;
        const hasPermissionPolicy = Array.isArray(permissions) && permissions.length > 0;
        if (isPublic) publicHandlers.push(label);
        if (Number(isPublic) + Number(hasPermissionPolicy) !== 1) missingOrAmbiguous.push(label);
      }
    }

    expect(handlers).toHaveLength(47);
    expect(publicHandlers).toEqual([
      'HealthController.check (/)',
      'HealthController.checkLive (live)',
      'HealthController.checkReady (ready)',
    ]);
    expect(missingOrAmbiguous).toEqual([]);
  });
});
