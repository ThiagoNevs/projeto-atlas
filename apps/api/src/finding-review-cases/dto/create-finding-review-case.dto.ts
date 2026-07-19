import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateFindingReviewCaseDto {
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  @Matches(/^finding_[a-f0-9]{24}$/, {
    message: 'findingId deve possuir o formato de identificador de achado do Atlas.',
  })
  findingId!: string;
}
