const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function cleanup() {
  const isConfirmed = process.argv.includes('--confirm');

  console.log('🧹 MongoDB GridFS Cleanup Utility');
  console.log('====================================');

  const backupDir = path.join(__dirname, '..', '..', 'backups', 'gridfs_backup');
  const manifestPath = path.join(backupDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.error('❌ ABORTED: Local backup manifest was not found!');
    console.error('   You must have a verified local backup in backups/gridfs_backup before running cleanup.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`🔒 Verified local backup exists with ${manifest.length} files.`);

  if (!isConfirmed) {
    console.log('\n⚠️ SAFETY CHECK:');
    console.log('To prevent accidental deletion, run this script with the --confirm flag:');
    console.log('   node server/scripts/cleanup_gridfs.js --confirm\n');
    console.log('Only run this AFTER you have verified that your files open and stream properly from Firebase.');
    process.exit(0);
  }

  console.log('📡 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const statsBefore = await db.stats();
  console.log(`📊 Storage size before cleanup: ${(statsBefore.storageSize / 1024 / 1024).toFixed(2)} MB`);

  console.log('🗑️ Dropping solutions.chunks and solutions.files collections...');
  try {
    await db.collection('solutions.chunks').drop();
    console.log('   ✅ Dropped solutions.chunks');
  } catch (err) {
    console.log('   solutions.chunks already dropped or empty:', err.message);
  }

  try {
    await db.collection('solutions.files').drop();
    console.log('   ✅ Dropped solutions.files');
  } catch (err) {
    console.log('   solutions.files already dropped or empty:', err.message);
  }

  const statsAfter = await db.stats();
  console.log('====================================');
  console.log(`🎉 SUCCESS! Storage size after cleanup: ${(statsAfter.storageSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`📉 Reclaimed: ${((statsBefore.storageSize - statsAfter.storageSize) / 1024 / 1024).toFixed(2)} MB`);
  console.log('Your MongoDB database is now clean and down to minimal usage!');

  await mongoose.disconnect();
}

cleanup().catch(err => {
  console.error('Error during cleanup:', err);
  process.exit(1);
});
