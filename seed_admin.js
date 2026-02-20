require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function seedAdmin() {
    try {
        const password = "admin";
        const hashedPassword = await bcrypt.hash(password, 10);

        // Check if user exists
        const res = await pool.query("SELECT * FROM users WHERE email = $1", ["superadmin@tms.com"]);

        if (res.rows.length > 0) {
            console.log("Super Admin already exists. Updating password...");
            await pool.query("UPDATE users SET password = $1, role = 'SUPER_ADMIN', status = 'ACTIVE' WHERE email = $2", [hashedPassword, "superadmin@tms.com"]);
        } else {
            console.log("Creating Super Admin...");
            await pool.query(
                `INSERT INTO users (name, email, password, role, status)
         VALUES ($1, $2, $3, 'SUPER_ADMIN', 'ACTIVE')`,
                ["System Admin", "superadmin@tms.com", hashedPassword]
            );
        }

        console.log("Super Admin seeded successfully!");
        console.log("Email: superadmin@tms.com");
        console.log("Password: admin");

        pool.end();
    } catch (err) {
        console.error("Error seeding admin:", err);
        pool.end();
    }
}

seedAdmin();
