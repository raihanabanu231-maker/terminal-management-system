const pool = require("../../config/db");
const crypto = require("crypto");

// Create a new Merchant (Store/Region)
exports.createMerchant = async (req, res) => {
    const { name, parent_id, external_id, tenant_id } = req.body;

    // Logic: Super Admin can specify tenant, others are locked to their own
    const finalTenantId = (req.user.role === "SUPER_ADMIN" && tenant_id)
        ? tenant_id
        : req.user.tenant_id;

    if (!finalTenantId && req.user.role !== "SUPER_ADMIN") {
        return res.status(400).json({ success: false, message: "tenant_id missing from context" });
    }
    if (req.user.role === "SUPER_ADMIN" && !finalTenantId) {
        return res.status(400).json({ success: false, message: "tenant_id is REQUIRED for superadmin." });
    }

    try {
        // --- ADDED: UNIQUE NAME CHECK ---
        // Ensure no other merchant exists with the exact same name under the SAME parent in this tenant
        const duplicateCheckQuery = parent_id
            ? "SELECT id FROM merchants WHERE name = $1 AND tenant_id = $2 AND parent_id = $3"
            : "SELECT id FROM merchants WHERE name = $1 AND tenant_id = $2 AND parent_id IS NULL";

        const queryParams = parent_id
            ? [name, finalTenantId, parent_id]
            : [name, finalTenantId];

        const duplicateRes = await pool.query(duplicateCheckQuery, queryParams);

        if (duplicateRes.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: parent_id
                    ? `A branch named '${name}' already exists inside this Region.`
                    : `A top-level Region named '${name}' already exists for this Tenant.`
            });
        }
        // --- END UNIQUE CHECK ---

        const newId = crypto.randomUUID();
        let path = `${newId}`;
        
        // Fetch Tenant Name to prepend to name_path
        const tenantRes = await pool.query("SELECT name FROM tenants WHERE id = $1", [finalTenantId]);
        const tenantName = tenantRes.rows.length > 0 ? tenantRes.rows[0].name : "Unknown Tenant";
        let name_path = `${tenantName}/${name}`;

        if (parent_id) {
            const parentRes = await pool.query("SELECT tenant_id, path, name_path FROM merchants WHERE id = $1", [parent_id]);
            if (parentRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: "Parent merchant not found" });
            }
            if (parentRes.rows[0].tenant_id !== finalTenantId) {
                return res.status(400).json({ success: false, message: "Parent merchant belongs to a different tenant" });
            }
            path = `${parentRes.rows[0].path}/${newId}`;
            name_path = parentRes.rows[0].name_path ? `${parentRes.rows[0].name_path}/${name}` : `${name}`;
        }

        // Check Operator scoping
        const merchantRole = req.user.roles?.find(r => r.scope === 'merchant');
        if (req.user.role === 'OPERATOR' || merchantRole) {
            if (!parent_id) {
                return res.status(403).json({ success: false, message: "Operators cannot create top-level merchants. Must provide a valid parent_id." });
            }
            if (!path.includes(merchantRole.scope_id)) {
                return res.status(403).json({ success: false, message: "You can only create stores under your own authorized merchant scope." });
            }
        }

        const result = await pool.query(
            `INSERT INTO merchants (id, name, tenant_id, parent_id, external_id, path, name_path) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING *`,
            [newId, name, finalTenantId, parent_id || null, external_id || null, path, name_path]
        );

        res.status(201).json({
            success: true,
            message: "Merchant created successfully",
            data: result.rows[0]
        });
    } catch (error) {
        console.error("CreateMerchant ERROR:", error);
        res.status(500).json({ message: "Server error", detail: error.message });
    }
};

