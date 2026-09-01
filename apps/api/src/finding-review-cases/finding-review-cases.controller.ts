import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { CreateFindingReviewCaseDto } from './dto/create-finding-review-case.dto';
import { CreateFindingReviewDecisionDto } from './dto/create-finding-review-decision.dto';
import { CreateFindingReviewDecisionSupersessionDto } from './dto/create-finding-review-decision-supersession.dto';
import { CreateFindingReviewCaseResolutionDto } from './dto/create-finding-review-case-resolution.dto';
import { CreateFindingReviewCaseReopenDto } from './dto/create-finding-review-case-reopen.dto';
import { QueryFindingReviewCasesDto } from './dto/query-finding-review-cases.dto';
import { UpdateFindingReviewCaseStatusDto } from './dto/update-finding-review-case-status.dto';
import { FindingReviewCasesService } from './finding-review-cases.service';
import { FindingReviewDecisionsService } from './finding-review-decisions.service';
import { FindingReviewDecisionSupersessionsService } from './finding-review-decision-supersessions.service';
import { FindingReviewResolutionsService } from './finding-review-resolutions.service';
import { FindingReviewReopensService } from './finding-review-reopens.service';
import { FindingReviewCaseContextsService } from './finding-review-case-contexts.service';

interface PassthroughResponse {
  status(code: number): PassthroughResponse;
}

const reviewCaseIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      statusCode: 400,
      code: 'INVALID_FINDING_REVIEW_CASE_ID',
      message: 'O identificador do caso de revisão é inválido.',
    }),
});

const reviewDecisionIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      statusCode: 400,
      code: 'INVALID_FINDING_REVIEW_DECISION_ID',
      message: 'O identificador da decisão de revisão é inválido.',
    }),
});

@Controller('conflict-review-cases')
export class FindingReviewCasesController {
  constructor(
    private readonly cases: FindingReviewCasesService,
    private readonly decisions: FindingReviewDecisionsService,
    private readonly decisionSupersessions: FindingReviewDecisionSupersessionsService,
    private readonly resolutions: FindingReviewResolutionsService,
    private readonly reopens: FindingReviewReopensService,
    private readonly contexts: FindingReviewCaseContextsService,
  ) {}

  @Post(':caseId/decisions/:decisionId/supersessions')
  async supersedeDecision(
    @Param('caseId', reviewCaseIdPipe) caseId: string,
    @Param('decisionId', reviewDecisionIdPipe) decisionId: string,
    @Body() payload: CreateFindingReviewDecisionSupersessionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: PassthroughResponse,
  ) {
    const result = await this.decisionSupersessions.create(
      caseId,
      decisionId,
      payload,
      idempotencyKey,
    );
    response.status(result.idempotentReplay ? 200 : 201);
    return result;
  }

  @Get()
  findAll(@Query() query: QueryFindingReviewCasesDto) {
    return this.cases.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', reviewCaseIdPipe) id: string) {
    return this.cases.findOne(id);
  }

  @Get(':id/context-comparison')
  compareContext(@Param('id', reviewCaseIdPipe) id: string) {
    return this.contexts.compare(id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', reviewCaseIdPipe) id: string,
    @Body() payload: UpdateFindingReviewCaseStatusDto,
  ) {
    return this.cases.updateStatus(id, payload);
  }

  @Post(':id/decisions')
  async createDecision(
    @Param('id', reviewCaseIdPipe) id: string,
    @Body() payload: CreateFindingReviewDecisionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: PassthroughResponse,
  ) {
    const result = await this.decisions.create(id, payload, idempotencyKey);
    response.status(result.idempotentReplay ? 200 : 201);
    return result;
  }

  @Post(':id/resolutions')
  async createResolution(
    @Param('id', reviewCaseIdPipe) id: string,
    @Body() payload: CreateFindingReviewCaseResolutionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: PassthroughResponse,
  ) {
    const result = await this.resolutions.create(id, payload, idempotencyKey);
    response.status(result.idempotentReplay ? 200 : 201);
    return result;
  }

  @Post(':id/reopens')
  async createReopen(
    @Param('id', reviewCaseIdPipe) id: string,
    @Body() payload: CreateFindingReviewCaseReopenDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: PassthroughResponse,
  ) {
    const result = await this.reopens.create(id, payload, idempotencyKey);
    response.status(result.idempotentReplay ? 200 : 201);
    return result;
  }

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
