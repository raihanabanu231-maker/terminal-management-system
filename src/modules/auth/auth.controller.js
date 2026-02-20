const pool = require("../../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND status = 'ACTIVE'",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "User not found or inactive"
      });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid password"
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        tenant_id: user.tenant_id
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({
      success: true,
      message: "Login successful",
      token
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
  const { token, password, name } = req.body;

  try {
    // 1. Validate Invite Token
    const inviteResult = await pool.query(
      "SELECT * FROM user_invitations WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW()",
      [token]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired invite token"
      });
    }

    const invite = inviteResult.rows[0];

    // 2. Check if user already exists
    const existingUser = await pool.query("SELECT * FROM users WHERE email = $1", [invite.email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ success: false, message: "User with this email already exists" });
    }

    // 3. Hash Password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Create User
    await pool.query(
      `INSERT INTO users (name, email, password, role, tenant_id, merchant_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')`,
      [name || invite.email.split('@')[0], invite.email, hashedPassword, invite.role, invite.tenant_id, invite.scope_merchant_id]
    );

    // 5. Mark Invitation as Accepted
    await pool.query(
      "UPDATE user_invitations SET accepted_at = NOW() WHERE id = $1",
      [invite.id]
    );

    res.json({
      success: true,
      message: "Registration successful. You can now login."
    });

  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};
