const express = require("express");
const router = express.Router();
const deviceGroupController = require("./deviceGroup.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

// Middlewares
router.use(verifyToken);

// 🛡️ API Endpoints (V7 - ARCHITECT SPEC)

// POST /api/v1/groups (Create Group)
router.post(
    "/", 
    authorizeRoles("TENANT_ADMIN", "OPERATOR"), 
    deviceGroupController.createGroup
);

// GET /api/v1/groups (List All Groups)
router.get(
    "/", 
    authorizeRoles("TENANT_ADMIN", "OPERATOR", "VIEWER"), 
    deviceGroupController.getGroups
);

// GET /api/v1/groups/:id (View Details)
router.get(
    "/:id", 
    authorizeRoles("TENANT_ADMIN", "OPERATOR", "VIEWER"), 
    deviceGroupController.getGroupById
);

// PUT /api/v1/groups/:id (Update Group)
router.put(
    "/:id", 
    authorizeRoles("TENANT_ADMIN", "OPERATOR"), 
    deviceGroupController.updateGroup
);

// DELETE /api/v1/groups/:id (Delete Group)
router.delete(
    "/:id", 
    authorizeRoles("TENANT_ADMIN", "OPERATOR"), 
    deviceGroupController.deleteGroup
);

// POST /api/v1/groups/:id/members (Add Member)
router.post(
    "/:id/members", 
    authorizeRoles("TENANT_ADMIN", "OPERATOR"), 
    deviceGroupController.addMemberToGroup
);

// DELETE /api/v1/groups/:id/members/:deviceId (Remove Member)
router.delete(
    "/:id/members/:deviceId", 
    authorizeRoles("TENANT_ADMIN", "OPERATOR"), 
    deviceGroupController.removeMemberFromGroup
);

// POST /api/v1/groups/:id/sync (Bulk Sync Members)
router.post(
    "/:id/sync", 
    authorizeRoles("TENANT_ADMIN", "OPERATOR"), 
    deviceGroupController.syncGroupMembers
);

// POST /api/v1/groups/:id/execute (Execute Command - Batch)
router.post(
    "/:id/execute", 
    authorizeRoles("TENANT_ADMIN", "OPERATOR"), 
    deviceGroupController.executeGroupCommand
);

module.exports = router;
