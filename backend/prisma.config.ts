import { defineConfig } from 'prisma/config';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env', quiet: true });
export default defineConfig({
  schema:
    process.env.DATABASE_PROVIDER === 'postgres'
      ? 'prisma-postgres/schema.prisma'
      : 'prisma/schema.prisma',
  migrations: {
    path:
      process.env.DATABASE_PROVIDER === 'postgres'
        ? 'prisma-postgres/migrations'
        : 'prisma/migrations',
  },
});
