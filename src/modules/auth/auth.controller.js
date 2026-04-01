const pool = require("../../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { logAudit } = require("../../utils/audit");
const { sendResetPasswordEmail } = require("../../utils/email");

// --- CONFIG ---
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";
const LOCKOUT_LIMIT = 5;
const LOCKOUT_DURATION_MINS = 15;
const SYSTEM_TENANT_ID = 'f8261f95-d148-4c77-9e80-d254129a8843';

exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Fetch user and their tenant's status
    const result = await pool.query(
      `SELECT u.*, t.status as tenant_status 
       FROM users u 
       LEFT JOIN tenants t ON u.tenant_id = t.id 
       WHERE u.email = $1 AND u.deleted_at IS NULL`,
      [email]
    );

    if (result.rows.length === 0) {
      // Security: Use generic message and generic login time behavior
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const user = result.rows[0];

    // 2. Check Account Status (Active/Locked)
    if (user.status !== 'active') {
      return res.status(403).json({ success: false, message: "Account is not active. Please contact support." });
    }

    if (user.tenant_id && user.tenant_status !== 'active') {
      return res.status(403).json({ success: false, message: "Your company account is suspended." });
    }

    // Check Lockout
    if (user.locked_until && new Date() < new Date(user.locked_until)) {
      const waitMins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return res.status(423).json({
        success: false,
        message: `Account is temporarily locked due to too many failed attempts. Try again in ${waitMins} minutes.`
      });
    }

    // 3. Validate Password
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      // Increment failed attempts
      const newAttempts = (user.failed_attempts || 0) + 1;
      let lockedUntil = null;

      if (newAttempts >= LOCKOUT_LIMIT) {
        lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINS * 60 * 1000);
      }

      await pool.query(
        "UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3",
        [newAttempts, lockedUntil, user.id]
      );

      // Audit Log
      await logAudit(user.tenant_id, user.id, "auth.login_failure", "USER", user.id, { attempts: newAttempts });

      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // 4. Success - Reset attempts and load roles
    await pool.query(
      "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1",
      [user.id]
    );

    const roleResult = await pool.query(
      `SELECT r.name, ur.role_id, ur.scope_type, ur.scope_id, m.name_path as scope_path
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       LEFT JOIN merchants m ON ur.scope_id = m.id
       WHERE ur.user_id = $1`,
      [user.id]
    );
    const roles = roleResult.rows;

    // 5. Generate Dual Tokens (Access + Refresh)
    const jti = crypto.randomBytes(16).toString("hex");
    const accessTokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15m
    const refreshTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7d

    const payload = {
      id: user.id,
      tenant_id: user.tenant_id,
      jti: jti,
      roles: roles.map(r => ({ 
          name: r.name, 
          id: r.role_id, 
          scope: r.scope_type, 
          scope_id: r.scope_id, 
          scope_path: r.scope_type === 'merchant' ? (r.scope_path ? r.scope_path.toLowerCase().trim().replace(/\/$/, '') + '/' : '/') : '/'
      })),
      role: (roles[0]?.name || "USER").trim().toUpperCase().replace(/\s+/g, "_")
    };

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const refreshToken = jwt.sign({ id: user.id, jti: jti }, process.env.JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    // 6. Record Session / Track JTI
    await pool.query(
      `INSERT INTO user_sessions 
       (user_id, tenant_id, access_jti, refresh_token_hash, access_expires_at, refresh_expires_at, ip_address, user_agent) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [user.id, user.tenant_id, jti, refreshTokenHash, accessTokenExpiry, refreshTokenExpiry, req.ip, req.get('user-agent')]
    );

    // Audit Log Success
    await logAudit(user.tenant_id, user.id, "auth.login_success", "USER", user.id, { ip: req.ip });

    res.json({
      success: true,
      message: "Login successful",
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: roles[0]?.name || "USER"
      }
    });

  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.refresh = async (req, res) => {
  const { refresh_token } = req.body;

  try {
    if (!refresh_token) return res.status(400).json({ success: false, message: "Refresh token is required" });

    // 1. Verify JWT
    const decoded = jwt.verify(refresh_token, process.env.JWT_SECRET);

    // 2. Check DB if session is active and not revoked
    const refreshTokenHash = crypto.createHash('sha256').update(refresh_token).digest('hex');
    const sessionRes = await pool.query(
      "SELECT * FROM user_sessions WHERE user_id = $1 AND access_jti = $2 AND refresh_token_hash = $3 AND revoked_at IS NULL",
      [decoded.id, decoded.jti, refreshTokenHash]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(401).json({ success: false, message: "Session expired or revoked" });
    }

    // 3. Reload roles to ensure permissions are up to date
    const userRoleResult = await pool.query(
      `SELECT u.tenant_id, r.name, ur.role_id, ur.scope_type, ur.scope_id 
       FROM user_roles ur
       JOIN users u ON ur.user_id = u.id
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = $1`,
      [decoded.id]
    );

    if (userRoleResult.rows.length === 0) return res.status(401).json({ success: false, message: "User has no roles" });

    const roles = userRoleResult.rows;
    const tenantId = roles[0].tenant_id;

    // 4. Issue new Access Token
    const payload = {
      id: decoded.id,
      tenant_id: tenantId,
      jti: decoded.jti,
      roles: roles.map(r => ({ name: r.name, id: r.role_id, scope: r.scope_type })),
      role: (roles[0]?.name || "USER").trim().toUpperCase().replace(/\s+/g, "_")
    };

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });

    res.json({
      success: true,
      access_token: accessToken
    });

  } catch (error) {
    console.error("Refresh Error:", error);
    res.status(401).json({ success: false, message: "Invalid refresh token" });
  }
};

exports.logout = async (req, res) => {
  const { refresh_token } = req.body; // Usually sent from frontend to invalidate specific session

  try {
    if (!refresh_token) {
      return res.status(400).json({ success: false, message: "Refresh token required for logout" });
    }

    const decoded = jwt.verify(refresh_token, process.env.JWT_SECRET);

    // Revoke session in DB
    await pool.query(
      "UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND access_jti = $2",
      [decoded.id, decoded.jti]
    );

    res.json({ success: true, message: "Logout successful" });
  } catch (error) {
    res.status(400).json({ success: false, message: "Invalid token or already logged out" });
  }
};

exports.registerWithInvite = async (req, res) => {
  const { password, first_name, last_name, mobile } = req.body;
  const token = req.body.token || req.query.token;

  // 🎯 NEW: TC-REG-05 — Missing Required Fields Check
  if (!first_name || !last_name || !mobile || !password) {
      console.log("❌ Registration Failed: One or more mandatory fields are missing.");
      return res.status(400).json({ 
          success: false, 
          message: "All fields are required (First Name, Last Name, Mobile, and Password). Please complete the form." 
      });
  }

  try {
    if (!token) {
      console.log("❌ Registration Failed: No token provided in body or query");
      return res.status(400).json({ success: false, message: "Invitation token is required" });
    }

    const cleanToken = (typeof token === 'string' ? token : String(token)).trim();
    const tokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');

    console.log(`🔍 Register_Handshake: ReceivedTokenPrefix=[${cleanToken.substring(0, 5)}...] Length=${cleanToken.length} GeneratedHash=[${tokenHash}]`);

    // 1. Validate Invite
    const dbCheck = await pool.query("SELECT current_database(), current_user, inet_server_addr()");
    const countCheck = await pool.query("SELECT count(*) FROM user_invitations");
    console.log(`🔍 DB_Check: DB=[${dbCheck.rows[0].current_database}] User=[${dbCheck.rows[0].current_user}] IP=[${dbCheck.rows[0].inet_server_addr}] TotalInvitations=[${countCheck.rows[0].count}]`);

    const inviteResult = await pool.query(
      `SELECT * FROM user_invitations WHERE token_hash ILIKE $1`,
      [tokenHash]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired invite token (Not Found in DB)",
        debug_received_hash: tokenHash,
        debug_db: dbCheck.rows[0].current_database,
        debug_invitations_count: countCheck.rows[0].count
      });
    }

    const invite = inviteResult.rows[0];

    if (invite.status !== 'pending') {
      return res.status(400).json({ success: false, message: `This invitation has already been ${invite.status}.` });
    }

    if (new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: "This invitation has expired." });
    }

    // 2. Hash Password (Defensive check to prevent 500 if password missing)
    if (!password) {
      console.log("❌ Registration Failed: Password missing in body");
      return res.status(400).json({ success: false, message: "Password is required for registration" });
    }

    // 🎯 NEW: TC-REG-03 — Password Strength Validation
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({ 
            success: false, 
            message: "Password is too weak. It must be at least 8 characters long and include: 1 Uppercase, 1 Lowercase, 1 Number, and 1 Special Character (@$!%*?&#)." 
        });
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Create User in Transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Check if user exists
      const existing = await client.query("SELECT id FROM users WHERE email = $1", [invite.email]);

      let userId;
      if (existing.rows.length > 0) {
        userId = existing.rows[0].id;
        await client.query(
          "UPDATE users SET password_hash = $1, first_name = $2, last_name = $3, mobile = $4, status = 'active' WHERE id = $5",
          [hashedPassword, first_name, last_name, mobile || null, userId]
        );
      } else {
        const userRes = await client.query(
          `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, mobile, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'active')
             RETURNING id`,
          [invite.tenant_id || SYSTEM_TENANT_ID, invite.email, hashedPassword, first_name, last_name, mobile || null]
        );
        userId = userRes.rows[0].id;
      }

      // 4. Assign Role from Invitation
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, scope_type, scope_id)
         VALUES ($1, $2, $3, $4)`,
        [userId, invite.role_id, invite.scope_type, invite.scope_id || invite.tenant_id || SYSTEM_TENANT_ID]
      );

      // 5. Success - Mark as Accepted
      await client.query(
        "UPDATE user_invitations SET status = 'accepted' WHERE id = $1",
        [invite.id]
      );

      await client.query("COMMIT");

      // Audit Log Registration
      await logAudit(invite.tenant_id, userId, "user.register", "USER", userId, { email: invite.email });

      res.json({
        success: true,
        message: "Registration successful"
      });

    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error("Register Error (500):", {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail
    });
    res.status(500).json({
      success: false,
      message: "Server error during registration",
      detail: error.message,
      code: error.code
    });
  }
};

