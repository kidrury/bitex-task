import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ReservationsService } from "src/reservations/reservations.service";


@Injectable()
export class ReservationsScheduler {
    private isRunning = false;
  constructor(
    private readonly reservationsService: ReservationsService,
  ) {}

  @Cron('*/30 * * * * *') // runs every 30 seconds
  async handleExpiredReservations() {
    console.log('Checking for expired reservations...');
    if (this.isRunning) {
        console.log('Previous job still running, skipping this run.');
        return;
    }
      this.isRunning = true;
      
      try {
        const result = await this.reservationsService.cancelExpiredReservations();

      } catch(err) {
        console.log(err)
      }

      this.isRunning = false;
  }
}