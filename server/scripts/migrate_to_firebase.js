const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { initFirebase, uploadBufferToFirebase } = require('../firebaseStorage');
const DateFolder = require('../models/DateFolder');

async function migrate() {
  console.log('🚀 Starting Safe Firebase Storage Migration...');

  // 1. Check Firebase
  const bucket = initFirebase();
  if (!bucket) {
    console.error('❌ Firebase is not initialized. Please ensure your Firebase credentials are in place:');
    console.error('   Place serviceAccountKey.json in the "server" directory or set FIREBASE_SERVICE_ACCOUNT in server/.env');
    process.exit(1);
  }

  // 2. Connect to MongoDB
  console.log('📡 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  // 3. Read backup manifest
  const backupDir = path.join(__dirname, '..', '..', 'backups', 'gridfs_backup');
  const manifestPath = path.join(backupDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.error('❌ Manifest not found at:', manifestPath);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`📋 Found ${manifest.length} files in local verified backup`);

  let successCount = 0;
  let errorCount = 0;
  let dbUpdatesCount = 0;

  for (let i = 0; i < manifest.length; i++) {
    const item = manifest[i];
    const filePath = path.join(backupDir, item.filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ File ${item.filename} not found in backup directory!`);
      errorCount++;
      continue;
    }

    const fileBuf = fs.readFileSync(filePath);
    const isPdf = item.filename.endsWith('.pdf');
    const isVideo = item.filename.endsWith('.webm') || item.filename.endsWith('.mp4');

    const destFolder = isPdf ? 'solutions' : 'lecturettes';
    const contentType = isPdf ? 'application/pdf' : (item.filename.endsWith('.mp4') ? 'video/mp4' : 'video/webm');
    const destPath = `${destFolder}/${item.filename}`;

    console.log(`[${i + 1}/${manifest.length}] Uploading ${item.filename} (${(item.size / 1024 / 1024).toFixed(2)} MB) to Firebase: ${destPath}...`);

    try {
      const uploadRes = await uploadBufferToFirebase(fileBuf, destPath, contentType);
      console.log(`   ✅ Uploaded: ${uploadRes.url}`);
      successCount++;

      // Now link this Firebase URL into the matching MongoDB document
      const folders = await DateFolder.find({
        $or: [
          { 'solutions.localPath': item.filename },
          { 'solutions.publicId': item.filename },
          { 'solutions.id': item.filename.replace('.pdf', '') },
          { 'lecturettes.publicId': item.filename },
          { 'lecturettes.id': item.metadata?.lecId || item.filename }
        ]
      });

      for (const folder of folders) {
        let updated = false;

        // Check solutions
        if (folder.solutions) {
          for (const sol of folder.solutions) {
            const matches =
              sol.localPath === item.filename ||
              sol.publicId === item.filename ||
              `${sol.id}.pdf` === item.filename ||
              (item.metadata && item.metadata.solId === sol.id);

            if (matches) {
              sol.firebaseUrl = uploadRes.url;
              console.log(`   🔗 Linked solution "${sol.title || sol.id}" to Firebase in folder ${folder.dateFolder}`);
              updated = true;
            }
          }
        }

        // Check lecturettes
        if (folder.lecturettes) {
          for (const lec of folder.lecturettes) {
            const matches =
              lec.publicId === item.filename ||
              lec.url.includes(item.filename) ||
              (item.metadata && item.metadata.lecId === lec.id);

            if (matches) {
              lec.firebaseUrl = uploadRes.url;
              console.log(`   🔗 Linked lecturette "${lec.title || lec.id}" to Firebase in folder ${folder.dateFolder}`);
              updated = true;
            }
          }
        }

        if (updated) {
          await folder.save();
          dbUpdatesCount++;
        }
      }
    } catch (upErr) {
      console.error(`   ❌ Failed to upload ${item.filename}:`, upErr.message);
      errorCount++;
    }
  }

  console.log('\n=======================================');
  console.log('🎉 MIGRATION SUMMARY:');
  console.log(`   Total Files:      ${manifest.length}`);
  console.log(`   Uploaded:         ${successCount}`);
  console.log(`   Errors:           ${errorCount}`);
  console.log(`   DB Updated:       ${dbUpdatesCount} folder documents`);
  console.log('=======================================');
  console.log('NOTE: GridFS collections have NOT been deleted.');
  console.log('Please test the application first. Once verified, run cleanup_gridfs.js to free up MongoDB space.');

  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Fatal error during migration:', err);
  process.exit(1);
});
