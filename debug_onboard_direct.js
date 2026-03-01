require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const QRCode = require('qrcode');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const serial = "DEBUG-1234";
    const model = "TestModel";
    const merchant_id = "63866256-62f4-4491-a024-d868a7ede422";
    const finalTenantId = "53401707-d50e-451d-b2dd-c49eee831e3c";

    try {
        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        console.log("Attempting to insert into DB...");

        await pool.query(
            `INSERT INTO devices (serial, model, enrollment_token, enrollment_token_expires, merchant_id, tenant_id, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending_onboard')
             ON CONFLICT (serial) 
             DO UPDATE SET enrollment_token = $3, enrollment_token_expires = $4, status = 'pending_onboard'`,
            [serial, model, tokenHash, expiresAt, merchant_id, finalTenantId]
        );

        console.log("Insert success. Attempting QR generation...");

        const qrData = JSON.stringify({ token: token, tenant_id: finalTenantId, serial: serial });
        const qrCodeImage = await QRCode.toDataURL(qrData);

        console.log("SUCCESS. QR Length:", qrCodeImage.length);

    } catch (error) {
        console.error("DEBUG SCRIPT CAUGHT ERROR:", error.message);
        console.error(error);
    } finally {
        pool.end();
    }
}
run();
