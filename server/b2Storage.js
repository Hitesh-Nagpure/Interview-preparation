const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let s3Client = null;
let bucketName = null;
let initialized = false;

function initB2() {
  if (initialized) return s3Client;
  initialized = true;

  const endpoint = process.env.B2_ENDPOINT;
  const region   = process.env.B2_REGION || 'us-east-005';
  const keyId    = process.env.B2_KEY_ID;
  const appKey   = process.env.B2_APPLICATION_KEY;
  bucketName     = process.env.B2_BUCKET_NAME;

  if (!endpoint || !keyId || !appKey || !bucketName) {
    console.log('ℹ️  Backblaze B2 not configured (B2_* env vars missing).');
    return null;
  }

  s3Client = new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId: keyId,
      secretAccessKey: appKey
    },
    forcePathStyle: true  // required for Backblaze B2 S3-compatible API
  });

  console.log(`🗂️  Backblaze B2 connected — bucket: ${bucketName}`);
  return s3Client;
}

function isB2Ready() {
  const c = initB2();
  return c !== null;
}

/**
 * Build a permanent public URL for a B2 key.
 * Works when the bucket is set to "Public" in Backblaze settings.
 * Format: https://f005.backblazeb2.com/file/<bucketName>/<key>
 */
function getB2PublicUrl(key) {
  if (!bucketName) return null;
  const cleanKey = key.replace(/^\/+/, '');
  const region = process.env.B2_REGION || 'us-east-005';
  const regionPart = region.split('-').pop(); // e.g. "005" from "us-east-005"
  return `https://f${regionPart}.backblazeb2.com/file/${bucketName}/${cleanKey}`;
}

/**
 * Upload a Buffer to B2. Returns the object key and permanent public URL.
 * Bucket must be set to "Public" in Backblaze for publicUrl to work without auth.
 */
async function uploadBufferToB2(buffer, key, contentType = 'application/octet-stream') {
  const client = initB2();
  if (!client) throw new Error('Backblaze B2 is not initialized');

  const cleanKey = key.replace(/^\/+/, '');

  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: cleanKey,
    Body: buffer,
    ContentType: contentType
  }));

  const publicUrl = getB2PublicUrl(cleanKey);
  console.log(`🗂️  B2 upload complete: ${cleanKey}`);
  return { key: cleanKey, bucket: bucketName, publicUrl };
}

/**
 * Generate a pre-signed URL valid for 7 days (604800 seconds — B2 max).
 */
async function getB2SignedUrl(key, expiresInSeconds = 604800) {
  const client = initB2();
  if (!client) return null;

  const cleanKey = key.replace(/^\/+/, '');
  try {
    const cmd = new GetObjectCommand({ Bucket: bucketName, Key: cleanKey });
    return await getSignedUrl(client, cmd, { expiresIn: expiresInSeconds });
  } catch (err) {
    console.warn(`B2 sign URL failed for ${cleanKey}:`, err.message);
    return null;
  }
}

/**
 * Stream an object from B2 directly, piping its ReadableStream into an Express response.
 * Returns { stream, contentType, contentLength } or null if not found.
 */
async function getB2Stream(key) {
  const client = initB2();
  if (!client) return null;

  const cleanKey = key.replace(/^\/+/, '');
  try {
    const cmd = new GetObjectCommand({ Bucket: bucketName, Key: cleanKey });
    const response = await client.send(cmd);
    return {
      stream: response.Body,
      contentType: response.ContentType,
      contentLength: response.ContentLength
    };
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
    console.warn(`B2 stream failed for ${cleanKey}:`, err.message);
    return null;
  }
}

/**
 * Delete an object from B2.
 */
async function deleteFromB2(key) {
  const client = initB2();
  if (!client) return false;

  const cleanKey = key.replace(/^\/+/, '');
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: cleanKey }));
    return true;
  } catch (err) {
    console.warn(`B2 delete warning for ${cleanKey}:`, err.message);
    return false;
  }
}

/**
 * Check if a key exists in B2.
 */
async function b2ObjectExists(key) {
  const client = initB2();
  if (!client) return false;

  const cleanKey = key.replace(/^\/+/, '');
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: cleanKey }));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  initB2,
  isB2Ready,
  uploadBufferToB2,
  getB2SignedUrl,
  getB2PublicUrl,
  getB2Stream,
  deleteFromB2,
  b2ObjectExists,
  getBucketName: () => bucketName
};
