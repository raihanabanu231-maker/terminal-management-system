const pool = require("../../config/db");
const crypto = require("crypto");
const { sendInviteEmail } = require("../../utils/email");
const { logAudit } = require("../../utils/audit");

const SYSTEM_TENANT_ID = 'f8261f95-d148-4c77-9e80-d254129a8843';

// --- ROLE MANAGEMENT ---

// 1. Get Roles (For Dropdowns)
exports.getRoles = async (req, res) => {
  try {
    let query = "SELECT id, name, permissions FROM roles WHERE deleted_at IS NULL AND (tenant_id IS NULL";
    const params = [];

    if (req.user.role !== "SUPER_ADMIN") {
      params.push(req.user.tenant_id);
      query += " OR tenant_id = $1";
    } else {
      query += " OR 1=1";
    }
    query += ") ORDER BY name ASC";

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 2. Create Custom Role
exports.createRole = async (req, res) => {
  const { name, permissions, tenant_id } = req.body;
  const finalTenantId = (req.user.role === "SUPER_ADMIN" && tenant_id) ? tenant_id : req.user.tenant_id;

  if (!name || !permissions) return res.status(400).json({ message: "Name and permissions (array) are required" });

  try {
    const result = await pool.query(
      "INSERT INTO roles (tenant_id, name, permissions) VALUES ($1, $2, $3) RETURNING *",
      [finalTenantId, name, permissions]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// --- USER & INVITATION ENGINE ---

// 3. Invite User (High Security)
exports.inviteUser = async (req, res) => {
  let { email, role_id, role_name, tenant_id, merchant_id, web_app_url } = req.body;

  try {
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });

    const finalTenantId = (req.user.role === "SUPER_ADMIN" && tenant_id) ? tenant_id : req.user.tenant_id;

    // --- SANITIZE MERCHANT_ID (Standard across all features) ---
    if (merchant_id === "null" || merchant_id === "undefined" || merchant_id === "" || merchant_id === finalTenantId) {
      merchant_id = null;
    }

    // --- SMART ROLE RESOLUTION (Matches Frontend 'tenant admin' to 'TENANT_ADMIN') ---
    if (!role_id && role_name) {
      // Automatically translate spaces to underscores and make UPPERCASE (e.g. 'tenant admin' -> 'TENANT_ADMIN')
      const lookupName = role_name.trim().replace(/\s+/g, '_').toUpperCase();

      const roleLookup = await pool.query(
        "SELECT id FROM roles WHERE (name = $1 OR name ILIKE $1) AND (tenant_id = $2 OR tenant_id IS NULL)",
        [lookupName, finalTenantId]
      );
      if (roleLookup.rows.length === 0) return res.status(404).json({ success: false, message: `Role '${role_name}' / '${lookupName}' not found.` });
      role_id = roleLookup.rows[0].id;
    }

    if (!role_id) return res.status(400).json({ success: false, message: "Role ID or Role Name is required" });

    // 🔒 SECURITY: Role Escalation Protection
    const roleCheck = await pool.query("SELECT name FROM roles WHERE id = $1", [role_id]);
    const targetRoleName = roleCheck.rows[0]?.name;

    if (req.user.role !== 'SUPER_ADMIN' && targetRoleName === 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        message: "Security Violation: Only a Super Admin can invite another Super Admin. As a Tenant Admin, you can invite other Tenant Admins or Operators."
      });
    }

    const scopeType = (merchant_id && merchant_id !== finalTenantId) ? 'merchant' : 'tenant';
    const finalMerchantId = (scopeType === 'merchant') ? merchant_id : null;
    const scopeId = finalMerchantId || finalTenantId;

    // Check if user already exists
    const existingUser = await pool.query("SELECT id FROM users WHERE email = $1 AND tenant_id = $2", [email, finalTenantId]);
    if (existingUser.rows.length > 0) return res.status(400).json({ message: "This user is already a member of this tenant." });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    // Insert Invitation (Updated for Frontend spec)
    const result = await pool.query(
      `INSERT INTO user_invitations 
       (tenant_id, merchant_id, email, role_id, scope_type, scope_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [finalTenantId, finalMerchantId, email, role_id, scopeType, scopeId, tokenHash, expiresAt, req.user.id]
    );

    const inviteId = result.rows[0].id;

    // Email logic (Dynamic URL support)
    let inviteLink;
    if (web_app_url) {
      // Append token to custom frontend URL
      const separator = web_app_url.includes('?') ? '&' : '?';
      inviteLink = `${web_app_url}${separator}token=${rawToken}`;
    } else {
      const frontendUrl = (process.env.FRONTEND_URL || "https://atpl-tms-frontend.onrender.com").replace(/\/$/, "");
      inviteLink = `${frontendUrl}/register?token=${rawToken}`;
    }

    await sendInviteEmail(email, inviteLink, {
      companyName: req.body.company_name || "Enterprise TMS",
      roleName: role_name || "Team Member"
    });

    await logAudit(finalTenantId, req.user.id, "user.invite", "USER_INVITATION", inviteId, { email, scopeType });

    res.status(201).json({
      success: true,
      invite_token: rawToken,
      full_invite_link: inviteLink,
      message: `Invitation sent to ${email} successfully`
    });

  } catch (error) {
    console.error("INVITE_ERROR:", error);
    res.status(500).json({ success: false, message: "Server error during invitation" });
  }
};

// 4. List Users (with Roles)
exports.getUsers = async (req, res) => {
    try {
        const { role: userRole, tenant_id: userTenantId } = req.user;

        // 🎯 V7 HELPER: Get User Scope Path
        const roles = req.user.roles || [];
        let userScopePath = "/";
        if (userRole !== "SUPER_ADMIN") {
            const merchantRoles = roles.filter(r => r.scope === "merchant");
            if (merchantRoles.length > 0) {
                userScopePath = merchantRoles[0].scope_path;
            }
        }

        // We use a Subquery/Join to only show users who have at least one role 
        // that falls within our hierarchical scope.
        let query = `
            SELECT 
                u.id, u.email, u.first_name, u.last_name, u.status, u.created_at,
                json_agg(json_build_object(
                    'role', r.name,
                    'scope_type', ur.scope_type,
                    'branch_name', COALESCE(m.name, 'Tenant Wide'),
                    'branch_path', COALESCE(m.name_path, '/')
                )) as roles_detail
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            LEFT JOIN merchants m ON ur.scope_id = m.id
            WHERE u.deleted_at IS NULL
        `;
        const params = [];

        // 1. Tenant Scoping
        if (userRole !== "SUPER_ADMIN") {
            params.push(userTenantId);
            query += ` AND u.tenant_id = $${params.length}`;
        }

        // 2. Hierarchical Scoping (V7 Rule)
        // If I am a Branch Admin, I only see users who have a role AT or BELOW my path.
        if (userScopePath !== "/") {
            params.push(userScopePath);
            query += ` AND (m.name_path LIKE $${params.length} || '%')`;
        }

        query += ` GROUP BY u.id ORDER BY u.created_at DESC`;

        const result = await pool.query(query, params);
        res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 5. Update User Metadata
exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { first_name, last_name, status } = req.body;

  try {
    const result = await pool.query(
      `UPDATE users 
       SET first_name = COALESCE($1, first_name), 
           last_name = COALESCE($2, last_name), 
           status = COALESCE($3, status),
           updated_at = NOW()
       WHERE id = $4 AND deleted_at IS NULL RETURNING *`,
      [first_name, last_name, status, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "User not found" });

    await logAudit(result.rows[0].tenant_id, req.user.id, "user.update", "USER", id, { fields: Object.keys(req.body) });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 6. Delete User (Soft Delete)
exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ message: "You cannot delete your own account" });

  try {
    const result = await pool.query("UPDATE users SET deleted_at = NOW() WHERE id = $1 RETURNING *", [id]);
    if (result.rows.length === 0) return res.status(404).json({ message: "User not found" });

    await logAudit(result.rows[0].tenant_id, req.user.id, "user.delete", "USER", id);
    res.json({ success: true, message: "User soft-deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// --- INVITATION TRACKING ---

// 7. Get All Pending Invites
exports.getInvitations = async (req, res) => {
  try {
    let query = "SELECT i.*, r.name as role_name FROM user_invitations i JOIN roles r ON i.role_id = r.id WHERE i.deleted_at IS NULL";
    const params = [];

    if (req.user.role !== "SUPER_ADMIN") {
      params.push(req.user.tenant_id);
      query += " AND i.tenant_id = $1";
    }
    query += " ORDER BY i.created_at DESC";

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 8. Revoke Invitation
exports.deleteInvitation = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("UPDATE user_invitations SET deleted_at = NOW() WHERE id = $1 RETURNING *", [id]);
    if (result.rowCount === 0) return res.status(404).json({ message: "Invitation not found" });

    await logAudit(result.rows[0].tenant_id, req.user.id, "user.invite_revoked", "USER_INVITATION", id);
    res.json({ success: true, message: "Invitation revoked successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
