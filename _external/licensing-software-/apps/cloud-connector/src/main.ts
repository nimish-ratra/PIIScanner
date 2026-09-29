import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('CloudConnectorBootstrap');
  const app = await NestFactory.create(AppModule);

  const port = process.env.CLOUD_CONNECTOR_PORT || 3004;
  await app.listen(port);

  logger.log(`clAIssify Office 365 Cloud Connector running on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error starting Cloud Connector:', err);
  process.exit(1);
});
