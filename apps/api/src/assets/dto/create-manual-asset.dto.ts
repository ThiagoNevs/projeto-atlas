import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { AdministrativeStatus } from '../../generated/prisma/enums';

export const MANUAL_IDENTIFIER_TYPES = [
  'HOSTNAME',
  'SERIAL_NUMBER',
  'ASSET_TAG',
  'MAC_ADDRESS',
  'INTERNAL_NAME',
] as const;
export const MANUAL_ASSET_TYPES = [
  'SERVER',
  'NOTEBOOK',
  'DESKTOP',
  'WORKSTATION',
  'VM',
  'NETWORK_DEVICE',
  'STORAGE',
  'PRINTER',
  'UNKNOWN',
] as const;

export type ManualIdentifierType = (typeof MANUAL_IDENTIFIER_TYPES)[number];

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class CreateManualAssetDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  identifier!: string;

  @IsIn(MANUAL_IDENTIFIER_TYPES)
  identifierType!: ManualIdentifierType;

  @IsIn(MANUAL_ASSET_TYPES)
  type!: string;

  @IsEnum(AdministrativeStatus)
  administrativeStatus!: AdministrativeStatus;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  hostname?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  serialNumber?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  manufacturer?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  model?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  operatingSystem?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  osVersion?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  location?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  owner?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  department?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  environment?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  criticality?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  comment?: string;
}
