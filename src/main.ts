import * as dotenv from 'dotenv';
import { join, resolve } from 'path';

const pkgEnv = resolve(__dirname, '..', '..', '.env');
const cwdEnv = join(process.cwd(), '.env');
dotenv.config({ path: cwdEnv });
dotenv.config({ path: pkgEnv, override: true });
console.log('📁 [FAQ-Amiqus Bootstrap] .env loaded (cwd:', process.cwd(), ')');

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  try {
    console.log('🚀 [FAQ-Amiqus] Starting application...');
    console.log('📋 OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing');
    console.log('📋 AMIQUS_API_KEY:', process.env.AMIQUS_API_KEY ? '✅ Set' : '❌ Missing');
    console.log('📋 PORT:', process.env.PORT || '3000 (default)');

    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: ['error', 'warn', 'log'],
      abortOnError: false,
      rawBody: true,
    });

    app.useStaticAssets(join(__dirname, '..', 'public'));

    app.enableCors({
      origin: [
        'http://localhost:9001',
        'http://localhost:8001',
        'http://127.0.0.1:8001',
        'http://localhost:8000',
        'http://127.0.0.1:8000',
        'http://127.0.0.1:3000',
        'http://localhost:3000',
        'http://localhost:9000',
        'http://127.0.0.1:9000',
        'https://main.d3970mma5pzr9g.amplifyapp.com',
        /\.amplifyapp\.com$/,
        /\.elasticbeanstalk\.com$/,
        /\.ngrok-free\.app$/,
        /\.ngrok\.io$/,
        /\.awsapprunner\.com$/,
      ],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
      }),
    );

    const config = new DocumentBuilder()
      .setTitle('FAQ & Compliance API')
      .setDescription('UCWS FAQ chatbot (RAG) + Amiqus KYC / DocuSeal contracts')
      .setVersion('1.0')
      .addTag('faq-chat', 'FAQ assistant')
      .addTag('compliance', 'Amiqus KYC / compliance init')
      .addTag('compliance-contracts', 'DocuSeal contract submissions')
      .addTag('compliance-webhooks', 'Amiqus & DocuSeal webhooks')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);

    app.getHttpAdapter().get('/health', (_req: any, res: any) => {
      res.status(200).json({ status: 'ok', service: 'faq-amiqus', timestamp: new Date().toISOString() });
    });

    const port = process.env.PORT || 3000;
    await app.listen(port, '0.0.0.0');
    console.log(`✅ FAQ & Compliance API listening on http://0.0.0.0:${port}  Swagger: /api  FAQ test UI: /faq-chat-test.html`);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    console.error('❌ [FAQ-Amiqus] Failed:', e?.message);
    console.error(e?.stack);
    process.exit(1);
  }
}

bootstrap().catch((error: unknown) => {
  const e = error as { message?: string };
  console.error('❌ [FAQ-Amiqus] Unhandled:', e?.message);
  process.exit(1);
});
