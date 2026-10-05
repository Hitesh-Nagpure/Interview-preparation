/**
 * Migrate all locally-backed-up GridFS files to Backblaze B2.
 * Reads from backups/gridfs_backup/ (the 26 verified files downloaded from MongoDB GridFS).
 * Uploads each to B2, then links the new B2 URL into the matching MongoDB document.
 * GridFS is NOT deleted — it stays as a fallback.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { isB2Ready, uploadBufferToB2, getB2SignedUrl } = require('../b2Storage');
const DateFolder = require('../models/DateFolder');

async function migrate() {
  console.log('🚀 Starting Migration: GridFS Backup → Backblaze B2');

  if (!isB2Ready()) {
    console.error('❌ B2 is not configured. Check B2_* env vars in server/.env');
    process.exit(1);
  }

  console.log('📡 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const backupDir = path.join(__dirname, '..', '..', 'backups', 'gridfs_backup');
  const manifestPath = path.join(backupDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.error('❌ Backup manifest not found at:', manifestPath);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`📋 ${manifest.length} files found in verified local backup\n`);

  let successCount = 0;
  let errorCount = 0;
  let dbUpdates = 0;

  for (let i = 0; i < manifest.length; i++) {
    const item = manifest[i];
    const filePath = path.join(backupDir, item.filename);

    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  [${i+1}/${manifest.length}] MISSING locally: ${item.filename}`);
      errorCount++;
      continue;
    }

    const isPdf = item.filename.endsWith('.pdf');
    const contentType = isPdf ? 'application/pdf' : 'video/webm';
    const b2Folder = isPdf ? 'solutions' : 'lecturettes';
    const b2Key = `${b2Folder}/${item.filename}`;

    console.log(`[${i+1}/${manifest.length}] Uploading ${item.filename} (${(item.size/1024/1024).toFixed(2)} MB) → B2/${b2Key}`);

    try {
      const buffer = fs.readFileSync(filePath);
      await uploadBufferToB2(buffer, b2Key, contentType);

      // Generate a signed URL (7-day) to store in MongoDB
      const signedUrl = await getB2SignedUrl(b2Key, 604800);
      console.log(`   ✅ Uploaded. Signed URL generated.`);
      successCount++;

      // Link into MongoDB
      const folders = await DateFolder.find({
        $or: [
          { 'solutions.localPath': item.filename },
          { 'solutions.id': item.filename.replace('.pdf', '') },
          { [`solutions.id`]: item.metadata?.solId },
          { 'lecturettes.publicId': item.filename },
          { [`lecturettes.id`]: item.metadata?.lecId }
        ]
      });

      for (const folder of folders) {
        let updated = false;

        for (const sol of (folder.solutions || [])) {
          const matches =
            sol.localPath === item.filename ||
            `${sol.id}.pdf` === item.filename ||
            (item.metadata?.solId && item.metadata.solId === sol.id);
          if (matches) {
            sol.b2Key = b2Key;
            sol.b2Url = signedUrl;
            console.log(`   🔗 Linked solution "${sol.title || sol.id}" in folder ${folder.dateFolder}`);
            updated = true;
          }
        }

        for (const lec of (folder.lecturettes || [])) {
          const matches =
            lec.publicId === item.filename ||
            lec.url?.includes(item.filename) ||
            (item.metadata?.lecId && item.metadata.lecId === lec.id);
          if (matches) {
            lec.b2Key = b2Key;
            lec.b2Url = signedUrl;
            console.log(`   🔗 Linked lecturette "${lec.title || lec.id}" in folder ${folder.dateFolder}`);
            updated = true;
          }
        }

        if (updated) {
          folder.markModified('solutions');
          folder.markModified('lecturettes');
          await folder.save();
          dbUpdates++;
        }
      }
    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}`);
      errorCount++;
    }
  }

  console.log('\n============================================');
  console.log('📊 MIGRATION SUMMARY');
  console.log(`   Files uploaded:    ${successCount} / ${manifest.length}`);
  console.log(`   Errors:            ${errorCount}`);
  console.log(`   DB docs updated:   ${dbUpdates}`);
  console.log('============================================');
  console.log('✅ Done. GridFS data is still intact in MongoDB as backup.');
  console.log('   Deploy the updated server.js and your app will use B2 for all new PDFs/videos.');

  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
