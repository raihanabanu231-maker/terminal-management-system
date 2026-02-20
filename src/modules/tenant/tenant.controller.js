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
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};
