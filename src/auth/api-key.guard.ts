import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expectedKeys = [
    process.env.API_KEY,
    process.env.AUTH_TOKEN,
    'bitex-secret',
  ].filter(Boolean) as string[];

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    const apiKeyHeader = request.headers['x-api-key'];

    const provided = this.extractToken(authHeader) ?? this.extractToken(apiKeyHeader);

    if (!provided) {
      throw new UnauthorizedException('Authentication required.');
    }

    const isValid = this.expectedKeys.some((token) => token === provided);

    if (!isValid) {
      throw new UnauthorizedException('Invalid API key.');
    }

    return true;
  }

  private extractToken(headerValue: string | string[] | undefined): string | undefined {
    if (!headerValue) {
      return undefined;
    }

    const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (value.toLowerCase().startsWith('bearer ')) {
      return value.slice(7).trim();
    }

    return value.trim();
  }
}
