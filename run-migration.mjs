import pg from 'pg';
import fs from 'fs';
import dns from 'dns';

dns.setDefaultResultOrder('ipv4first');

const { Client } = pg;

const client = new Client({
  host: 'aws-1-us-east-2.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.yrdtltnkaxiuchvnbfmj',
  password: '0?2d1OnmX2L2',
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected to database');

    const sql = fs.readFileSync('./supabase/migrations/004_batch_claim.sql', 'utf8');

    console.log('Running migration...');
    await client.query(sql);
    console.log('Migration completed successfully!');

  } catch (err) {
    console.error('Migration failed:', err.message);
    if (err.code) console.error('Error code:', err.code);
  } finally {
    await client.end();
  }
}

runMigration();
