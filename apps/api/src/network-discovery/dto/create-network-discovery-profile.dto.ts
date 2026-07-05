import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { NetworkDiscoveryMethod, NetworkDiscoveryMode } from '../../generated/prisma/enums';
import { IsIpv4Cidr } from '../validators/is-ipv4-cidr';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const trimArray = ({ value }: { value: unknown }): unknown => {
  if (!Array.isArray(value)) return value;
  const items: unknown[] = value;
  return items.map((item) => (typeof item === 'string' ? item.trim() : item));
};

export class CreateNetworkDiscoveryProfileDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsBoolean()
  enabled!: boolean;

  @IsEnum(NetworkDiscoveryMode)
  mode!: NetworkDiscoveryMode;

  @Transform(trimArray)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsIpv4Cidr({ each: true })
  allowedCidrs!: string[];

  @IsOptional()
  @Transform(trimArray)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsIpv4Cidr({ each: true })
  deniedCidrs?: string[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  rateLimitPerMinute!: number;

  @IsOptional()
  @IsBoolean()
  scheduleEnabled?: boolean;

  @ValidateIf((dto: CreateNetworkDiscoveryProfileDto) => dto.scheduleEnabled === true)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  scheduleExpression?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsEnum(NetworkDiscoveryMethod, { each: true })
  methods!: NetworkDiscoveryMethod[];
}
