import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

import { AppModule } from './app.module';
import { createCorsOptions } from './auth/cors.config';

async function bootstrap(): Promise<void> {
  loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
  const corsOptions = createCorsOptions();

  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors(corsOptions);
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
}

void bootstrap();
