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
const deploymentRoutes = require("./modules/deployment/deployment.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");
const auditRoutes = require("./modules/audit/audit.routes");

const rateLimit = require("express-rate-limit");

const app = express();

// 🚀 Essential for Render's proxy to work with Rate Limiting
app.set("trust proxy", 1);

// Security & Performance Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
// Handle JSON parsing errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: "Malformed JSON: Please check your request body for syntax errors (e.g., missing commas or brackets).",
      detail: err.message
    });
  }
  next();
});
app.use(express.urlencoded({ extended: true }));

// 🛡️ Global Rate Limiter (Week 4)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: { message: "Too many requests, please try again later." }
});
app.use("/api/", limiter);

// Serve Static Uploads
const path = require("path");
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// 🚦 API Versioning (/api/v1)
const API_V1 = "/api/v1";

app.use(`${API_V1}/auth`, authRoutes);
app.use(`${API_V1}/users`, userRoutes);
app.use(`${API_V1}/tenants`, tenantRoutes);
app.use(`${API_V1}/merchants`, merchantRoutes);
app.use(`${API_V1}/devices`, deviceRoutes);
app.use(`${API_V1}/artifacts`, artifactRoutes);
app.use(`${API_V1}/deployments`, deploymentRoutes);
app.use(`${API_V1}/dashboard`, dashboardRoutes);
app.use(`${API_V1}/audit`, auditRoutes);

// Default test route
app.get("/", (req, res) => {
  res.send("TMS Backend Running");
});

module.exports = app;
