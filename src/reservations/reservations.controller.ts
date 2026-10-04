import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { reservationSchema } from './DTO/reservation.dto';
import type { ReservationDTO} from './DTO/reservation.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  async createReservation(@Req() req: Request, @Body(new ZodValidationPipe(reservationSchema)) body: ReservationDTO) {
    const idempotencyKey = req.headers['Idempotency-Key'];
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      throw new Error('Idempotency-Key header is required and must be a string');
    }

    const userId = "3631c0f9-e545-46ee-8145-a78e0384219e"; // will replace with actual user ID retrieval logic
    return this.reservationsService.createReservation(body, idempotencyKey, userId);
  }

  @Get(':id')
  async getReservations(@Param('id') reservationId: string) {
    const userId = "3631c0f9-e545-46ee-8145-a78e0384219e"; // will replace with actual user ID retrieval logic
    return this.reservationsService.getReservation(reservationId, userId);
  }
}
