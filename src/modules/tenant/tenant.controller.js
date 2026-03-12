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

exports.updateTenant = async (req, res) => {
  const { id } = req.params;
  const { name, status } = req.body;

  try {
    const result = await pool.query(
      "UPDATE tenants SET name = COALESCE($1, name), status = COALESCE($2, status) WHERE id = $3 RETURNING *",
      [name, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
    }

    res.json({ success: true, message: "Tenant updated successfully", data: result.rows[0] });
  } catch (error) {
    console.error("UpdateTenant ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteTenant = async (req, res) => {
  const { id } = req.params;
  const SYSTEM_TENANT_ID = 'f8261f95-d148-4c77-9e80-d254129a8843';

  if (id === SYSTEM_TENANT_ID) {
    return res.status(403).json({ 
      success: false, 
      message: "Security Lock: The System Administration tenant is protected and cannot be deleted. This is required for platform operations." 
    });
  }

  try {
    const result = await pool.query("DELETE FROM tenants WHERE id = $1 RETURNING *", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
    }

    res.json({ success: true, message: "Tenant deleted successfully" });
  } catch (error) {
    console.error("DeleteTenant ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

