const pool = require("../../config/db");

exports.createTenant = async (req, res) => {
  const { name } = req.body;

  try {
    // --- ADDED: UNIQUE NAME CHECK ---
    const duplicateRes = await pool.query(
      "SELECT id FROM tenants WHERE name = $1",
      [name]
    );

    if (duplicateRes.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: `A Tenant company with the exact name '${name}' already exists.`
      });
    }
    // --- END UNIQUE CHECK ---

    const result = await pool.query(
      "INSERT INTO tenants (name) VALUES ($1) RETURNING *",
      [name]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error("CreateTenant ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      detail: error.detail || error.message,
      code: error.code
    });
  }
};

exports.getTenants = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tenants ORDER BY created_at DESC");
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error("GetTenants ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      detail: error.message
    });
  }
};

exports.getMyTenant = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "No tenant associated with this user" });
    }

    const result = await pool.query("SELECT id, name, created_at FROM tenants WHERE id = $1", [tenantId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error("GetMyTenant ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      detail: error.message
    });
  }
};
