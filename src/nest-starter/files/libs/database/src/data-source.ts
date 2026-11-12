import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from './snake-naming.strategy';

/** TypeORM CLI data source (`npm run migration:generate --name=Init`), run with ts-node from the repo root. */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_DATABASE,
  namingStrategy: new SnakeNamingStrategy(),
  entities: [__dirname + '/entities/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
});
