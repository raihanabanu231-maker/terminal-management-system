const pool = require("../../config/db");
const { logAudit } = require("../../utils/audit");
const { sendCommand } = require("../../gateway/socket.gateway");

// --- V7 HELPER: Normalization (Strict Formatting) ---
const normalizePath = (path) => {
    if (!path) return "/";
    let p = path.trim().toLowerCase();
    if (!p.startsWith("/")) p = "/" + p;
    if (!p.endsWith("/")) p = p + "/";
    return p;
};

// --- V7 HELPER: Get User Scope ---
const getUserScope = (req) => {
    const roles = req.user.roles || [];
    // Super Admin has root access
    if (req.user.role === "SUPER_ADMIN") return "/";
    
    // Find the broadest merchant scope or default to tenant root
    const merchantRoles = roles.filter(r => r.scope === "merchant");
    if (merchantRoles.length > 0) {
        // Typically one user has one main branch scope in this architecture
        return normalizePath(merchantRoles[0].scope_path);
    }
    return "/"; // Tenant Admin
};

// 1. Create Group (V7 Spec - MERCHANT ID MANDATORY)
exports.createGroup = async (req, res) => {
    const { name, description, merchant_id } = req.body;
    const { tenant_id, id: userId, role } = req.user;
    const userScope = getUserScope(req);

    if (!name || !merchant_id) {
        return res.status(400).json({ success: false, message: "Group name and merchant_id are required" });
    }

    try {
        // Fetch target merchant path for normalization & validation
        const merchRes = await pool.query("SELECT tenant_id, name_path FROM merchants WHERE id = $1", [merchant_id]);
        if (merchRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Merchant not found" });
        }

        if (merchRes.rows[0].tenant_id !== tenant_id && role !== "SUPER_ADMIN") {
            return res.status(403).json({ success: false, message: "Forbidden: Tenant mismatch" });
        }

        const targetMerchantPath = normalizePath(merchRes.rows[0].name_path);

        // 🛡️ SECURITY: Prefix-based validation
        if (!targetMerchantPath.startsWith(userScope)) {
            return res.status(403).json({ success: false, message: "Unauthorized: Branch outside of your scope" });
        }

        const result = await pool.query(
            `INSERT INTO device_groups (tenant_id, merchant_id, merchant_path, name, description)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [tenant_id, merchant_id, targetMerchantPath, name, description]
        );

        const newGroup = result.rows[0];
        await logAudit(tenant_id, userId, "GROUP_CREATED", "DEVICE_GROUP", newGroup.id, { name, merchant_path: targetMerchantPath });

        res.status(201).json({ success: true, data: newGroup });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(400).json({ success: false, message: "A group with this name already exists in this branch." });
        }
        console.error("CREATE_GROUP_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 2. List Groups
exports.getGroups = async (req, res) => {
    const { tenant_id } = req.user;
    const userScope = getUserScope(req);

    try {
        // Fetch groups where merchant_path starts with userScope
        const query = `
            SELECT dg.*, 
                   (SELECT COUNT(*) FROM device_group_members WHERE group_id = dg.id) as device_count,
                   t.name as tenant_name,
                   m.name as merchant_name
            FROM device_groups dg
            JOIN tenants t ON dg.tenant_id = t.id
            JOIN merchants m ON dg.merchant_id = m.id
            WHERE dg.tenant_id = $1 
            AND dg.merchant_path LIKE $2 || '%'
            AND dg.deleted_at IS NULL
            ORDER BY dg.created_at DESC
        `;
        
        const result = await pool.query(query, [tenant_id, userScope]);
        res.json({ success: true, total: result.rows.length, data: result.rows });

    } catch (error) {
        console.error("GET_GROUPS_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 3. View Details
exports.getGroupById = async (req, res) => {
    const { id } = req.params;
    const { tenant_id } = req.user;
    const userScope = getUserScope(req);

    try {
        const groupRes = await pool.query(
            `SELECT dg.*, t.name as tenant_name, m.name as merchant_name
             FROM device_groups dg
             JOIN tenants t ON dg.tenant_id = t.id
             JOIN merchants m ON dg.merchant_id = m.id
             WHERE dg.id = $1 AND dg.deleted_at IS NULL`,
            [id]
        );

        if (groupRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Group not found" });
        }

        const group = groupRes.rows[0];

        // 🛡️ SECURITY check
        if (group.tenant_id !== tenant_id) return res.status(403).json({ success: false, message: "Forbidden" });
        if (!group.merchant_path.startsWith(userScope)) return res.status(403).json({ success: false, message: "Unauthorized" });

        const membersRes = await pool.query(
            `SELECT d.id, d.serial, d.model, d.device_status, d.last_seen, d.merchant_path
             FROM device_group_members dgm
             JOIN devices d ON dgm.device_id = d.id
             WHERE dgm.group_id = $1`,
            [id]
        );

        res.json({
            success: true,
            data: {
                ...group,
                devices: membersRes.rows
            }
        });

    } catch (error) {
        console.error("GET_GROUP_BY_ID_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 4. Update Group
exports.updateGroup = async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    const { tenant_id, id: userId } = req.user;
    const userScope = getUserScope(req);

    try {
        const groupRes = await pool.query("SELECT tenant_id, merchant_path FROM device_groups WHERE id = $1 AND deleted_at IS NULL", [id]);
        if (groupRes.rows.length === 0) return res.status(404).json({ success: false, message: "Group not found" });

        const group = groupRes.rows[0];
        if (group.tenant_id !== tenant_id) return res.status(403).json({ success: false, message: "Forbidden" });
        if (!group.merchant_path.startsWith(userScope)) return res.status(403).json({ success: false, message: "Unauthorized" });

        const result = await pool.query(
            `UPDATE device_groups 
             SET name = COALESCE($1, name), 
                 description = COALESCE($2, description),
                 updated_at = NOW()
             WHERE id = $3
             RETURNING *`,
            [name, description, id]
        );

        await logAudit(tenant_id, userId, "GROUP_UPDATED", "DEVICE_GROUP", id, { name });

        res.json({ success: true, data: result.rows[0] });

    } catch (error) {
        console.error("UPDATE_GROUP_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 5. Add Member
exports.addMemberToGroup = async (req, res) => {
    const { id } = req.params;
    const { deviceId } = req.body;
    const { tenant_id } = req.user;
    const userScope = getUserScope(req);

    if (!deviceId) return res.status(400).json({ success: false, message: "deviceId required" });

    try {
        const groupRes = await pool.query("SELECT tenant_id, merchant_path FROM device_groups WHERE id = $1 AND deleted_at IS NULL", [id]);
        if (groupRes.rows.length === 0) return res.status(404).json({ success: false, message: "Group not found" });

        const group = groupRes.rows[0];
        if (group.tenant_id !== tenant_id) return res.status(403).json({ success: false, message: "Forbidden: Tenant mismatch" });
        if (!group.merchant_path.startsWith(userScope)) return res.status(403).json({ success: false, message: "Unauthorized" });

        // Fetch device and validate hierarchy
        const deviceRes = await pool.query("SELECT id, tenant_id, merchant_path FROM devices WHERE id = $1", [deviceId]);
        if (deviceRes.rows.length === 0) return res.status(404).json({ success: false, message: "Device not found" });

        const device = deviceRes.rows[0];
        const normalizedDevicePath = normalizePath(device.merchant_path);

        // 🛡️ VIOLATION 3.3: Hierarchy and Tenant Isolation
        if (device.tenant_id !== tenant_id) return res.status(403).json({ success: false, message: "Forbidden" });
        if (!normalizedDevicePath.startsWith(group.merchant_path)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid device scope: Device must belong to the same branch or a sub-branch of the group anchor." 
            });
        }

        // Insertion using ON CONFLICT to avoid duplicate error as per 3.3
        await pool.query(
            `INSERT INTO device_group_members (group_id, device_id) 
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [id, deviceId]
        );

        res.json({ success: true, message: "Device added to group successfully" });

    } catch (error) {
        console.error("ADD_MEMBER_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 6. Remove Member
exports.removeMemberFromGroup = async (req, res) => {
    const { id, deviceId } = req.params;
    const { tenant_id } = req.user;
    const userScope = getUserScope(req);

    try {
        const groupRes = await pool.query("SELECT tenant_id, merchant_path FROM device_groups WHERE id = $1 AND deleted_at IS NULL", [id]);
        if (groupRes.rows.length === 0) return res.status(404).json({ success: false, message: "Group not found" });

        const group = groupRes.rows[0];
        if (group.tenant_id !== tenant_id) return res.status(403).json({ success: false, message: "Forbidden" });
        if (!group.merchant_path.startsWith(userScope)) return res.status(403).json({ success: false, message: "Unauthorized" });

        await pool.query("DELETE FROM device_group_members WHERE group_id = $1 AND device_id = $2", [id, deviceId]);
        res.json({ success: true, message: "Member removed" });

    } catch (error) {
        console.error("REMOVE_MEMBER_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 7. Delete Group
exports.deleteGroup = async (req, res) => {
    const { id } = req.params;
    const { tenant_id, id: userId } = req.user;
    const userScope = getUserScope(req);

    try {
        const groupRes = await pool.query("SELECT tenant_id, merchant_path, name FROM device_groups WHERE id = $1 AND deleted_at IS NULL", [id]);
        if (groupRes.rows.length === 0) return res.status(404).json({ success: false, message: "Group not found" });

        const group = groupRes.rows[0];
        if (group.tenant_id !== tenant_id) return res.status(403).json({ success: false, message: "Forbidden" });
        if (!group.merchant_path.startsWith(userScope)) return res.status(403).json({ success: false, message: "Unauthorized" });

        await pool.query("UPDATE device_groups SET deleted_at = NOW() WHERE id = $1", [id]);
        await logAudit(tenant_id, userId, "GROUP_DELETED", "DEVICE_GROUP", id, { name: group.name });

        res.json({ success: true, message: "Group soft-deleted" });

    } catch (error) {
        console.error("DELETE_GROUP_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 8. Execute Group Commands (Batch Execution per V2 Goal)
exports.executeGroupCommand = async (req, res) => {
    const { id } = req.params;
    const { type, payload } = req.body;
    const { tenant_id, id: userId } = req.user;
    const userScope = getUserScope(req);

    try {
        const groupRes = await pool.query("SELECT * FROM device_groups WHERE id = $1 AND deleted_at IS NULL", [id]);
        if (groupRes.rows.length === 0) return res.status(404).json({ success: false, message: "Group not found" });

        const group = groupRes.rows[0];
        if (group.tenant_id !== tenant_id) return res.status(403).json({ success: false, message: "Forbidden" });
        if (!group.merchant_path.startsWith(userScope)) return res.status(403).json({ success: false, message: "Unauthorized" });

        // Fetch all devices
        const membersRes = await pool.query("SELECT device_id FROM device_group_members WHERE group_id = $1", [id]);
        const deviceIds = membersRes.rows.map(r => r.device_id);

        if (deviceIds.length === 0) return res.status(400).json({ success: false, message: "Group has no members" });

        const results = { total: deviceIds.length, sent: 0, queued: 0 };

        for (const deviceId of deviceIds) {
            const cmdRes = await pool.query(
                `INSERT INTO commands (device_id, type, payload, status, created_by, expires_at)
                 VALUES ($1, $2, $3, 'queued', $4, NOW() + INTERVAL '24 hours')
                 RETURNING id`,
                [deviceId, type, payload || {}, userId]
            );
            const commandId = cmdRes.rows[0].id;

            const success = sendCommand(deviceId, { type: "command", id: commandId, cmd: type, payload });
            if (success) {
                await pool.query("UPDATE commands SET status = 'sent', sent_at = NOW() WHERE id = $1", [commandId]);
                results.sent++;
            } else {
                results.queued++;
            }
        }

        await logAudit(tenant_id, userId, "GROUP_EXECUTION_SENT", "DEVICE_GROUP", id, { type, results });
        res.json({ success: true, message: `Command ${type} initiated for ${results.total} devices`, results });

    } catch (error) {
        console.error("EXECUTE_GROUP_CMD_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 9. Sync Members (Bulk Overwrite)
exports.syncGroupMembers = async (req, res) => {
    const { id } = req.params;
    const { deviceIds } = req.body; // Array of UUIDs
    const { tenant_id } = req.user;
    const userScope = getUserScope(req);

    if (!Array.isArray(deviceIds)) return res.status(400).json({ success: false, message: "deviceIds must be an array" });

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const groupRes = await client.query("SELECT tenant_id, merchant_path FROM device_groups WHERE id = $1 AND deleted_at IS NULL", [id]);
        if (groupRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Group not found" });
        }

        const group = groupRes.rows[0];
        if (group.tenant_id !== tenant_id) {
            await client.query("ROLLBACK");
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        if (!group.merchant_path.startsWith(userScope)) {
            await client.query("ROLLBACK");
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        // 1. Clear existing
        await client.query("DELETE FROM device_group_members WHERE group_id = $1", [id]);

        // 2. Validate and Insert new members
        for (const devId of deviceIds) {
            const devRes = await client.query("SELECT id, tenant_id, merchant_path FROM devices WHERE id = $1", [devId]);
            if (devRes.rows.length > 0) {
                const device = devRes.rows[0];
                const normalizedDevicePath = normalizePath(device.merchant_path);
                
                // Only add if it's in the same tenant and descendant of the group's branch
                if (device.tenant_id === tenant_id && normalizedDevicePath.startsWith(group.merchant_path)) {
                    await client.query(
                        "INSERT INTO device_group_members (group_id, device_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                        [id, devId]
                    );
                }
            }
        }

        await client.query("COMMIT");
        res.json({ success: true, message: "Group members synced successfully" });

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("SYNC_MEMBERS_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    } finally {
        client.release();
    }
};
