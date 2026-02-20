const express = require("express");
const router = express.Router();
const { createMerchant, getMerchants } = require("./merchant.controller");
const { verifyToken } = require("../../middleware/auth.middleware");

// Create Merchant (Restricted to Tenant Admin)
router.post(
    "/",
    verifyToken,
    createMerchant
);

// Get All Merchants
router.get(
    "/",
    verifyToken,
    getMerchants
);

module.exports = router;
