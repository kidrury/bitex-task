import { PipeTransform } from "@nestjs/common";
import { z } from "zod";


export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodType) {}

  transform(value: any) {
    return this.schema.parse(value);
  }
}