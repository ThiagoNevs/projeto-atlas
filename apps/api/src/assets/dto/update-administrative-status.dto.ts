import { IsEnum, IsNotEmpty, IsString, Matches } from 'class-validator';

import { AdministrativeStatus } from '../../generated/prisma/enums';

export class UpdateAdministrativeStatusDto {
  @IsEnum(AdministrativeStatus)
  administrativeStatus!: AdministrativeStatus;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'reason must contain non-whitespace characters' })
  reason!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'comment must contain non-whitespace characters' })
  comment!: string;
}
