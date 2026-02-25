const pool = require("../../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Fetch user by email and tenant isolation check if needed
    // In this schema, email is unique per tenant_id, so we select all matches
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL AND status = 'active'",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "User not found or account disabled"
      });
    }

    const user = result.rows[0];

    // 2. Check password
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    // 3. Fetch user roles for the JWT
    // This allows us to include specific role IDs and names
    const roleResult = await pool.query(
      `SELECT r.name, ur.role_id, ur.scope_type, ur.scope_id 
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = $1`,
      [user.id]
    );

    const roles = roleResult.rows;

    // 4. Generate JWT
    const token = jwt.sign(
      {
        id: user.id,
        tenant_id: user.tenant_id,
        roles: roles.map(r => ({ name: r.name, id: r.role_id, scope: r.scope_type })),
        // For backwards compatibility with middleware expecting user.role
        role: roles[0]?.name.toUpperCase().replace(" ", "_") || "USER"
      },
      process.env.JWT_SECRET,
      { expiresIn: "100y" }
    );

    // 5. Track Session (Optional but recommended by schema)
    const jti = crypto.randomUUID();
    await pool.query(
      "INSERT INTO user_sessions (user_id, jti, ip_address, user_agent) VALUES ($1, $2, $3, $4)",
      [user.id, jti, req.ip, req.get('user-agent')]
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
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
    res.status(500).json({
      success: false,
      message: "Server error"
    });
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

      // Check if user exists (soft deleted might be an issue, we use email per tenant uniqueness)
      const existing = await client.query("SELECT id FROM users WHERE email = $1 AND tenant_id = $2", [invite.email, invite.tenant_id]);

      let userId;
      if (existing.rows.length > 0) {
        // If the user already existed (perhaps were added manually but not registered)
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
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

exports.getInviteDetails = async (req, res) => {
  const { token } = req.query; // ✅ Use query params: ?token=...

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 1. Fetch Invite and Join with Roles and Tenants to get the details
    const result = await pool.query(
      `SELECT ui.email, r.name as role_name, t.name as company_name
       FROM user_invitations ui
       JOIN roles r ON ui.role_id = r.id
       JOIN tenants t ON ui.tenant_id = t.id
       WHERE ui.token_hash = $1 AND ui.status = 'pending' AND ui.expires_at > NOW()`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired invite token"
      });
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
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};