exports.ping = (req, res) => {
  res.json({ success: true, message: "Auth Controller Ping - v5 (Diagnostics)", timestamp: new Date() });
};

exports.getInviteDetails = async (req, res) => {
  let token = req.body.token || req.query.token;

  if (token) {
    token = (typeof token === 'string' ? token : String(token)).trim();
    console.log(`🔍 Handshake Received. Token: [${token}] (Length: ${token.length})`);
  } else {
    console.log("🔍 Handshake Received. No token found.");
  }

  try {
    if (!token) {
      console.error("❌ Handshake Error: No token provided in body or query");
      return res.status(400).json({ success: false, message: "Invitation token is missing" });
    }

    const cleanToken = (typeof token === 'string' ? token : String(token)).trim();
    const tokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');

    console.log(`🔍 Handshake_Trace: TokenPrefix=[${cleanToken.substring(0, 5)}...] Length=${cleanToken.length} Hash=[${tokenHash}]`);

    // 1. Fetch Invite and Join with Roles, Tenants, and Merchants
    // We check both merchant_id AND scope_id to be extra safe
    const result = await pool.query(
      `SELECT ui.*, r.name as role_name, t.name as tenant_name, m.name as merchant_name
       FROM user_invitations ui
       LEFT JOIN roles r ON ui.role_id = r.id
       LEFT JOIN tenants t ON ui.tenant_id = t.id
       LEFT JOIN merchants m ON (ui.merchant_id = m.id OR (ui.scope_type = 'merchant' AND ui.scope_id = m.id))
       WHERE ui.token_hash = $1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      console.log(`❌ Handshake_Trace: Hash not found in DB: ${tokenHash}`);
      return res.status(400).json({
        success: false,
        message: "Invalid or expired invite token (Not Found in DB)",
        debug_received_hash: tokenHash
      });
    }

    const invite = result.rows[0];
    console.log(`🔍 Handshake_Trace: Invite Found. Email=[${invite.email}] Status=[${invite.status}] Expires=[${invite.expires_at}] RoleExists=[${!!invite.role_name}]`);

    if (invite.status !== 'pending') {
      return res.status(400).json({ success: false, message: `This invitation has already been ${invite.status}.` });
    }

    if (new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: "This invitation has expired." });
    }

    res.json({
      success: true,
      data: {
        email: invite.email,
        // FORCE: If this is a merchant-level invite, merchant_name MUST be the company_name shown to user
        company_name: invite.merchant_name || invite.tenant_name || "Our Company",
        merchant_name: invite.merchant_name || null,
        root_tenant_name: invite.tenant_name || "Our Company",
        role: invite.role_name || "Member"
      }
    });

  } catch (error) {
    console.error("GetInviteDetails Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during invitation verification",
      detail: error.message,
      code: error.code
    });
  }
};

/**
 * 🔑 Forgot Password - Step 1: Request Reset Token
 */
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });

    // 1. Check if user exists (Ignore deletion)
    const userRes = await pool.query("SELECT id, tenant_id FROM users WHERE email = $1 AND deleted_at IS NULL", [email]);
    
    // Security: If user not found, don't tell the attacker. Say "If email exists..."
    if (userRes.rows.length === 0) {
      console.log(`🔍 ForgotPassword: Non-existent email [${email}] requested reset.`);
      return res.json({ success: true, message: "If an account with that email exists, we have sent a reset link." });
    }

    const user = userRes.rows[0];

    // 2. Generate Secure Token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 Hour

    // 3. Store in DB
    await pool.query(
      "INSERT INTO password_resets (email, token_hash, expires_at) VALUES ($1, $2, $3)",
      [email, tokenHash, expiresAt]
    );

    // 4. Send Email
    // Note: The frontend base URL should be in .env. We'll use a generic one or LOCALHOST for now.
    const dashboardUrl = process.env.DASHBOARD_URL || "http://localhost:3000";
    const resetLink = `${dashboardUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    
    await sendResetPasswordEmail(email, resetLink);

    // 5. Audit Log Request
    await logAudit(user.tenant_id, user.id, "auth.password_reset_requested", "USER", user.id, { ip: req.ip });

    res.json({ success: true, message: "If an account with that email exists, we have sent a reset link." });

  } catch (error) {
    console.error("ForgotPassword Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 🔐 Reset Password - Step 2: Validate Token and Update Password
 */
exports.resetPassword = async (req, res) => {
  const { email, token, newPassword } = req.body;

  try {
    if (!email || !token || !newPassword) {
      return res.status(400).json({ success: false, message: "All fields (email, token, newPassword) are required." });
    }

    // 🎯 Password Strength Check
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
        return res.status(400).json({ 
            success: false, 
            message: "New password is too weak. Must be 8+ chars with 1 Uppercase, 1 Lowercase, 1 Number, and 1 Special Char." 
        });
    }

    // 1. Hash the incoming token to match DB
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 2. Validate Token in DB
    const resetRes = await pool.query(
      "SELECT * FROM password_resets WHERE email = $1 AND token_hash = $2 AND used_at IS NULL AND expires_at > NOW()",
      [email, tokenHash]
    );

    if (resetRes.rows.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset token." });
    }

    const resetRequest = resetRes.rows[0];

    // 3. Update User Password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Update password and reset lockout/failed attempts
      const userRes = await client.query(
        "UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL WHERE email = $2 RETURNING id, tenant_id",
        [hashedPassword, email]
      );
      
      const userId = userRes.rows[0].id;
      const tenantId = userRes.rows[0].tenant_id;

      // Mark token as used
      await client.query("UPDATE password_resets SET used_at = NOW() WHERE id = $1", [resetRequest.id]);

      // Audit Log Success
      await logAudit(tenantId, userId, "auth.password_reset_success", "USER", userId, { ip: req.ip });

      await client.query("COMMIT");

      res.json({ success: true, message: "Password updated successfully. You can now login." });

    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error("ResetPassword Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
