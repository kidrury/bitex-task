import { BadRequestException, Body, Controller, Get, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { reservationSchema } from './DTO/reservation.dto';
import type { ReservationDTO} from './DTO/reservation.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { BearerGuard } from 'src/auth/auth.guard';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @UseGuards(BearerGuard)
  @Post()
  async createReservation(@Req() req: Request, @Body(new ZodValidationPipe(reservationSchema)) body: ReservationDTO) {
    const idempotencyKey = req.headers['idempotency-key'] as string;
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      throw new BadRequestException('Idempotency-Key header is required and must be a string');
    }


    const userId = req['userId'];
    if (!userId) {
      throw new UnauthorizedException('missing userId')
    }

    return this.reservationsService.createReservation(body, idempotencyKey, userId);
  }

  @UseGuards(BearerGuard)
  @Get(':id')
  async getReservations(@Req() req: Request, @Param('id') reservationId: string) {
    const userId = req['userId'];
    
    if (!userId) {
      throw new UnauthorizedException('missing userId')
    }
    
    return this.reservationsService.getReservation(reservationId, userId);
  }

  @UseGuards(BearerGuard)
  @Post(':id/confirm')
  async confirmReservation(@Req() req: Request, @Param('id') reservationId: string) {
    const userId = req['userId'];

    if (!userId) {
      throw new UnauthorizedException('missing userId')
    }

    return this.reservationsService.confirmReservation(reservationId, userId);
  }

  @UseGuards(BearerGuard)
  @Post(':id/cancel')
  async cancelReservation(@Req() req: Request, @Param('id') reservationId: string) {
    const userId = req['userId'];

    if (!userId) {
      throw new UnauthorizedException('missing userId')
    }

    return this.reservationsService.cancelReservation(reservationId, userId);
  }
}
