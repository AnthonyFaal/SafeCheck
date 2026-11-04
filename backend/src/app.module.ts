import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { AuthController, AuthService } from './auth';
import { SafetyController, SafetyService } from './safety';
import { AccessTokenGuard } from './security';
import { ProductController, ProductService } from './product';
import { PaystackWebhookController, PaystackWebhookService } from './paystack.webhook';
import { GroupSessionController, GroupSessionService } from './group-session';
import { MailService } from './mail.service';
import { InferenceClient } from './inference.client';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }), ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [AppController, AuthController, SafetyController, ProductController, PaystackWebhookController, GroupSessionController],
  providers: [AppService, PrismaService, AuthService, AccessTokenGuard, SafetyService, ProductService, PaystackWebhookService, GroupSessionService, MailService, InferenceClient, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
