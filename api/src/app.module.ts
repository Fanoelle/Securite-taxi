import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { BaseModule } from './base/base.module';
import { ChauffeursModule } from './chauffeurs/chauffeurs.module';
import { ScanModule } from './scan/scan.module';
import { QrModule } from './qr/qr.module';
import { AuthModule } from './auth/auth.module';
import { SmsModule } from './sms/sms.module';
import { TrajetsModule } from './trajets/trajets.module';
import { AlertesModule } from './alertes/alertes.module';
import { DocumentsModule } from './documents/documents.module';
import { SignalementsModule } from './signalements/signalements.module';
import { PublicModule } from './public/public.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    BaseModule,
    SmsModule,
    AuthModule,
    ChauffeursModule,
    ScanModule,
    QrModule,
    TrajetsModule,
    AlertesModule,
    DocumentsModule,
    SignalementsModule,
    PublicModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
