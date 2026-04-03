const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3Client = new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin",
        secretAccessKey: process.env.S3_SECRET_KEY || "minioadmin",
    },
    endpoint: process.env.S3_ENDPOINT || null, // For MinIO
    forcePathStyle: true, // Required for MinIO
});

const BUCKET_NAME = process.env.S3_BUCKET || "tms-logs";

/**
 * Generate a pre-signed URL for uploading a log chunk.
 * Path: tenants/{tenant_id}/devices/{device_id}/logs/{session_id}/chunk_{n}.log
 */
exports.generateUploadUrl = async (tenantId, deviceId, sessionId, chunkNumber) => {
    const key = `tenants/${tenantId}/devices/${deviceId}/logs/${sessionId}/chunk_${chunkNumber}.log`;
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: "text/plain",
    });

    // Short expiry: 1 hour
    return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
};

/**
 * Generate a pre-signed URL for downloading/viewing logs.
 * Since sessions have multiple chunks, we might need a way to list them or specify a chunk.
 * For now, let's allow downloading a specific key.
 */
exports.generateDownloadUrl = async (key) => {
    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
    });

    // Expiry: 15 minutes for viewing/download
    return await getSignedUrl(s3Client, command, { expiresIn: 900 });
};

exports.BUCKET_NAME = BUCKET_NAME;