// Get Merchant Hierarchy
exports.getMerchants = async (req, res) => {
    const userRole = req.user.role;
    const { tenant_id } = req.query;

    try {
        const finalTenantId = (userRole === "SUPER_ADMIN" && tenant_id)
            ? tenant_id
            : req.user.tenant_id;

        let query = `
            SELECT 
                m.*, 
                t.name as tenant_name,
                p.name as parent_name
            FROM merchants m 
            JOIN tenants t ON m.tenant_id = t.id
            LEFT JOIN merchants p ON m.parent_id = p.id
        `;
        const params = [];

        // Hierarchy Filtering Logic
        if (userRole === "SUPER_ADMIN") {
            if (finalTenantId) {
                params.push(finalTenantId);
                query += ` WHERE m.tenant_id = $${params.length}`;
            }
        } else {
            // All non-super-admins are locked to their own tenant
            params.push(finalTenantId);
            query += ` WHERE m.tenant_id = $${params.length}`;

            // Check if user has a merchant scope in their JWT
            const merchantRole = req.user.roles?.find(r => r.scope === 'merchant');
            if (merchantRole) {
                params.push(merchantRole.scope_id);
                // Safe query construction using a subquery to fetch the precise path of their scope_id
                query += ` AND m.path LIKE (SELECT path FROM merchants WHERE id = $${params.length}) || '%'`;
            }
        }

        query += " ORDER BY m.path ASC";

        const result = await pool.query(query, params);

        // Convert flat array to nested hierarchy tree
        const buildHierarchy = (merchants) => {
            const map = {};
            const roots = [];

            // First pass: map all merchants by their ID and initialize empty children array
            merchants.forEach(merchant => {
                map[merchant.id] = { ...merchant, children: [] };
            });

            // Second pass: assign each merchant to its parent's children array
            merchants.forEach(merchant => {
                if (merchant.parent_id && map[merchant.parent_id]) {
                    map[merchant.parent_id].children.push(map[merchant.id]);
                } else {
                    // This is a root node in the CURRENT SCOPE.
                    // We keep merchant.parent_name (fetched from DB) so the frontend knows who the real parent is,
                    // but we nullify the parent_id if the parent is "outside" this user's visible world.
                    if (merchant.parent_id && !map[merchant.parent_id]) {
                        map[merchant.id].parent_id = null;
                    }
                    roots.push(map[merchant.id]);
                }
            });

            return roots;
        };

        const hierarchyData = buildHierarchy(result.rows);

        // Identify the proper "Root Name" for the Parent Organization dropdown
        let rootName = null;
        const merchantRole = req.user.roles?.find(r => r.scope === 'merchant');
        
        if (merchantRole) {
            // For scoped users, the "Root" of their world is their assigned Merchant
            // We find it in the result set (it will be the one whose ID matches their scope_id)
            const rootMerchant = result.rows.find(m => m.id === merchantRole.scope_id);
            rootName = rootMerchant ? rootMerchant.name : "Your Branch";
        } else if (finalTenantId || req.user.tenant_id) {
            // For global admins, the Root is the Company (Tenant)
            const tRes = await pool.query("SELECT name FROM tenants WHERE id = $1", [finalTenantId || req.user.tenant_id]);
            rootName = tRes.rows[0]?.name || "Our Company";
        }

        let finalTree = hierarchyData;

        // If user is a Global Admin, we wrap the entire branch list in a "Company Name" root node
        // so they can explicitly see the Company in their tree/dropdown.
        if (!merchantRole) {
            finalTree = [
                {
                    id: null, // Global parent is the company
                    name: rootName,
                    is_organization_root: true,
                    children: hierarchyData
                }
            ];
        }

        res.json({ 
            success: true, 
            count: result.rows.length, 
            root_name: rootName, 
            data: finalTree 
        });
    } catch (error) {
        console.error("GetMerchants ERROR:", error);
        res.status(500).json({ message: "Server error", detail: error.message });
    }
};

