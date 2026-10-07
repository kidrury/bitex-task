import { Inject, Injectable } from '@nestjs/common';
import { sql, asc } from 'drizzle-orm';
import { DB_PROVIDER } from 'src/database/database.module';
import type { DrizzleDB } from 'src/database/database.module';
import { products } from 'src/database/schemas/products';

@Injectable()
export class ProductsService {
    constructor(@Inject(DB_PROVIDER) private readonly db: DrizzleDB) {}
    async findAll(page: number = 1, limit: number = 20) {
        const offset = (page -1) * limit
        const results = await this.db.select({
            id: products.id,
            onHand: products.onHand,
            reserved: products.reserved,
            available: sql<number>`(${products.onHand} - ${products.reserved})`,
        }).from(products).orderBy(asc(products.id)).limit(limit).offset(offset)

        const countResult = await this.db.select({
            count: sql<number>`COUNT(*)`
        }).from(products)

        const total = countResult[0].count || 0;

        return {
            data: results,
            pagination: {
                page, 
                limit, 
                total, 
                pages: 
                Math.ceil(total/limit)
            }
        }
    }
}
