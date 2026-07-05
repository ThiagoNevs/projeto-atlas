import { IsIn, IsNotEmpty, IsString, Matches } from 'class-validator';

import { ConflictStatus } from '../../generated/prisma/enums';

export const EDITABLE_CONFLICT_STATUSES = [
  ConflictStatus.OPEN,
  ConflictStatus.IN_REVIEW,
  ConflictStatus.RESOLVED,
  ConflictStatus.IGNORED,
  ConflictStatus.EXCEPTION,
] as const;

export class UpdateConflictStatusDto {
  @IsIn(EDITABLE_CONFLICT_STATUSES)
  status!: ConflictStatus;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'reason must contain non-whitespace characters' })
  reason!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'comment must contain non-whitespace characters' })
  comment!: string;
}
