import path from 'node:path';
import fs from 'node:fs';
import { AttendanceDatabase } from '../storage.ts';
const source = process.argv[2];
const destination = process.argv[3];
if (!source || !destination || path.resolve(source) === path.resolve(destination)) {
  throw new Error('Usage: npm run migrate:attendance -- <legacy.json> <new.sqlite> (distinct paths required)');
}
if (fs.existsSync(destination)) throw new Error('Refusing import: destination already exists. Choose a new database path.');
const database = new AttendanceDatabase(destination);
try { database.importLegacy(source); console.log('Import committed. Legacy source left unchanged.'); }
finally { database.close(); }
