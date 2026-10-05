import fs from 'node:fs/promises';
const schema = await fs.readFile('backend/prisma/schema.prisma', 'utf8');
await fs.mkdir('backend/prisma-postgres', { recursive: true });
await fs.writeFile(
  'backend/prisma-postgres/schema.prisma',
  schema.replace('provider = "sqlite"', 'provider = "postgresql"'),
);
console.log('PostgreSQL schema prepared; local SQLite schema preserved.');
