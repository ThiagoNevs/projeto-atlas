import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class ManualEnrichmentAttributesDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) operatingSystem?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) osVersion?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) manufacturer?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) model?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) serialNumber?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) location?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) owner?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) department?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) environment?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) criticality?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) comment?: string;
}

export class ManualEnrichmentDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ManualEnrichmentAttributesDto)
  attributes!: ManualEnrichmentAttributesDto;
}
