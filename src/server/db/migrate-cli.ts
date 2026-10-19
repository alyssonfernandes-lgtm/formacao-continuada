import { getPool, closePool } from './pool.js';
import { migrate } from './migrate.js';

migrate(getPool(), console.log)
  .then(() => console.log('Banco atualizado.'))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closePool);
