import { Body, Controller, Headers, Post, Res } from '@nestjs/common';
import { CreateFindingReviewCaseDto } from './dto/create-finding-review-case.dto';
import { FindingReviewCasesService } from './finding-review-cases.service';

interface PassthroughResponse {
  status(code: number): PassthroughResponse;
}

@Controller('conflict-review-cases')
export class FindingReviewCasesController {
  constructor(private readonly cases: FindingReviewCasesService) {}

  @Post()
  async create(
    @Body() payload: CreateFindingReviewCaseDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: PassthroughResponse,
  ) {
    const result = await this.cases.create(payload, idempotencyKey);
    response.status(result.idempotentReplay ? 200 : 201);
    return result;
  }
}
