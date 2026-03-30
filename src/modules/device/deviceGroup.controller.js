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
    if (req.user.role === "SUPER_ADMIN") return "/";
    
    const merchantRoles = roles.filter(r => r.scope === "merchant");
    if (merchantRoles.length > 0) {
        return normalizePath(merchantRoles[0].scope_path);
    }
    return "/"; // Tenant Admin Scope
};

// 1. Create Group (Hybrid: Merchant-based or Tenant-wide)
exports.createGroup = async (req, res) => {
    let { name, merchant_id } = req.body;
    const { tenant_id, id: userId, role } = req.user;
    const userScope = getUserScope(req);

    // 🎯 FIX: Smart Scoping (handle "null", empty, or tenant_id as a global mark)
    if (merchant_id === "null" || merchant_id === "" || merchant_id === tenant_id) {
        merchant_id = null;
    }

    if (!name) {
        return res.status(400).json({ success: false, message: "Group name is required" });
    }

    try {
        let targetMerchantPath = "/";
        let finalMerchantId = merchant_id;

        if (merchant_id) {
            const merchRes = await pool.query("SELECT tenant_id, name_path FROM merchants WHERE id = $1", [merchant_id]);
            if (merchRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: "Merchant not found. To create a Tenant-level group, use your Tenant ID." });
            }

            if (merchRes.rows[0].tenant_id !== tenant_id && role !== "SUPER_ADMIN") {
                return res.status(403).json({ success: false, message: "Forbidden: Tenant mismatch" });
            }

            targetMerchantPath = normalizePath(merchRes.rows[0].name_path);
        } else {
            // Support Tenant-wide groups: Default path to root "/" and ID to null
            if (userScope !== "/") {
                return res.status(403).json({ success: false, message: "Unauthorized: Only Tenant Admins can create Global/Tenant-wide groups." });
            }
            targetMerchantPath = "/";
            finalMerchantId = null;
        }

        if (!targetMerchantPath.startsWith(userScope)) {
            return res.status(403).json({ success: false, message: "Unauthorized: You don't have permission to create a group in this scope." });
        }

        const result = await pool.query(
            `INSERT INTO device_groups (tenant_id, merchant_id, merchant_path, name)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [tenant_id, finalMerchantId, targetMerchantPath, name]
        );

        const newGroup = result.rows[0];
        await logAudit(tenant_id, userId, "GROUP_CREATED", "DEVICE_GROUP", newGroup.id, { name, merchant_path: targetMerchantPath });

        res.status(201).json({ success: true, data: newGroup });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(400).json({ success: false, message: "A group with this name already exists in this branch/tenant." });
        }
        console.error("CREATE_GROUP_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 2. List Groups (Hybrid Results)
exports.getGroups = async (req, res) => {
    const { tenant_id } = req.user;
    const userScope = getUserScope(req);

    try {
        let query = `
            SELECT dg.*, 
                   (SELECT COUNT(*) FROM device_group_members WHERE group_id = dg.id) as device_count,
                   t.name as tenant_name,
                   COALESCE(m.name, 'Tenant-Wide') as merchant_name
            FROM device_groups dg
            JOIN tenants t ON dg.tenant_id = t.id
            LEFT JOIN merchants m ON dg.merchant_id = m.id
            WHERE dg.tenant_id = $1 
            AND dg.deleted_at IS NULL
        `;
        const params = [tenant_id];

        if (userScope !== "/") {
            params.push(userScope);
            query += ` AND dg.merchant_path LIKE $${params.length} || '%'`;
        }
        
        query += ` ORDER BY dg.created_at DESC`;
        
        const result = await pool.query(query, params);
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
            `SELECT dg.*, t.name as tenant_name, COALESCE(m.name, 'Tenant-Wide') as merchant_name
             FROM device_groups dg
             JOIN tenants t ON dg.tenant_id = t.id
             LEFT JOIN merchants m ON dg.merchant_id = m.id
             WHERE dg.id = $1 AND dg.deleted_at IS NULL`,
            [id]
        );

        if (groupRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Group not found" });
        }

        const group = groupRes.rows[0];

        if (group.tenant_id !== tenant_id) return res.status(403).json({ success: false, message: "Forbidden" });
        if (!normalizePath(group.merchant_path).startsWith(userScope)) {
            return res.status(403).json({ success: false, message: "Unauthorized access to global group scope." });
        }

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
    const { name } = req.body;
    const { tenant_id, id: userId } = req.user;
    const userScope = getUserScope(req);

    try {
        const groupRes = await pool.query("SELECT tenant_id, merchant_path FROM device_groups WHERE id = $1 AND deleted_at IS NULL", [id]);
        if (groupRes.rows.length === 0) return res.status(404).json({ success: false, message: "Group not found" });

        const group = groupRes.rows[0];
        if (group.tenant_id !== tenant_id) return res.status(403).json({ success: false, message: "Forbidden" });
        if (!normalizePath(group.merchant_path).startsWith(userScope)) return res.status(403).json({ success: false, message: "Unauthorized" });

        const result = await pool.query(
            `UPDATE device_groups 
             SET name = COALESCE($1, name), 
                 updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [name, id]
        );

        await logAudit(tenant_id, userId, "GROUP_UPDATED", "DEVICE_GROUP", id, { name });

        res.json({ success: true, data: result.rows[0] });

    } catch (error) {
        console.error("UPDATE_GROUP_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 5. Add Member (STRICT SECURITY FIX)
exports.addMemberToGroup = async (req, res) => {
    const { id } = req.params;
    const { deviceId } = req.body;
    const { tenant_id } = req.user;
    const userScope = getUserScope(req);

    if (!deviceId) return res.status(400).json({ success: false, message: "deviceId required" });

    try {
        const groupRes = await pool.query("SELECT tenant_id, merchant_id, merchant_path FROM device_groups WHERE id = $1 AND deleted_at IS NULL", [id]);
        if (groupRes.rows.length === 0) return res.status(404).json({ success: false, message: "Group not found" });

        const group = groupRes.rows[0];
        if (group.tenant_id !== tenant_id) return res.status(403).json({ success: false, message: "Forbidden" });
        if (!normalizePath(group.merchant_path).startsWith(userScope)) return res.status(403).json({ success: false, message: "Unauthorized" });

        const deviceRes = await pool.query("SELECT id, tenant_id, merchant_id, merchant_path FROM devices WHERE id = $1", [deviceId]);
        if (deviceRes.rows.length === 0) return res.status(404).json({ success: false, message: "Device not found" });

        const device = deviceRes.rows[0];
        
        const devicePath = normalizePath(device.merchant_path);
        const groupPath = normalizePath(group.merchant_path);

        // 🛡️ SECURITY FIX: The "Root Problem" Check
        // If a group belongs to a branch (merchant_id is NOT NULL), 
        // it MUST NOT accept a device that has NO branch (merchant_id IS NULL).
        if (group.merchant_id && !device.merchant_id) {
            return res.status(403).json({ 
                success: false, 
                message: "Security Violation: This group belongs to a Branch, but the Device is a Tenant-Wide (Root) device. Root devices can only be managed in Global Tenant Groups." 
            });
        }

        // 🛡️ SECURITY FIX: Prefix check (already in place but logging it)
        if (!devicePath.startsWith(groupPath)) {
             console.log(`🔒 SECURITY REJECT: DevicePath=[${devicePath}] GroupPath=[${groupPath}]`);
            return res.status(403).json({ 
                success: false, 
                message: "Security Violation: Device location mismatch. Only localized devices can be added to this branch group." 
            });
        }

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
        if (!normalizePath(group.merchant_path).startsWith(userScope)) return res.status(403).json({ success: false, message: "Unauthorized" });

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
        if (!normalizePath(group.merchant_path).startsWith(userScope)) return res.status(403).json({ success: false, message: "Unauthorized" });

        await pool.query("UPDATE device_groups SET deleted_at = NOW() WHERE id = $1", [id]);
        await logAudit(tenant_id, userId, "GROUP_DELETED", "DEVICE_GROUP", id, { name: group.name });

        res.json({ success: true, message: "Group soft-deleted" });

    } catch (error) {
        console.error("DELETE_GROUP_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 8. Execute Group Commands
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
        if (!normalizePath(group.merchant_path).startsWith(userScope)) return res.status(403).json({ success: false, message: "Unauthorized" });

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

// 9. Sync Members
exports.syncGroupMembers = async (req, res) => {
    const { id } = req.params;
    const { deviceIds } = req.body; 
    const { tenant_id } = req.user;
    const userScope = getUserScope(req);

    if (!Array.isArray(deviceIds)) return res.status(400).json({ success: false, message: "deviceIds must be an array" });

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const groupRes = await client.query("SELECT tenant_id, merchant_id, merchant_path FROM device_groups WHERE id = $1 AND deleted_at IS NULL", [id]);
        if (groupRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Group not found" });
        }

        const group = groupRes.rows[0];
        if (group.tenant_id !== tenant_id) {
            await client.query("ROLLBACK");
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        if (!normalizePath(group.merchant_path).startsWith(userScope)) {
            await client.query("ROLLBACK");
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        await client.query("DELETE FROM device_group_members WHERE group_id = $1", [id]);

        for (const devId of deviceIds) {
            const devRes = await client.query("SELECT id, tenant_id, merchant_id, merchant_path FROM devices WHERE id = $1", [devId]);
            if (devRes.rows.length > 0) {
                const device = devRes.rows[0];
                const devicePath = normalizePath(device.merchant_path);
                const groupPath = normalizePath(group.merchant_path);
                
                // 🔒 Security Check inside Sync
                const isTenantDeviceInBranchGroup = group.merchant_id && !device.merchant_id;

                if (device.tenant_id === tenant_id && !isTenantDeviceInBranchGroup && devicePath.startsWith(groupPath)) {
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
