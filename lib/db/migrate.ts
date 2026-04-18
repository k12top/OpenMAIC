import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb } from './index';

export async function runMigrations() {
  const db = getDb();
  await migrate(db, { migrationsFolder: './drizzle' });
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations completed successfully');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
