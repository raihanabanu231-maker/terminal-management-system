const pool = require("../../config/db");

// Create a new Merchant (Store/Region)
exports.createMerchant = async (req, res) => {
    const { name, parent_id } = req.body;
    const tenant_id = req.user.tenant_id; // Always from token

    try {
        let path = "";
        let level = 0;

        if (parent_id) {
            const parentRes = await pool.query("SELECT path, level FROM merchants WHERE id = $1", [parent_id]);
            if (parentRes.rows.length > 0) {
                path = parentRes.rows[0].path;
                level = parentRes.rows[0].level + 1;
            }
        }

        const result = await pool.query(
            `INSERT INTO merchants (name, tenant_id, parent_id, level, path) 
             VALUES ($1, $2, $3, $4, $5) 
             RETURNING *`,
            [name, tenant_id, parent_id || null, level, ""]
        );

        // Update path correctly with new ID
        const newId = result.rows[0].id;
        const finalPath = path ? `${path}.${newId}` : `${newId}`;

        await pool.query("UPDATE merchants SET path = $1 WHERE id = $2", [finalPath, newId]);
        result.rows[0].path = finalPath;

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
            `SELECT * FROM merchants WHERE tenant_id = $1`,
            [tenant_id]
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};
