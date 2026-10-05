/**
 * Migrate remaining 18 Solution PDFs from Cloudinary to Backblaze B2.
 * Uses Cloudinary's multi-page image rendering API to reconstruct each PDF,
 * saves a local copy in backups/cloudinary_backup/solutions/,
 * and uploads to Backblaze B2 under solutions/<sol.id>.pdf.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const { PDFDocument } = require('pdf-lib');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { isB2Ready, uploadBufferToB2, getB2SignedUrl } = require('../b2Storage');
const DateFolder = require('../models/DateFolder');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function migrateSolutions() {
  console.log('========================================================');
  console.log('🚀 Migrating 18 Solution PDFs: Cloudinary Pages → Backblaze B2');
  console.log('========================================================\n');

  if (!isB2Ready()) {
    console.error('❌ Backblaze B2 is not configured.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB Atlas\n');

  const solBackupDir = path.join(__dirname, '..', '..', 'backups', 'cloudinary_backup', 'solutions');
  if (!fs.existsSync(solBackupDir)) fs.mkdirSync(solBackupDir, { recursive: true });

  const folders = await DateFolder.find({ 'solutions.b2Url': { $exists: false } });
  console.log(`📁 Found ${folders.length} folders with unmigrated solutions\n`);

  let success = 0;
  let errors = 0;

  for (const folder of folders) {
    let folderModified = false;

    for (const sol of (folder.solutions || [])) {
      if (!sol.b2Url) {
        process.stdout.write(`📄 [${folder.dateFolder}] "${sol.title || sol.id}" (publicId: ${sol.publicId || 'none'})... `);

        try {
          let pdfBuffer = null;

          // Strategy A: If publicId exists, reconstruct from Cloudinary page images
          if (sol.publicId) {
            try {
              const resData = await cloudinary.api.resource(sol.publicId, { pages: true });
              const numPages = resData.pages || 1;
              const pdfDoc = await PDFDocument.create();

              for (let p = 1; p <= numPages; p++) {
                const pageImgUrl = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/pg_${p}/${sol.publicId}.jpg`;
                const imgBuf = await fetchBuffer(pageImgUrl);
                const img = await pdfDoc.embedJpg(imgBuf);
                const page = pdfDoc.addPage([img.width, img.height]);
                page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
              }

              const pdfBytes = await pdfDoc.save();
              pdfBuffer = Buffer.from(pdfBytes);
            } catch (reconErr) {
              // Ignore and try strategy B
            }
          }

          // Strategy B: Check if local file exists in server/uploads/solutions/
          if (!pdfBuffer && sol.localPath) {
            const localFile = path.join(__dirname, '..', 'uploads', 'solutions', sol.localPath);
            if (fs.existsSync(localFile)) {
              pdfBuffer = fs.readFileSync(localFile);
            }
          }

          // Strategy C: Check backups/gridfs_backup/
          if (!pdfBuffer) {
            const gfsFile = path.join(__dirname, '..', '..', 'backups', 'gridfs_backup', `${sol.id}.pdf`);
            if (fs.existsSync(gfsFile)) {
              pdfBuffer = fs.readFileSync(gfsFile);
            }
          }

          if (!pdfBuffer) {
            throw new Error('Unable to reconstruct PDF from Cloudinary pages, local disk, or GridFS backup');
          }

          // Save local backup in backups/cloudinary_backup/solutions/
          const filename = `${sol.id || 'sol-' + Date.now()}.pdf`;
          const backupFilePath = path.join(solBackupDir, filename);
          fs.writeFileSync(backupFilePath, pdfBuffer);

          // Upload to Backblaze B2
          const b2Key = `solutions/${filename}`;
          await uploadBufferToB2(pdfBuffer, b2Key, 'application/pdf');

          // Generate 7-day signed URL
          const signedUrl = await getB2SignedUrl(b2Key, 604800);

          // Update MongoDB
          if (!sol.cloudinaryUrl) sol.cloudinaryUrl = sol.url;
          sol.b2Key = b2Key;
          sol.b2Url = signedUrl;
          sol.localPath = filename;

          folderModified = true;
          success++;
          console.log(`✅ Migrated to B2 (${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
        } catch (err) {
          errors++;
          console.log(`❌ ${err.message}`);
        }
      }
    }

    if (folderModified) {
      folder.markModified('solutions');
      await folder.save();
    }
  }

  console.log('\n========================================================');
  console.log('📊 SOLUTION MIGRATION SUMMARY');
  console.log(`   Successfully migrated: ${success}`);
  console.log(`   Errors:                ${errors}`);
  console.log('========================================================\n');

  await mongoose.disconnect();
}

migrateSolutions().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
