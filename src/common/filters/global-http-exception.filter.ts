import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import {v4 as uuid} from "uuid";


@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
    catch(exception: HttpException, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const request = ctx.getRequest<Request>();
        const response = ctx.getResponse<Response>();
        const status = exception.getStatus();
        const exceptionResponse = exception.getResponse()

        let message = 'an error has occured';
        if (typeof exceptionResponse === 'object' && 'message' in exceptionResponse) {
            message = (exceptionResponse as any).message
        }

        const requestId = uuid();

        return {
            code: this.getErrorCode(status, message),
            message,
            requestId,
            timestamp: new Date().toISOString(),
        }
    }

    private getErrorCode(status: number, message: string) : string {
        switch (status) {
            case HttpStatus.BAD_REQUEST:
                if (message.includes("Idempotency-Key")) return "MISSING_IDEMPOTENCY_KEY"
                if (message.includes("duplicate")) return "DUPLICATE_PRODUCT"
                if (message.includes("quantity")) return "INVALID_QUANTITY"
                if (message.includes("empty")) return "EMPTY_ITEMS"
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