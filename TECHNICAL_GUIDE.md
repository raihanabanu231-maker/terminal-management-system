# Technical Walkthrough: TMS Backend Flow 🚀

This document explains exactly how your code works, step-by-step, from the moment you start the server to a device being managed in the cloud.

---

## 1. The Foundation: Entry & Configuration
Everything starts at the root of your project.

### 🏁 Step 1: `server.js` & `app.js`
When you run `npm run dev`, it starts `server.js`.
-   **`server.js`**: Loads environment variables (`.env`) and starts the HTTP server.
-   **`app.js`**: This is the "Brain". It sets up **CORS** (so frontends can talk to it), **Helmet** (for security), and imports all the **Routes**.

### 🔌 Step 2: `src/config/db.js`
This file creates the "Connection Pool" to your Neon PostgreSQL database. 
-   It uses the `DATABASE_URL` from your `.env`.
-   It keeps a set of open connections ready so the API is fast.

---

## 2. The Identity Flow: Who are you?
We use a **Role-Based Access Control (RBAC)** system.

### 🔑 Step 3: Login (`auth.controller.js`)
When a user logs in (e.g., `superadmin@tms.com`):
1.  **Lookup**: The code finds the user in the `users` table.
2.  **Verification**: It compares the submitted password with the **hashed** password in the DB using `bcrypt`.
3.  **Token Generation**: If valid, it creates a **JWT (JSON Web Token)**. 
    *   This token contains the User's ID, Tenant ID, and their Roles.
    *   It's like a "Digital ID Card" the user carries for every future request.

### ✉️ Step 4: Invitation & Registration
Users don't just "Sign Up"; they are **Invited**.
1.  **Invite (`user.controller.js`)**: An admin sends an email. The code creates a random `token` and stores its **SHA256 hash** in `user_invitations`.
2.  **Registration (`auth.controller.js`)**: The user clicks the link. They submit the token + password.
    *   The code hashes the token again to find the match (Secure!).
    *   It creates the `user` and assigns them the **Role** from the invitation.

---

## 3. The Hierarchy Flow: Organizing the Business

### 🏢 Step 5: Tenants & Merchants
-   **Tenants**: Huge groups (e.g., "Bank of America" or "Alpha Payments").
-   **Merchants (`merchant.controller.js`)**: These are stores or regions.
    *   **The Magic**: When you create a Merchant, you don't calculate the "Path" in Node.js. 
    *   **The Database Trigger**: Inside your database, a hidden function (`trg_merchant_path`) automatically sees the `parent_id` and calculates:
        *   `level`: How deep it is (Store=2, Region=1).
        *   `path`: A string like `/ID1/ID2` so we can find all stores in a region instantly.

---

## 4. The Hardware Flow: Managing Terminals

### 📱 Step 6: Device Enrollment (`device.controller.js`)
1.  **QR Code**: An operator generates a token.
2.  **Scanning**: A physical terminal scans the QR.
3.  **Handoff**: The terminal sends its serial number + token to `/api/devices/enroll`.
4.  **Activation**: The code swaps the temporary token for a **permanent Device Token (JWT)**. The device is now `ACTIVE`.

### ⚡ Step 7: Commands & WebSockets
1.  **Request**: An admin clicks "Reboot" on the frontend.
2.  **Queue**: The API writes a new command into the `commands` table with status `queued`.
3.  **Push (`socket.gateway.js`)**: If the device is currently connected via WebSocket, the server immediately "shouts" the command to that device.
4.  **Update**: Once the device says "I got it!", the status in the DB changes to `sent`.

---

## 5. The Safety Net: Audit Logs (`audit.js`)
Almost every controller calls `logAudit()`. 
-   This writes a JSON record of **WHO** did **WHAT** to **WHOM**.
-   It's immutable (it can't be changed), which is vital for PCI compliance.

---

### 🗺️ Visual Map of Data
`Tenant` (Company) 
   ↳ `User` (People)
   ↳ `Merchant` (Stores/Groups)
         ↳ `Device` (Physical Terminals)
               ↳ `Command` (Remote Actions)