// Update an existing Merchant (e.g. moving it to a new region or renaming)
exports.updateMerchant = async (req, res) => {
    const { id } = req.params;
    const { name, parent_id, external_id } = req.body;
    const finalTenantId = req.user.role === "SUPER_ADMIN" ? req.body.tenant_id || req.user.tenant_id : req.user.tenant_id;

    try {
        const currentRes = await pool.query("SELECT * FROM merchants WHERE id = $1", [id]);
        if (currentRes.rows.length === 0) return res.status(404).json({ success: false, message: "Merchant not found" });

        const currentMerchant = currentRes.rows[0];

        // Ensure cross-tenant modification doesn't happen
        if (currentMerchant.tenant_id !== finalTenantId && req.user.role !== "SUPER_ADMIN") {
            return res.status(403).json({ success: false, message: "Unauthorized tenant scope" });
        }

        // Scope check for regular MERCHANT_ADMIN
        const merchantRole = req.user.roles?.find(r => r.scope === 'merchant');
        if (merchantRole && !currentMerchant.path.includes(merchantRole.scope_id)) {
            return res.status(403).json({ success: false, message: "Unauthorized merchant scope" });
        }

        // Prevent circular loops (can't make a merchant a child of itself or its own children)
        if (parent_id) {
            if (parent_id === id) return res.status(400).json({ success: false, message: "Cannot set merchant as its own parent" });
            const parentRes = await pool.query("SELECT path, name_path FROM merchants WHERE id = $1", [parent_id]);
            if (parentRes.rows.length === 0) return res.status(404).json({ success: false, message: "Parent not found" });

            const newParentPath = parentRes.rows[0].path;
            const newParentNamePath = parentRes.rows[0].name_path || "";
            if (newParentPath.includes(id)) {
                return res.status(400).json({ success: false, message: "Circular hierarchy loop detected: Parent cannot be inside the current merchant's child tree." });
            }

            // Scope check on target parent
            if (merchantRole && !newParentPath.includes(merchantRole.scope_id)) {
                return res.status(403).json({ success: false, message: "Cannot move store outside of your authorized merchant scope." });
            }
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // Build new name_path if name or parent changed
            let calculatedNamePath = currentMerchant.name_path;
            let finalName = name || currentMerchant.name;

            if (parent_id !== undefined || name) {
                if (parent_id) {
                    const parentData = await client.query("SELECT name_path FROM merchants WHERE id = $1", [parent_id]);
                    calculatedNamePath = parentData.rows[0].name_path ? `${parentData.rows[0].name_path}/${finalName}` : finalName;
                } else if (parent_id === null) {
                    calculatedNamePath = finalName; // moved to root
                } else {
                    // name changed but parent didn't
                    const parts = currentMerchant.name_path ? currentMerchant.name_path.split('/') : [];
                    parts.pop();
                    parts.push(finalName);
                    calculatedNamePath = parts.join('/');
                }
            }

            // Apply straightforward updates (DB trigger automatically updates `path` for the moved merchant)
            const updateRes = await client.query(
                `UPDATE merchants 
                 SET name = COALESCE($1, name), 
                     parent_id = $2, 
                     external_id = COALESCE($3, external_id),
                     name_path = $4
                 WHERE id = $5 
                 RETURNING *`,
                [name || null, parent_id !== undefined ? parent_id : currentMerchant.parent_id, external_id || null, calculatedNamePath, id]
            );

            const updatedMerchant = updateRes.rows[0];

            // If the parent or name changed, we must recursively fix the paths of ALL child merchants beneath it
            if ((parent_id !== undefined && parent_id !== currentMerchant.parent_id) || name) {
                const oldPrefix = currentMerchant.path;
                const newPrefix = updatedMerchant.path;
                const oldNamePrefix = currentMerchant.name_path;
                const newNamePrefix = updatedMerchant.name_path;

                // Update UUID paths
                if (oldPrefix !== newPrefix) {
                    await client.query(
                        `UPDATE merchants 
                         SET path = REPLACE(path, $1, $2) 
                         WHERE path LIKE $3 AND id != $4`,
                        [oldPrefix, newPrefix, `${oldPrefix}/%`, id]
                    );
                }

                // Update Name paths
                if (oldNamePrefix !== newNamePrefix) {
                    await client.query(
                        `UPDATE merchants 
                         SET name_path = REGEXP_REPLACE(name_path, '^' || $1, $2) 
                         WHERE path LIKE $3 AND id != $4`,
                        [oldNamePrefix, newNamePrefix, `${newPrefix}/%`, id]
                    );
                }
            }

            await client.query("COMMIT");
            res.json({ success: true, message: "Merchant updated successfully", data: updatedMerchant });
        } catch (txnErr) {
            await client.query("ROLLBACK");
            throw txnErr;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error("UpdateMerchant ERROR:", error);
        res.status(500).json({ message: "Server error", detail: error.message });
    }
};

// Delete a Merchant (⚠️ This will cascade and delete all nested child locations)
exports.deleteMerchant = async (req, res) => {
    const { id } = req.params;
    const finalTenantId = req.user.role === "SUPER_ADMIN" ? req.body.tenant_id || req.user.tenant_id : req.user.tenant_id;

    try {
        const currentRes = await pool.query("SELECT * FROM merchants WHERE id = $1", [id]);
        if (currentRes.rows.length === 0) return res.status(404).json({ success: false, message: "Merchant not found" });

        const currentMerchant = currentRes.rows[0];

        // Ensure cross-tenant modification doesn't happen
        if (currentMerchant.tenant_id !== finalTenantId && req.user.role !== "SUPER_ADMIN") {
            return res.status(403).json({ success: false, message: "Unauthorized tenant scope" });
        }

        // Scope check for regular MERCHANT_ADMIN
        const merchantRole = req.user.roles?.find(r => r.scope === 'merchant');
        if (merchantRole && !currentMerchant.path.includes(merchantRole.scope_id)) {
            return res.status(403).json({ success: false, message: "Unauthorized merchant scope" });
        }

        // Prevent users from deleting their own administrative root node
        if (merchantRole && currentMerchant.id === merchantRole.scope_id) {
            return res.status(403).json({ success: false, message: "Access Denied: You cannot delete the root Merchant of your own administrative scope." });
        }

        // The PostgreSQL DB has "ON DELETE CASCADE", so deleting this will automatically delete all child stores!
        await pool.query("DELETE FROM merchants WHERE id = $1", [id]);

        res.json({ success: true, message: "Merchant and all child locations deleted successfully" });
    } catch (error) {
        console.error("DeleteMerchant ERROR:", error);
        res.status(500).json({ message: "Server error", detail: error.message });
    }
};
