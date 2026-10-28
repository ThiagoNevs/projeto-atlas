import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';

import { ConnectorFrameworkError } from '../connector-framework.errors';
import { SecretResolutionError } from '../../secrets/secret-resolution.errors';

export function throwConnectorHttpError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  if (error instanceof ConnectorFrameworkError) {
    const body = {
      code: error.code,
      message: messageFor(error.code),
    };
    if (error.code === 'CONNECTOR_INSTANCE_VERSION_CONFLICT') {
      throw new ConflictException(body);
    }
    if (error.code === 'CONNECTOR_INSTANCE_NOT_FOUND' || error.code === 'CONNECTOR_RUN_NOT_FOUND') {
      throw new NotFoundException(body);
    }
    throw new BadRequestException(body);
  }
  if (error instanceof SecretResolutionError) {
    throw new BadRequestException({
      code:
        error.code === 'PROVIDER_NOT_SUPPORTED'
          ? 'CONNECTOR_SECRET_PROVIDER_UNSUPPORTED'
          : 'CONNECTOR_SECRET_REFERENCE_INVALID',
      message: 'A referência de segredo é inválida ou não suportada.',
    });
  }
  throw error;
}

function messageFor(code: string): string {
  const messages: Readonly<Record<string, string>> = {
    CONNECTOR_INSTANCE_NOT_FOUND: 'A instância de conector não foi encontrada.',
    CONNECTOR_RUN_NOT_FOUND: 'A execução de conector não foi encontrada.',
    CONNECTOR_DEFINITION_NOT_FOUND: 'A definição de conector não está disponível.',
    CONNECTOR_INSTANCE_DISABLED: 'A instância de conector está desabilitada.',
    CONNECTOR_INSTANCE_VERSION_CONFLICT: 'A instância foi alterada por outra operação.',
    CONNECTOR_CONFIG_INVALID: 'A configuração do conector é inválida.',
    CONNECTOR_CONFIG_VERSION_UNSUPPORTED: 'A versão da configuração não é suportada.',
    CONNECTOR_INSTANCE_CHANGED: 'A instância mudou desde a solicitação da execução.',
    CONNECTOR_SECRET_SLOT_MISSING: 'Uma referência de segredo obrigatória não está configurada.',
    CONNECTOR_SECRET_SLOT_NOT_DECLARED: 'O slot de segredo não é declarado pelo conector.',
    CONNECTOR_RUN_REQUEST_INVALID: 'A solicitação de execução é inválida.',
    CONNECTOR_RUN_REPLAY_INCONSISTENT: 'A repetição da solicitação é inconsistente.',
  };
  return messages[code] ?? 'A operação de conector foi rejeitada.';
}
