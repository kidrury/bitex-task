import { Module } from "@nestjs/common";
import { ReservationsScheduler } from "./reservations.scheduler";
import { ScheduleModule } from "@nestjs/schedule";
import { ReservationsModule } from "src/reservations/reservations.module";
import { ProductsModule } from "src/products/products.module";


@Module({
    imports: [ReservationsModule, ScheduleModule.forRoot()],
    providers: [ReservationsScheduler]
})
export class SchedulerModule {}