const pool = require("../../config/db");

exports.createTenant = async (req, res) => {
  const { name } = req.body;

  try {
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
      detail: error.message
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
