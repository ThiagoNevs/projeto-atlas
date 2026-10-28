import { IsInt, IsString, Max, Min } from 'class-validator';

export class SetConnectorSecretReferenceDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;

  @IsString()
  providerKind!: string;

  @IsString()
  logicalKey!: string;
}
