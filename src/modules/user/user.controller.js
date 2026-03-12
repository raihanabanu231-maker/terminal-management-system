const pool = require("../../config/db");
const crypto = require("crypto");
const { sendInviteEmail } = require("../../utils/email");
const { logAudit } = require("../../utils/audit");

const SYSTEM_TENANT_ID = 'f8261f95-d148-4c77-9e80-d254129a8843';

exports.inviteUser = async (req, res) => {
  console.log("📥 Invite Request Body:", req.body);
  const { email, role_name, tenant_id, merchant_id } = req.body;

  const merchantRole = req.user.roles?.find(r => r.scope === 'merchant');
  const isTenantAdmin = req.user.role === 'TENANT_ADMIN' || req.user.roles?.some(r => r.name === 'Tenant Admin' || r.name === 'TENANT_ADMIN');

  try {
    if (!email || !role_name) {
      console.log("❌ Validation Failed: email or role_name missing in body");
      return res.status(400).json({ success: false, message: "Email and Role are required" });
    }

    // 🎯 NEW: TC-INV-04 — Invalid Email Format Check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ 
            success: false, 
            message: "Invalid email format. Please provide a valid email address (e.g., user@example.com)." 
        });
    }

    // --- DUPLICATE PREVENTION LOGIC ---
    // A. Check if user already exists
    const userExists = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "This email is already registered in the system. They do not need an invitation."
      });
    }

    // B. Check for existing pending invites and remove them to keep only the newest one valid
    await pool.query(
      "DELETE FROM user_invitations WHERE email = $1 AND status = 'pending'",
      [email]
    );
    // ----------------------------------

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
        // Validate UUID syntax before querying to avoid 22P02 error
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(tenant_id)) {
          console.log(`❌ Validation Failed: Invalid UUID format for tenant_id: [${tenant_id}]`);
          return res.status(400).json({
            success: false,
            message: "Invalid tenant_id format. Must be a valid UUID."
          });
        }
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

    // 🎯 NEW: TC-INV-05 — Role Hierarchy Protection
    if (req.user.role !== 'SUPER_ADMIN') {
        const higherRoles = ['SUPER_ADMIN', 'Super Admin'];
        if (higherRoles.includes(normalizedRoleName)) {
            return res.status(403).json({ 
                success: false, 
                message: "Permission Denied: You cannot invite users to a 'Super Admin' role. This action is restricted to system-wide owners." 
            });
        }
    }

    // Branch Admins cannot invite Tenant Admins
    if (req.user.role !== 'SUPER_ADMIN' && !isTenantAdmin) {
        if (normalizedRoleName.toLowerCase().includes('tenant admin')) {
            return res.status(403).json({ 
                success: false, 
                message: "Security Restriction: Branch-level admins cannot grant Company-wide (Tenant Admin) authority." 
            });
        }
    }

    // 2. Setup Logic
    if (req.user.role === "SUPER_ADMIN" && !tenant_id) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is REQUIRED. Please check your frontend payload (ensure it is snake_case 'tenant_id', not 'tenantId')."
      });
    }

    const finalTenantId = (req.user.role === "SUPER_ADMIN" && tenant_id) ? tenant_id : (req.user.tenant_id || SYSTEM_TENANT_ID);

    if (!finalTenantId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(400).json({ success: false, message: "tenant_id is required" });
    }

    // Comprehensive UUID validation for both fields to prevent 22P02 errors
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (finalTenantId && !uuidRegex.test(finalTenantId)) {
      return res.status(400).json({ success: false, message: "Invalid tenant_id format." });
    }
    if (merchant_id && !uuidRegex.test(merchant_id)) {
      return res.status(400).json({ success: false, message: "Invalid merchant_id format." });
    }

    const scopeType = merchant_id ? 'merchant' : 'tenant';
    const scopeId = merchant_id || finalTenantId;

    // --- SECURITY ACCESS CHECK FOR INVITER ---
    if (req.user.role !== 'SUPER_ADMIN' && !isTenantAdmin) {
        // This is a Branch Admin (Merchant Scoped)
        if (!merchant_id) {
            return res.status(403).json({ success: false, message: "Branch-level admins can only invite users to their own branch or sub-branches." });
        }
        
        // Use the scope_id from the freshly fixed JWT
        const userScopeId = merchantRole?.scope_id;
        if (!userScopeId) {
            return res.status(403).json({ success: false, message: "Unauthorized: Missing administrative scope identifier." });
        }

        // Verify the target merchant_id is inside the inviter's scope
        const targetMerch = await pool.query("SELECT path FROM merchants WHERE id = $1", [merchant_id]);
        if (targetMerch.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Target branch not found." });
        }

        const isWithinMyScope = targetMerch.rows[0].path.split('/').includes(userScopeId);
        if (!isWithinMyScope) {
            return res.status(403).json({ 
                success: false, 
                message: "Security Violation: You cannot invite users to a branch outside of your authorized scope." 
            });
        }
    }

    // 3. Generate Token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    console.log(`📦 INVITE CREATED: Token=[${rawToken}] Hash=[${tokenHash}]`);

    // 4. Insert Invitation
    console.log("🛠️ Preparing Invitation Insert:");
    console.log("   - created_by (req.user.id):", req.user.id);
    console.log("   - scope_id:", scopeId);
    console.log("   - finalTenantId:", finalTenantId);

    const checkUser = await pool.query("SELECT id FROM users WHERE id = $1", [req.user.id]);
    if (checkUser.rows.length === 0) {
      console.error("🚨 CRITICAL: The logged-in User ID does NOT exist in the database!");
    } else {
      console.log("✅ Verified: Logged-in User exists in DB.");
    }

    await pool.query(
      `INSERT INTO user_invitations 
       (tenant_id, merchant_id, email, role_id, scope_type, scope_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [finalTenantId, merchant_id || null, email, roleId, scopeType, scopeId, tokenHash, expiresAt, req.user.id]
    );

    // 5. Fetch Company Name for Email Personalization
    let companyName = "Our Company";
    if (merchant_id) {
      const merchantResult = await pool.query("SELECT name FROM merchants WHERE id = $1", [merchant_id]);
      companyName = merchantResult.rows[0]?.name || "Our Company";
    } else if (finalTenantId) {
      const tenantResult = await pool.query("SELECT name FROM tenants WHERE id = $1", [finalTenantId]);
      companyName = tenantResult.rows[0]?.name || "Our Company";
    } else {
      companyName = "Global TMS System";
    }
    // 6. Send Professional Email
    const frontendUrl = (process.env.FRONTEND_URL || "https://atpl-tms-frontend.onrender.com").replace(/\/$/, "");
    // 🎯 Constructing the link for History Mode (Confirmed working previously)
    const inviteLink = `${frontendUrl}/register?token=${rawToken}`;

    console.log(`📧 NEW INVITATION CREATED:`);
    console.log(`   - To: ${email}`);
    console.log(`   - Link: ${inviteLink}`);

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
    console.error("INVITE_ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      detail: error.detail,
      hint: error.hint,
      code: error.code,
      stack: error.stack // Temporarily for deep debugging
    });
  }
};

exports.getInvitations = async (req, res) => {
  try {
    let query = `
      SELECT ui.*, t.name as tenant_name, r.name as role_name 
      FROM user_invitations ui
      LEFT JOIN tenants t ON ui.tenant_id = t.id
      JOIN roles r ON ui.role_id = r.id
    `;
    const params = [];

    if (req.user.role !== "SUPER_ADMIN") {
      params.push(req.user.tenant_id);
      query += ` WHERE ui.tenant_id = $1`;
    } else if (req.query.tenant_id) {
      params.push(req.query.tenant_id);
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

exports.getUsers = async (req, res) => {
  try {
    let query = `
      SELECT u.id, u.email, u.first_name, u.last_name, u.mobile, u.status, u.created_at,
             t.name as tenant_name,
             array_agg(r.name) as roles
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
    `;
    const params = [];

    if (req.user.role !== "SUPER_ADMIN") {
      params.push(req.user.tenant_id);
      query += ` WHERE u.tenant_id = $1 AND u.deleted_at IS NULL`;
    } else if (req.query.tenant_id) {
      params.push(req.query.tenant_id);
      query += ` WHERE u.tenant_id = $1 AND u.deleted_at IS NULL`;
    } else {
      query += ` WHERE u.deleted_at IS NULL`;
    }

    query += ` GROUP BY u.id, t.name ORDER BY u.created_at DESC`;

    const result = await pool.query(query, params);
    res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error("GetUsers Error:", error);
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

exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { first_name, last_name, mobile, status } = req.body;

  try {
    const result = await pool.query(
      `UPDATE users SET 
        first_name = COALESCE($1, first_name), 
        last_name = COALESCE($2, last_name), 
        mobile = COALESCE($3, mobile), 
        status = COALESCE($4, status) 
       WHERE id = $5 RETURNING *`,
      [first_name, last_name, mobile, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, message: "User updated successfully", user: result.rows[0] });
  } catch (error) {
    console.error("UpdateUser Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteUser = async (req, res) => {
  const { id } = req.params;

  if (id === req.user.id) {
    return res.status(400).json({ success: false, message: "You cannot delete your own account" });
  }

  try {
    // Safety check: Prevent deleting the primary superadmin by email
    const checkSuper = await pool.query("SELECT email FROM users WHERE id = $1", [id]);
    if (checkSuper.rows.length > 0 && checkSuper.rows[0].email === 'superadmin@tms.com') {
        return res.status(403).json({ success: false, message: "Security Lock: The primary Super Admin account is protected." });
    }

    const result = await pool.query("UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found or already deleted" });
    }

    res.json({ success: true, message: "User soft-deleted successfully" });
  } catch (error) {
    console.error("DeleteUser Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
