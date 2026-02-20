# Terminal Management System (TMS) Flows

Below are the key end-to-end user and system flows for Terminal Management System (TMS), documented as step-by-step sequences with actors, systems, and critical validations.

These flows cover:
1. Super Admin → Tenant Onboarding
2. Tenant Admin → User Management
3. Device Onboarding & Lifecycle
4. Device ↔ TMS Connectivity (ATPL Store Client)
5. Remote Command Execution
6. App/Firmware Deployment

Each flow includes security checks, audit logging, and failure handling.

## 🔐 Flow 1: Super Admin Onboards a New Tenant
**Goal:** Create tenant + invite first admin

**Actors:** Super Admin (system-level user), Invitee (future Tenant Admin)

**Steps:**
1. **Super Admin logs into global console (/super)**
   - Clicks “Create Tenant” → enters name = "Alpha Payments"
   - System:
     - Creates tenants record
     - Auto-creates default roles: “Tenant Admin”, “Support Agent”

2. **Super Admin clicks “Invite Admin” → enters email = admin@alpha.com**
   - System:
     - Generates registration token (72h expiry)
     - Inserts user_invitations record:
       ```json
       { email: "admin@alpha.com", role: "Tenant Admin", scope: tenant }
       ```
     - Sends email: _“Complete registration: https://tms.com/register?token=...”_

3. **Invitee clicks link → lands on registration page**
   - Enters: First Name, Last Name, Mobile, Password
   - System:
     - Validates token (not expired/used)
     - Creates users record (invited = true, status = active)
     - Creates user_roles entry
     - Marks invitation as accepted
     - Logs audit_logs(action = "user.create")

✅ **Outcome:** Tenant exists; admin can log in.

## 👥 Flow 2: Tenant Admin Manages Users
**Goal:** Add team members with scoped roles

**Actors:** Tenant Admin, New User (e.g., Support Agent)

**Steps:**
1. **Tenant Admin logs in → goes to “Team” page**
   - Clicks “Invite User” → selects:
     - Role: “Support Agent”
     - Scope: Merchant = “Riyadh Region”
     - Email: support@alpha.com
   - System:
     - Validates merchant belongs to tenant
     - Creates user_invitations record (scoped to merchant)
     - Sends registration email

2. **New User completes registration (same as Flow 1)**

3. **On login, system:**
   - Fetches merchant subtree under “Riyadh Region”
   - Injects merchantScope = [m1, m2, m3] into auth context
   - All API calls automatically filter by merchantScope

✅ **Outcome:** User can only manage devices under assigned merchant subtree.

## 📲 Flow 3: Device Onboarding (Zero-Touch)
**Goal:** Register physical device under correct merchant

**Actors:** Operator (Tenant Admin or Support Agent), Android Device (ATPL Store Client)

**Steps:**
1. **Operator logs in → goes to “Devices” → clicks “Add Device”**
   - Selects:
     - Merchant: “Store #123”
     - Model: “PAX A920”
   - System:
     - Generates enrollment token (10m expiry)
     - Shows QR code (contains token + tenant context)

2. **Device (first boot):**
   - Opens ATPL Store Client → scans QR
   - Calls POST /enroll { token: "..." }

3. **Backend:**
   - Validates token → matches to pending device
   - Generates long-lived device token
   - Stores hash in devices.device_token_hash
   - Sets status = "active"
   - Logs audit_logs(action = "device.enroll")

4. **Device stores token in Android Keystore**

✅ **Outcome:** Device appears in portal under “Store #123”; ready for commands.

## 🌐 Flow 4: Device ↔ TMS Connectivity (ATPL Store Client)
**Goal:** Persistent, secure communication

**Actors:** Android Device (ATPL Store Client), TMS WebSocket Gateway

**Steps:**
1. **Device (on boot or reconnect):**
   - Reads token from Keystore
   - Connects to wss://tms.com/device-ws
   - Sends auth header: X-Device-Token: <token>

2. **WebSocket Gateway:**
   - Validates token against devices.device_token_hash
   - Checks token_revoked_at IS NULL
   - Associates connection with device_id

3. **Heartbeat:**
   - Device sends { "type": "heartbeat" } every 30s
   - Gateway updates devices.last_seen = NOW()

4. **Offline Detection:**
   - Background job marks device offline if last_seen < NOW() - 2m

✅ **Outcome:** Real-time status; immediate command delivery.

## ⚙️ Flow 5: Remote Command Execution
**Goal:** Reboot device or push config

**Actors:** Operator (Support Agent), Android Device

**Steps:**
1. **Operator selects device → clicks “Reboot”**
   - System:
     - Validates user has device.command.send permission
     - Checks tenant entitlement for command feature
     - Inserts commands record (status = "queued")

2. **Command Engine:**
   - Pushes command to device’s WebSocket session
   - Updates commands.status = "sent", sent_at = NOW()

3. **Device:**
   - Receives { "cmd": "reboot", "id": "cmd_123" }
   - Executes reboot → sends ACK: { "ack": "cmd_123", "status": "ok" }

4. **Gateway:**
   - Updates commands.status = "acknowledged", acked_at = NOW()
   - Logs incident_events if failure

✅ **Outcome:** Command tracked from queue → ACK; visible in UI.

## 📦 Flow 6: App/Firmware Deployment
**Goal:** Securely deploy software to devices

**Actors:** Tenant Admin, Devices

**Steps:**
1. **Admin uploads APK/bin file → system:**
   - Stores in MinIO (binary_path = "tenants/t1/apps/app123.apk")
   - Creates artifacts record (status = "draft")

2. **Approver (separate user) reviews → clicks “Approve”**
   - System sets status = "published", logs approval

3. **Admin selects devices/groups → clicks “Deploy”**
   - System:
     - Validates entitlement (apps feature enabled)
     - Generates pre-signed MinIO URL (1h expiry)
     - Sends command: { "cmd": "install_app", "url": "<https://minio/...>", "artifact_id": "..." }

4. **Device:**
   - Downloads from signed URL
   - Installs app → sends success event

5. **Audit:** Full trail in audit_logs + incident_events

✅ **Outcome:** Approved software deployed securely; no public URLs.

## 🛡️ Critical Cross-Cutting Concerns
| Flow | Security | Audit | Failure Handling |
| :--- | :--- | :--- | :--- |
| User Invite | Token expiry, email uniqueness | user.create | Expired token → new invite |
| Device Onboard | Token single-use, Keystore storage | device.enroll | Invalid token → error |
| Commands | RBAC + entitlement check | command.send | No ACK → retry 3x → alert |
| App Deploy | Signed URLs, approval workflow | artifact.publish | Download fail → incident |

## ✅ What’s Covered
- Full user lifecycle: invite → register → role assign → delete
- Device lifecycle: enroll → connect → command → decommission
- Security: tokens, RBAC, entitlements, audit
- Compliance: no PANs, GDPR-ready deletion
- Operational: heartbeat, offline detection, incident tracking
