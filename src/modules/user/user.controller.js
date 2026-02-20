const pool = require("../../config/db");
const crypto = require("crypto");
const { sendInviteEmail } = require("../../utils/email");
const { logAudit } = require("../../utils/audit");

exports.inviteUser = async (req, res) => {
  const { name, email, role, tenant_id } = req.body;

  try {

    if (!name || !email || !role) {
      return res.status(400).json({
        success: false,
        message: "Name, email and role are required"
      });
    }


    if (!["TENANT_ADMIN", "OPERATOR"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role"
      });
    }


    if (role === "TENANT_ADMIN" && req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only SUPER_ADMIN can invite Tenant Admin"
      });
    }

    if (role === "OPERATOR" && req.user.role !== "TENANT_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only TENANT_ADMIN can invite Operator"
      });
    }


    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "User already exists"
      });
    }

    // Check if invitation already exists
    const existingInvite = await pool.query(
      "SELECT * FROM user_invitations WHERE email = $1 AND accepted_at IS NULL",
      [email]
    );

    if (existingInvite.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "User already invited"
      });
    }

    const inviteToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

    let finalTenantId = null;
    let scopeMerchantId = null;

    if (role === "TENANT_ADMIN") {
      if (!tenant_id) {
        return res.status(400).json({
          success: false,
          message: "tenant_id is required for TENANT_ADMIN"
        });
      }
      finalTenantId = tenant_id;
    } else {
      finalTenantId = req.user.tenant_id;
      // Flow 2: Scope to Merchant if provided
      if (req.body.merchant_id) {
        // Validate merchant belongs to tenant
        const merchantCheck = await pool.query(
          "SELECT * FROM merchants WHERE id = $1 AND tenant_id = $2",
          [req.body.merchant_id, finalTenantId]
        );
        if (merchantCheck.rows.length === 0) {
          return res.status(400).json({ success: false, message: "Invalid Merchant ID for this Tenant" });
        }
        scopeMerchantId = req.body.merchant_id;
      }
    }

    // Insert into user_invitations
    await pool.query(
      `INSERT INTO user_invitations 
       (email, role, tenant_id, scope_merchant_id, token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [email, role, finalTenantId, scopeMerchantId, inviteToken, expiresAt]
    );

    // Create invite link (Frontend URL usually, but using API endpoint for now or placeholder)
    // The flow says: https://tms.com/register?token=...
    // We'll use a placeholder or local frontend URL if dev
    const inviteLink = `http://localhost:3000/register?token=${inviteToken}`;

    // Send email via Brevo
    await sendInviteEmail(email, inviteLink);

    // Audit Log
    await logAudit("user.invite", req.user.id, email, "USER_INVITATION", { role, tenant_id: finalTenantId }, req.ip);

    res.status(201).json({
      success: true,
      message: `${role} invited successfully`,
      invite_token: inviteToken
    });


  } catch (error) {
    console.error("Invite Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};
