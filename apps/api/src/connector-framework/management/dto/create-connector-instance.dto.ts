import { IsObject, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateConnectorInstanceDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{0,62}$/)
  connectorType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsObject()
  configuration!: Record<string, unknown>;
}
