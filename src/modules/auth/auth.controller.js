const pool = require("../../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { logAudit } = require("../../utils/audit");

// --- CONFIG ---
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";
const LOCKOUT_LIMIT = 5;
const LOCKOUT_DURATION_MINS = 15;

exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Fetch user and their tenant's status
    const result = await pool.query(
      `SELECT u.*, t.status as tenant_status 
       FROM users u 
       JOIN tenants t ON u.tenant_id = t.id 
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

    if (user.tenant_status !== 'active') {
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
      `SELECT r.name, ur.role_id, ur.scope_type, ur.scope_id 
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = $1`,
      [user.id]
    );
    const roles = roleResult.rows;

    // 5. Generate Dual Tokens (Access + Refresh)
    const jti = crypto.randomBytes(16).toString("hex");
    const payload = {
      id: user.id,
      tenant_id: user.tenant_id,
      jti: jti,
      roles: roles.map(r => ({ name: r.name, id: r.role_id, scope: r.scope_type })),
      role: (roles[0]?.name || "USER").toUpperCase().replace(/\s+/g, "_")
    };

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const refreshToken = jwt.sign({ id: user.id, jti: jti }, process.env.JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });

    // 6. Record Session / Track JTI
    await pool.query(
      "INSERT INTO user_sessions (user_id, jti, ip_address, user_agent) VALUES ($1, $2, $3, $4)",
      [user.id, jti, req.ip, req.get('user-agent')]
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

    // 2. Check DB if session is active and not invalidated
    const sessionRes = await pool.query(
      "SELECT * FROM user_sessions WHERE user_id = $1 AND jti = $2 AND invalidated_at IS NULL",
      [decoded.id, decoded.jti]
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
      role: (roles[0]?.name || "USER").toUpperCase().replace(/\s+/g, "_")
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

    // Invalidate session in DB
    await pool.query(
      "UPDATE user_sessions SET invalidated_at = NOW() WHERE user_id = $1 AND jti = $2",
      [decoded.id, decoded.jti]
    );

    res.json({ success: true, message: "Logout successful" });
  } catch (error) {
    res.status(400).json({ success: false, message: "Invalid token or already logged out" });
  }
};

exports.registerWithInvite = async (req, res) => {
  const { token, password, first_name, last_name } = req.body;

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 1. Validate Invite
    const inviteResult = await pool.query(
      `SELECT * FROM user_invitations 
       WHERE token_hash = $1 AND status = 'pending' AND expires_at > NOW()`,
      [tokenHash]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired invite token"
      });
    }

    const invite = inviteResult.rows[0];

    // 2. Hash Password
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
          "UPDATE users SET password_hash = $1, first_name = $2, last_name = $3, status = 'active', invited = false WHERE id = $4",
          [hashedPassword, first_name, last_name, userId]
        );
      } else {
        const userRes = await client.query(
          `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, status, invited)
             VALUES ($1, $2, $3, $4, $5, 'active', false)
             RETURNING id`,
          [invite.tenant_id, invite.email, hashedPassword, first_name, last_name]
        );
        userId = userRes.rows[0].id;
      }

      // 4. Assign Role from Invitation
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, scope_type, scope_id)
         VALUES ($1, $2, $3, $4)`,
        [userId, invite.role_id, invite.scope_type, invite.scope_id]
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
    console.error("Register Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getInviteDetails = async (req, res) => {
  let token = req.body.token || req.query.token;

  if (token) {
    token = token.trim();
    console.log(`🔍 Handshake Received. Token: [${token}] (Length: ${token.length})`);
  } else {
    console.log("🔍 Handshake Received. No token found.");
  }

  try {
    if (!token) {
      console.error("❌ Handshake Error: No token provided in body or query");
      return res.status(400).json({ success: false, message: "Invitation token is missing" });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 1. Fetch Invite and Join with Roles and Tenants
    const result = await pool.query(
      `SELECT ui.email, r.name as role_name, t.name as company_name
       FROM user_invitations ui
       JOIN roles r ON ui.role_id = r.id
       JOIN tenants t ON ui.tenant_id = t.id
       WHERE ui.token_hash = $1 AND ui.status = 'pending' AND ui.expires_at > NOW()`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid or expired invite token" });
    }

    const invite = result.rows[0];

    res.json({
      success: true,
      data: {
        email: invite.email,
        company_name: invite.company_name,
        role: invite.role_name
      }
    });

  } catch (error) {
    console.error("GetInviteDetails Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
