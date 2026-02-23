const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

// Database connection
require("./config/db");

const authRoutes = require("./modules/auth/auth.routes");
const userRoutes = require("./modules/user/user.routes");
const tenantRoutes = require("./modules/tenant/tenant.routes");
const merchantRoutes = require("./modules/merchant/merchant.routes");
const deviceRoutes = require("./modules/device/device.routes");
const artifactRoutes = require("./modules/artifact/artifact.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Serve Static Uploads (For Flow 6: Mock MinIO)
const path = require("path");
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/merchants", merchantRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/artifacts", artifactRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Default test route
app.get("/", (req, res) => {
  res.send("TMS Backend Running");
});

module.exports = app;
