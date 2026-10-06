import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import * as schema from "./schemas"
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";

export type DrizzleDB = NodePgDatabase<typeof schema>
export const DB_PROVIDER = "DB"


const createDBConnection = async (connStr: string | undefined) => {
    if (!connStr) throw new Error("missing connection string") 

    let retries = 10

    while (retries) {
        try {
            // create connection to database
            const pool = new Pool({
                connectionString: connStr,
            })
            
            await pool.query("SELECT 1") // test connection

            return drizzle(pool, { schema })
        } catch (err) {
            retries -= 1
            console.log("failed to connect to database, retrying...")
            await new Promise((resolve) => setTimeout(resolve, 3000)) // wait 5 seconds before retrying
        }
    }

    throw new Error("failed to connect to database")
}





export const databaseProvider= {
    provide: DB_PROVIDER,
    inject: [ConfigService],
    useFactory: async (configService : ConfigService) => {
        const connectionString = configService.get<string>("DATABASE_URL")
        return await createDBConnection(connectionString)
    }
}


@Global()
@Module(
   {
    providers: [databaseProvider],
    exports: [DB_PROVIDER]
   }
)
export class DatabaseModule {}
