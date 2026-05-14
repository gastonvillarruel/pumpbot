/**
 * scripts/setup-db.js
 * Inicializa o resetea la base de datos SQLite.
 * Uso: npm run setup-db [--reset]
 */

import { resolve } from 'path';
import { existsSync, unlinkSync } from 'fs';
import { loadConfig } from '../src/config/index.js';
import { initDatabase, closeDatabase } from '../src/storage/database.js';

const args = process.argv.slice(2);
const shouldReset = args.includes('--reset');

const cfg = loadConfig();
const dbPath = resolve(cfg.storage.dbPath);

if (shouldReset && existsSync(dbPath)) {
  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';
  unlinkSync(dbPath);
  if (existsSync(walPath)) unlinkSync(walPath);
  if (existsSync(shmPath)) unlinkSync(shmPath);
  console.log(`[setup-db] DB reseteada: ${dbPath}`);
}

const db = initDatabase(dbPath, cfg.storage.walMode);

// Verificar tablas creadas
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
).all().map(r => r.name);

console.log('[setup-db] Tablas creadas:');
tables.forEach(t => console.log(`  - ${t}`));

const version = db.prepare('SELECT MAX(version) as v FROM schema_version').get();
console.log(`[setup-db] Schema version: ${version?.v ?? 0}`);

closeDatabase();
console.log('[setup-db] OK — base de datos lista.');
