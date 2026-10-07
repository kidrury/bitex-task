import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { ConfigModule } from '@nestjs/config';
import { ProductsModule } from './products/products.module';
import { ReservationsModule } from './reservations/reservations.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { APP_FILTER } from '@nestjs/core';
import { GlobalHttpExceptionFilter } from './common/filters/global-http-exception.filter';

@Module({
  imports: [SchedulerModule, DatabaseModule, ConfigModule.forRoot({
    isGlobal: true,
  }), ProductsModule, ReservationsModule],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalHttpExceptionFilter,
    },
  ],
})
export class AppModule {}
