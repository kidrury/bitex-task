import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from 'crypto';


@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

    catch(exception: any, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();

        const requestId = randomUUID();

        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const exceptionResponse = exception.getResponse();

            let message = 'an error has occurred';
            if (typeof exceptionResponse === 'object' && 'message' in exceptionResponse) {
            message = (exceptionResponse as any).message;
            }
            // If message is still a string AND there are details, use the first detail
            if (Array.isArray((exceptionResponse as any).details) && (exceptionResponse as any).details.length > 0) {
            message = (exceptionResponse as any).details[0];
            }

            return response.status(status).json({
                code: this.getErrorCode(status, message),
                message,
                requestId,
                timestamp: new Date().toISOString(),
            });
        }

        // what if it is not an http error?
        this.logger.error('Unhandled exception:', exception);

        return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred',
            requestId,
            timestamp: new Date().toISOString(),
        });
    }

    private getErrorCode(status: number, message: string) : string {
        switch (status) {
            case HttpStatus.BAD_REQUEST:
                if (message.includes("idempotency") || message.includes("Idempotency")) 
                    return "MISSING_IDEMPOTENCY_KEY"
                return "INVALID_REQUEST"
            
            case HttpStatus.NOT_FOUND:
                if (message.includes("product")) return "PRODUCT_NOT_FOUND"
                if (message.includes("reservation")) return "RESERVATION_NOT_FOUND"
                return "NOT_FOUND"

            case HttpStatus.CONFLICT:
                if (message.includes("idempotency")) return "IDEMPOTENCY_KEY_CONFLICT"
                if (message.includes("expired")) return "RESERVATION_EXPIRED"
                if (message.includes("inventory") || message.includes("product")) return "INSUFFICIENT_STOCK"
                if (message.includes("state")) return "INVALID_RESERVATION_STATE"
                return "CONFLICT"
                
            case HttpStatus.UNAUTHORIZED:
                return "UNAUTHORIZED"

            default:
                return "INTERNAL_SERVER_ERROR"
        }
    }
}