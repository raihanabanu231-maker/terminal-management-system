const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function addAndroidIdColumn() {
    try {
        console.log("Adding android_id column to devices table safely...");
        await pool.query('ALTER TABLE devices ADD COLUMN IF NOT EXISTS android_id TEXT;');
        
        // Also update init_db.js so future setups include it
        const fs = require('fs');
        const dbFile = 'init_db.js';
        let dbContent = fs.readFileSync(dbFile, 'utf8');
        dbContent = dbContent.replace(
            "serial TEXT NOT NULL UNIQUE,",
            "serial TEXT NOT NULL UNIQUE,\n        android_id TEXT,"
        );
        fs.writeFileSync(dbFile, dbContent);
        
        console.log("Successfully added android_id column without losing any data!");
    } catch (error) {
        console.error("Error:", error);
    } finally {
        await pool.end();
    }
}

addAndroidIdColumn();
