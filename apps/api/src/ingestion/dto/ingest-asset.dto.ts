import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIP,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const MAC_ADDRESS_PATTERN = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

export class IngestAssetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  source!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  sourceAssetId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  hostname!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  serialNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  manufacturer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  operatingSystem?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  osVersion?: string;

  @IsDateString()
  lastSeenAt!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @IsIP(undefined, { each: true })
  ipAddresses?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @Matches(MAC_ADDRESS_PATTERN, { each: true })
  macAddresses?: string[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  confidenceScore?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  dataQualityScore?: number;
}
