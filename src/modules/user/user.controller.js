const pool = require("../../config/db");
const crypto = require("crypto");
const { sendInviteEmail } = require("../../utils/email");
const { logAudit } = require("../../utils/audit");

exports.inviteUser = async (req, res) => {
  const { first_name, last_name, email, role_name, tenant_id, merchant_id } = req.body;

  try {
    if (!email || !role_name) {
      return res.status(400).json({ success: false, message: "Email and Role are required" });
    }

    // 1. Get Role ID by Name
    // We look for tenant-specific role or global role if tenant_id is null
    const roleResult = await pool.query(
      "SELECT id FROM roles WHERE name = $1 AND (tenant_id = $2 OR tenant_id IS NULL) LIMIT 1",
      [role_name, req.user.tenant_id]
    );

    if (roleResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: "Role not found" });
    }
    const roleId = roleResult.rows[0].id;

    // 2. Logic Check (Tenant Admin vs Operator)
    // Simplified logic for now: matching the old requirements
    if (role_name === "Tenant Admin" && req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    // 3. Setup IDs
    const finalTenantId = tenant_id || req.user.tenant_id;
    const scopeType = merchant_id ? 'merchant' : 'tenant';
    const scopeId = merchant_id || finalTenantId;

    // 4. Generate Token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    // 5. Insert Invitation
    await pool.query(
      `INSERT INTO user_invitations 
       (tenant_id, merchant_id, email, role_id, scope_type, scope_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [finalTenantId, merchant_id || null, email, roleId, scopeType, scopeId, tokenHash, expiresAt, req.user.id]
    );

    // 6. Send Email
    const inviteLink = `http://localhost:3000/register?token=${rawToken}`;
    await sendInviteEmail(email, inviteLink);

    // 7. Audit
    await logAudit(finalTenantId, req.user.id, "user.invite", "USER_INVITATION", null, { role_name, email });

    res.status(201).json({
      success: true,
      invite_token: rawToken,
      message: "Invitation sent successfully"
    });

  } catch (error) {
    console.error("Invite Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
