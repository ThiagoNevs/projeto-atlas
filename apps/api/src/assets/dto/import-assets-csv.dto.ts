import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ImportAssetsCsvDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500_000)
  csv!: string;
}
