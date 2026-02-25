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

    // 1. Get Role ID by Name (Case-Insensitive)
    // Super Admin can see roles globally, others are restricted to their tenant
    let roleQuery = "SELECT id, name FROM roles WHERE name ILIKE $1 AND (tenant_id IS NULL";
    const roleParams = [role_name.trim()];

    if (req.user.role !== "SUPER_ADMIN") {
      roleQuery += " OR tenant_id = $2";
      roleParams.push(req.user.tenant_id);
    } else {
      // Super admin can search in the target tenant's specific roles if provided
      if (tenant_id) {
        roleQuery += " OR tenant_id = $2";
        roleParams.push(tenant_id);
      } else {
        roleQuery += " OR 1=1"; // Allow finding any role if super admin doesn't specify tenant
      }
    }
    roleQuery += ") LIMIT 1";

    const roleResult = await pool.query(roleQuery, roleParams);

    if (roleResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: `Role '${role_name}' not found. Verify the role name is correct.`
      });
    }
    const roleId = roleResult.rows[0].id;
    const normalizedRoleName = roleResult.rows[0].name;

    // 2. Setup Logic
    const finalTenantId = tenant_id || req.user.tenant_id;
    const scopeType = merchant_id ? 'merchant' : 'tenant';
    const scopeId = merchant_id || finalTenantId;

    // 3. Generate Token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    console.log(`📦 INVITE CREATED: Token=[${rawToken}] Hash=[${tokenHash}]`);

    // 4. Insert Invitation
    await pool.query(
      `INSERT INTO user_invitations 
       (tenant_id, merchant_id, email, role_id, scope_type, scope_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [finalTenantId, merchant_id || null, email, roleId, scopeType, scopeId, tokenHash, expiresAt, req.user.id]
    );

    // 5. Fetch Company Name for Email Personalization
    const tenantResult = await pool.query("SELECT name FROM tenants WHERE id = $1", [finalTenantId]);
    const companyName = tenantResult.rows[0]?.name || "Our Company";

    // 6. Send Professional Email
    const frontendUrl = process.env.FRONTEND_URL || "https://atpl-tms-frontend.onrender.com";
    // 🎯 Constructing the link specifically for your Vue hash routing
    const inviteLink = `${frontendUrl}/#/register?token=${rawToken}`;

    await sendInviteEmail(email, inviteLink, {
      roleName: normalizedRoleName,
      companyName: companyName
    });

    // 7. Audit
    await logAudit(finalTenantId, req.user.id, "user.invite", "USER_INVITATION", null, { role_name: normalizedRoleName, email });

    res.status(201).json({
      success: true,
      invite_token: rawToken,
      full_invite_link: inviteLink,
      message: `Invitation for ${normalizedRoleName} sent to ${email} successfully`
    });

  } catch (error) {
    console.error("Invite Error:", error);
    res.status(500).json({ success: false, message: "Server error", detail: error.message });
  }
};

exports.getInvitations = async (req, res) => {
  try {
    let query = `
      SELECT ui.*, t.name as tenant_name, r.name as role_name 
      FROM user_invitations ui
      JOIN tenants t ON ui.tenant_id = t.id
      JOIN roles r ON ui.role_id = r.id
    `;
    const params = [];

    if (req.user.role !== "SUPER_ADMIN") {
      params.push(req.user.tenant_id);
      query += ` WHERE ui.tenant_id = $1`;
    }

    query += " ORDER BY ui.created_at DESC";

    const result = await pool.query(query, params);
    res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error("GetInvitations Error:", error);
    res.status(500).json({ success: false, message: "Server error", detail: error.message });
  }
};

exports.deleteInvitation = async (req, res) => {
  const { id } = req.params;

  try {
    // Check if invitation exists and if user has permission
    const checkQuery = "SELECT tenant_id FROM user_invitations WHERE id = $1";
    const checkResult = await pool.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Invitation not found" });
    }

    if (req.user.role !== "SUPER_ADMIN" && checkResult.rows[0].tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ success: false, message: "Unauthorized to delete this invitation" });
    }

    await pool.query("DELETE FROM user_invitations WHERE id = $1", [id]);

    // Log Audit
    await logAudit(checkResult.rows[0].tenant_id, req.user.id, "user.invite.delete", "USER_INVITATION_DELETED", null, { invitation_id: id });

    res.status(200).json({
      success: true,
      message: "Invitation deleted successfully"
    });
  } catch (error) {
    console.error("DeleteInvitation Error:", error);
    res.status(500).json({ success: false, message: "Server error", detail: error.message });
  }
};
