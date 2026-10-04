import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB_PROVIDER } from 'src/database/database.module';
import type { DrizzleDB } from 'src/database/database.module';
import { products } from 'src/database/schemas/products';

@Injectable()
export class ProductsService {
    constructor(@Inject(DB_PROVIDER) private readonly db: DrizzleDB) {}
    async findAll() {
        try {
            
            const results = await this.db.select({
                id: products.id,
                onHand: products.onHand,
                reserved: products.reserved,
                available: sql<number>`(${products.onHand} - ${products.reserved})`,
            }).from(products);
            return results;
        } catch (error) {
            console.error('Error fetching products:', error);
            throw error;
        }
    }
}
