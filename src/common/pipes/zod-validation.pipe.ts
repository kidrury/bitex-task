import { BadRequestException, PipeTransform } from "@nestjs/common";
import { z, ZodError } from "zod";


export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodType) {}

  transform(value: any) {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.issues.map((err) => {
          const path = err.path.join('.');
          return `${path || 'body'}: ${err.message}`;
        })

        throw new BadRequestException({
          message: messages[0],
          details: messages
        })
      }
      throw error
    }
  }
}