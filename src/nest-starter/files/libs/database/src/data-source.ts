import 'dotenv/config';
import { DataSource } from 'typeorm';
import { migrations } from './migrations';
import { SnakeNamingStrategy } from './snake-naming.strategy';

/**
 * Data source for the TypeORM CLI (`npm run migration:*`) and `npm run seed`,
 * run with ts-node from the repo root. Migrations come from the same explicit
 * list the apps use (`migrations/index.ts`).
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_DATABASE,
  namingStrategy: new SnakeNamingStrategy(),
  entities: [__dirname + '/entities/*.entity{.ts,.js}'],
  migrations,
});
