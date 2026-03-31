
import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local
let databaseUrl = '';
try {
  const contents = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key === 'DATABASE_URL') databaseUrl = val;
  }
} catch (err) {
    console.error('Error reading .env.local:', err);
    process.exit(1);
}

if (!databaseUrl) {
    console.error('DATABASE_URL not found in .env.local');
    process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const res = await client.query("SELECT gametora_id, name FROM skills WHERE name ILIKE '%Straightaway Adept%';");
console.log(JSON.stringify(res.rows, null, 2));

await client.end();
