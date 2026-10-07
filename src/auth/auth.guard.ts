import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import type { Request } from 'express';
import { VALID_TOKENS } from './auth-constants';

@Injectable()
export class BearerGuard implements CanActivate {


  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers.authorization?.replace('Bearer ', '')

    if (!token || !VALID_TOKENS[token]) {
      throw new UnauthorizedException('invalid or missing token')
    }

    request['userId'] = VALID_TOKENS[token]

    return true;
  }
}
