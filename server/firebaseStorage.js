const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let bucketInstance = null;
let initialized = false;

function initFirebase() {
  if (initialized) return bucketInstance;
  initialized = true;

  try {
    let credential = null;
    let bucketName = process.env.FIREBASE_STORAGE_BUCKET || '';

    // 1. Check for serviceAccountKey.json in server/ or project root
    const keyPaths = [
      path.join(__dirname, 'serviceAccountKey.json'),
      path.join(__dirname, '..', 'serviceAccountKey.json')
    ];

    for (const kp of keyPaths) {
      if (fs.existsSync(kp)) {
        try {
          const keyData = JSON.parse(fs.readFileSync(kp, 'utf8'));
          credential = admin.credential.cert(keyData);
          if (!bucketName && keyData.project_id) {
            bucketName = `${keyData.project_id}.firebasestorage.app`;
          }
          console.log(`🔥 Firebase initialized using local file: ${path.basename(kp)}`);
          break;
        } catch (fileErr) {
          console.warn(`Could not parse ${kp}:`, fileErr.message);
        }
      }
    }

    // 2. Check for FIREBASE_SERVICE_ACCOUNT env var (JSON or Base64 JSON)
    if (!credential && process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        let rawStr = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
        if (!rawStr.startsWith('{')) {
          rawStr = Buffer.from(rawStr, 'base64').toString('utf8');
        }
        const parsed = JSON.parse(rawStr);
        credential = admin.credential.cert(parsed);
        if (!bucketName && parsed.project_id) {
          bucketName = `${parsed.project_id}.firebasestorage.app`;
        }
        console.log('🔥 Firebase initialized using FIREBASE_SERVICE_ACCOUNT environment variable');
      } catch (envErr) {
        console.warn('Could not parse FIREBASE_SERVICE_ACCOUNT:', envErr.message);
      }
    }

    // 3. Check for individual environment variables
    if (!credential && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      try {
        const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
        credential = admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey
        });
        if (!bucketName && process.env.FIREBASE_PROJECT_ID) {
          bucketName = `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
        }
        console.log('🔥 Firebase initialized using individual FIREBASE_* environment variables');
      } catch (indErr) {
        console.warn('Could not parse individual FIREBASE_* env variables:', indErr.message);
      }
    }

    if (!credential) {
      console.log('ℹ️ Firebase Storage is not configured yet (no credentials found).');
      return null;
    }

    // Ensure bucketName does not have gs:// prefix
    bucketName = bucketName.replace(/^gs:\/\//, '');

    if (!admin.apps.length) {
      admin.initializeApp({
        credential,
        storageBucket: bucketName
      });
    }

    bucketInstance = admin.storage().bucket(bucketName);
    console.log(`🔥 Firebase Storage connected to bucket: ${bucketName}`);
    return bucketInstance;
  } catch (err) {
    console.error('❌ Failed to initialize Firebase Admin:', err.message);
    return null;
  }
}

function isFirebaseReady() {
  const b = initFirebase();
  return b !== null;
}

/**
 * Upload a buffer to Firebase Storage and return a permanent public download URL
 */
async function uploadBufferToFirebase(buffer, destinationPath, contentType = 'application/octet-stream') {
  const bucket = initFirebase();
  if (!bucket) throw new Error('Firebase Storage is not initialized');

  // Clean path
  const safePath = destinationPath.replace(/^\/+/, '');
  const file = bucket.file(safePath);
  const downloadToken = crypto.randomUUID();

  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: {
        firebaseStorageDownloadTokens: downloadToken
      }
    },
    resumable: false
  });

  // Try makePublic for direct CDN access, or fallback to token-authenticated URL
  try {
    await file.makePublic();
  } catch (_) {
    // If bucket has Uniform Bucket-Level Access (UBLA), makePublic may fail, but token URL works 100%
  }

  const encodedPath = encodeURIComponent(safePath);
  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;

  return {
    success: true,
    url: publicUrl,
    path: safePath,
    downloadToken,
    bucket: bucket.name
  };
}

/**
 * Get read stream from Firebase Storage file
 */
async function getFirebaseStream(destinationPath) {
  const bucket = initFirebase();
  if (!bucket) return null;

  try {
    const safePath = destinationPath.replace(/^\/+/, '');
    const file = bucket.file(safePath);
    const [exists] = await file.exists();
    if (!exists) return null;

    const [metadata] = await file.getMetadata();
    return {
      stream: file.createReadStream(),
      length: metadata.size,
      contentType: metadata.contentType
    };
  } catch (err) {
    console.warn(`Firebase stream read failed for ${destinationPath}:`, err.message);
    return null;
  }
}

/**
 * Delete a file from Firebase Storage
 */
async function deleteFromFirebase(destinationPath) {
  const bucket = initFirebase();
  if (!bucket) return false;

  try {
    const safePath = destinationPath.replace(/^\/+/, '');
    const file = bucket.file(safePath);
    const [exists] = await file.exists();
    if (exists) {
      await file.delete();
      return true;
    }
    return false;
  } catch (err) {
    console.warn(`Firebase delete warning for ${destinationPath}:`, err.message);
    return false;
  }
}

module.exports = {
  initFirebase,
  isFirebaseReady,
  uploadBufferToFirebase,
  getFirebaseStream,
  deleteFromFirebase
};
