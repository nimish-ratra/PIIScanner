import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

async function bootstrap() {
  // ─── Production safety checks ────────────────────────────────────────────
  if (process.env.NODE_ENV === 'production') {
    if (process.env.AUTH_MODE === 'e2e') {
      console.error('FATAL: AUTH_MODE=e2e is not permitted in production. Exiting.');
      process.exit(1);
    }
    if (process.env.AUTH_MODE === 'development') {
      console.error('FATAL: AUTH_MODE=development is not permitted in production. Exiting.');
      process.exit(1);
    }
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
      console.error('FATAL: SESSION_SECRET must be at least 32 characters in production. Exiting.');
      process.exit(1);
    }
  }

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());

  // ─── Security headers ─────────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'"],
        styleSrc:    ["'self'", "'unsafe-inline'"],
        imgSrc:      ["'self'", 'data:'],
        connectSrc:  ["'self'"],
        frameSrc:    ["'none'"],
        objectSrc:   ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // Don't break API consumers
  }));

  // ─── CORS ─────────────────────────────────────────────────────────────────
  // Explicit allowlist — never wildcard with credentials
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:4100,http://localhost:3000,http://localhost:3002')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (e.g., curl, server-to-server)
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        (process.env.NODE_ENV !== 'production' && (
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:') ||
          origin.startsWith('http://192.168.') ||
          origin.startsWith('http://10.') ||
          origin.startsWith('http://172.')
        ))
      ) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
  });

  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}

await bootstrap();
