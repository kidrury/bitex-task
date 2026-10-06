import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg'
import * as schema from '../src/database/schemas'
import { products } from '../src/database/schemas'

const seed = async () => {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error('DATABASE_URL not set')
    }

    const pool = new Pool({connectionString})

    const db = drizzle(pool, { schema })

    await db.delete(products)

    console.log('starting seeding...');

    await db.insert(products).values([
        {
            id: 'SKU-A',
            name: 'product A',
            onHand: 10,
            reserved: 0
        },
        {
            id: 'SKU-B',
            name: 'product B',
            onHand: 5,
            reserved: 0
        },
        {
            id: 'SKU-C',
            name: 'product C',
            onHand: 0,
            reserved: 0
        }
    ])

    console.log('products seeded');
    console.log('seeding complete');

    await pool.end(); 
    
}

seed().then(()=>process.exit(0)).catch((err) => {
    console.log(err);
    process.exit(1);
})