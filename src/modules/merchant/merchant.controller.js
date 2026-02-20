const pool = require("../../config/db");

// Create a new Merchant (Store/Region)
exports.createMerchant = async (req, res) => {
    const { name, parent_id, external_id } = req.body;
    const tenant_id = req.user.tenant_id;

    try {
        // Trigger trg_merchant_path handles path and level calculation
        const result = await pool.query(
            `INSERT INTO merchants (name, tenant_id, parent_id, external_id, path) 
             VALUES ($1, $2, $3, $4, '') 
             RETURNING *`,
            [name, tenant_id, parent_id || null, external_id || null]
        );

        res.status(201).json({
            success: true,
            message: "Merchant created successfully",
            data: result.rows[0]
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get Merchant Hierarchy
exports.getMerchants = async (req, res) => {
    const tenant_id = req.user.tenant_id;

    try {
        const result = await pool.query(
            `SELECT * FROM merchants WHERE tenant_id = $1 ORDER BY path ASC`,
            [tenant_id]
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};
