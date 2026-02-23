require("dotenv").config();
const { Pool } = require("pg");
const crypto = require("crypto");
const { sendInviteEmail } = require("./src/utils/email");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function inviteMohamed() {
    console.log("🚀 Starting manual invitation for Mohamed...");
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const email = "mohamedrashik09724@gmail.com";
        const tenantId = "de503960-2692-4aa6-8517-626680b89c70"; // Alpha Corp
        const roleId = "d6aa99a4-9aa5-47f5-96f7-faabcab137cd";   // Tenant Admin
        const superAdminId = "ebc80c76-826a-4cb6-b364-708f58050f4b";

        // 1. Generate Token
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

        // 2. Insert Invitation
        await client.query(
            `INSERT INTO user_invitations 
             (tenant_id, email, role_id, scope_type, scope_id, token_hash, expires_at, created_by, status)
             VALUES ($1, $2, $3, 'tenant', $1, $4, $5, $6, 'pending')`,
            [tenantId, email, roleId, tokenHash, expiresAt, superAdminId]
        );

        // 3. Send Email
        const inviteLink = `http://localhost:3000/register?token=${rawToken}`;
        await sendInviteEmail(email, inviteLink);

        await client.query("COMMIT");
        console.log(`✅ Success! Invitation sent to ${email}`);
        console.log(`🔗 Manual Link (if email fails): ${inviteLink}`);

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Failed to invite Mohamed:", error);
    } finally {
        client.release();
        await pool.end();
    }
}

inviteMohamed();
