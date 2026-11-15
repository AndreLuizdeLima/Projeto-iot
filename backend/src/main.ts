import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { json, Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { CONFIG, Config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get<Config>(CONFIG);
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(helmet());
  app.use(json({ limit: '16kb' }));
  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== config.APP_ORIGIN
    ) {
      res.status(403).json({ message: 'Origem não permitida.' });
      return;
    }
    next();
  });
  app.use(
    '/auth/login',
    rateLimit({
      windowMs: 60000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { message: 'Muitas tentativas. Aguarde um minuto.' },
    }),
  );
  app.use(
    '/auth/bootstrap',
    rateLimit({
      windowMs: 60000,
      limit: 5,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { message: 'Muitas tentativas. Aguarde um minuto.' },
    }),
  );
  app.enableShutdownHooks();
  await app.listen(config.PORT, '0.0.0.0');
}
bootstrap().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Falha ao iniciar backend.');
  process.exitCode = 1;
});
