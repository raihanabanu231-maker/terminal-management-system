# 🛡️ Super Admin API Reference Guide

This document provides the complete list of technical endpoints restricted to the **Super Admin** role. 

---

## 🔑 Authentication
Everything starts here. You need the `Bearer Token` to use any other API below.

### 1. Super Admin Login
*   **Endpoint:** `POST /api/v1/auth/login`
*   **Body:**
    ```json
    {
      "email": "superadmin@tms.com",
      "password": "admin123"
    }
    ```
*   **Response:** Copy the `token` value for use in `Authorization` headers.

---

## 🏗️ Tenant & Merchant Management

### 2. Create Tenant (Company)
*   **Endpoint:** `POST /api/v1/tenants/`
*   **Auth:** `Bearer <token>`
*   **Body:**
    ```json
    {
      "name": "Alpha Corp"
    }
    ```

### 3. Create Merchant (Store/Region)
*   **Endpoint:** `POST /api/v1/merchants/`
*   **Auth:** `Bearer <token>`
*   **Body:**
    ```json
    {
      "name": "Times Square Store",
      "parent_id": null,
      "tenant_id": "TENANT_UUID_HERE",
      "external_id": "EXT-101"
    }
    ```

---

## 📨 User Management

### 4. Invite New User
*   **Endpoint:** `POST /api/v1/users/invite`
*   **Auth:** `Bearer <token>`
*   **Body:**
    ```json
    {
      "first_name": "John",
      "last_name": "Doe",
      "email": "user@gmail.com",
      "role_name": "TENANT_ADMIN",
      "tenant_id": "OPTIONAL_UUID",
      "merchant_id": "OPTIONAL_UUID"
    }
    ```
    *Roles: `TENANT_ADMIN`, `MERCHANT_ADMIN`, `OPERATOR`*

### 5. View Pending Invites
*   **Endpoint:** `GET /api/v1/users/invites`
*   **Auth:** `Bearer <token>`

---

## 📟 Device Operations

### 6. Generate Enrollment Token (QR Code)
*   **Endpoint:** `POST /api/v1/devices/enroll-token`
*   **Auth:** `Bearer <token>`
*   **Body:**
    ```json
    {
      "serial": "SN-999-XYZ",
      "model": "POS-X200",
      "merchant_id": "MERCHANT_UUID_HERE"
    }
    ```

### 7. View All Devices
*   **Endpoint:** `GET /api/v1/devices/`
*   **Auth:** `Bearer <token>`

### 8. Send Remote Command
*   **Endpoint:** `POST /api/v1/devices/:deviceId/command`
*   **Auth:** `Bearer <token>`
*   **Body:**
    ```json
    {
      "type": "REBOOT",
      "payload": {}
    }
    ```

---

## 📦 Artifacts (Updates & APKs)

### 9. Upload Artifact
*   **Endpoint:** `POST /api/v1/artifacts/upload`
*   **Auth:** `Bearer <token>`
*   **Body:** (Form-Data)
    - `file`: (Select your update file)
    - `name`: "POS Update v1.1"
    - `version`: "1.1.0"
    - `type`: "app" (or "firmware")

### 10. Deploy Update to Devices
*   **Endpoint:** `POST /api/v1/artifacts/:id/deploy`
*   **Auth:** `Bearer <token>`
*   **Body:**
    ```json
    {
      "deviceIds": ["DEVICE_UUID_1", "DEVICE_UUID_2"]
    }
    ```

---

## 📊 Monitoring

### 11. View Quick Metrics
*   **Endpoint:** `GET /api/v1/dashboard/metrics`
*   **Auth:** `Bearer <token>`
