const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function updateInviteSchema() {
    try {
        console.log("Adding first_name and last_name columns to user_invitations...");
        await pool.query('ALTER TABLE user_invitations ADD COLUMN IF NOT EXISTS first_name TEXT;');
        await pool.query('ALTER TABLE user_invitations ADD COLUMN IF NOT EXISTS last_name TEXT;');
        
        // Also update init_db.js so future setups include it
        const fs = require('fs');
        const dbFile = 'init_db.js';
        let dbContent = fs.readFileSync(dbFile, 'utf8');
        dbContent = dbContent.replace(
            "status TEXT NOT NULL DEFAULT 'pending'",
            "first_name TEXT,\n        last_name TEXT,\n        status TEXT NOT NULL DEFAULT 'pending'"
        );
        fs.writeFileSync(dbFile, dbContent);
        
        console.log("Successfully updated invitation schema!");
    } catch (error) {
        console.error("Error:", error);
    } finally {
        await pool.end();
    }
}

updateInviteSchema();
