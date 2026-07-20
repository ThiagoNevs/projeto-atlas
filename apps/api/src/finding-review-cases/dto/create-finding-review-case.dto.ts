import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';

import { CONFLICT_FINDING_ID_PATTERN } from '../../conflict-analysis/conflict-finding-id';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateFindingReviewCaseDto {
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  @Matches(CONFLICT_FINDING_ID_PATTERN, {
    message: 'findingId deve possuir o formato de identificador de achado do Atlas.',
  })
  findingId!: string;
}
