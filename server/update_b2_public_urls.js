require('dotenv').config({ path: './server/.env' });
const mongoose = require('mongoose');

const region = process.env.B2_REGION || 'us-east-005';
const regionPart = region.split('-').pop(); // "005" from "us-east-005"
const bucketName = process.env.B2_BUCKET_NAME;

function getPublicUrl(key) {
  const cleanKey = key.replace(/^\/+/, '');
  return `https://f${regionPart}.backblazeb2.com/file/${bucketName}/${cleanKey}`;
}

async function updateAllB2Urls() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const folders = await db.collection('datefolders').find({}).toArray();

  let updated = 0;

  for (const f of folders) {
    let changed = false;

    // TAT pictures
    for (const p of (f.tat?.pictures || [])) {
      if (p.b2Key && (!p.b2Url || p.b2Url.includes('X-Amz-Signature') || !p.b2Url.includes('backblazeb2.com'))) {
        p.b2Url = getPublicUrl(p.b2Key);
        changed = true;
      }
    }

    // Solutions
    for (const s of (f.solutions || [])) {
      if (s.b2Key && (!s.b2Url || s.b2Url.includes('X-Amz-Signature') || !s.b2Url.includes('backblazeb2.com'))) {
        s.b2Url = getPublicUrl(s.b2Key);
        changed = true;
      }
    }

    // Lecturettes
    for (const l of (f.lecturettes || [])) {
      if (l.b2Key && (!l.b2Url || l.b2Url.includes('X-Amz-Signature') || !l.b2Url.includes('backblazeb2.com'))) {
        l.b2Url = getPublicUrl(l.b2Key);
        changed = true;
      }
    }

    if (changed) {
      await db.collection('datefolders').replaceOne({ _id: f._id }, f);
      updated++;
      console.log(`Updated folder: ${f.dateFolder}`);
    }
  }

  console.log('');
  console.log('Folders updated: ' + updated);
  console.log('All b2Url values are now permanent public URLs (no expiry)');
  await mongoose.disconnect();
}

updateAllB2Urls().catch(console.error);
