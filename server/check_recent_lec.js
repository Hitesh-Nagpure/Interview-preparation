require('dotenv').config({ path: './server/.env' });
const mongoose = require('mongoose');

async function checkRecentLecturettes() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const folders = await db.collection('datefolders').find({ 'lecturettes.0': { $exists: true } }).toArray();
  const allLecs = [];
  for (const f of folders) {
    for (const l of (f.lecturettes || [])) {
      allLecs.push({
        folder: f.dateFolder,
        id: l.id,
        title: l.title,
        recordedAt: l.recordedAt,
        b2Key: l.b2Key,
        url: l.url
      });
    }
  }
  allLecs.sort((a, b) => new Date(b.recordedAt || 0) - new Date(a.recordedAt || 0));
  console.log('Total lecturettes across all folders:', allLecs.length);
  console.log('Most recent 5 lecturettes:');
  allLecs.slice(0, 5).forEach(l => console.log(l));
  await mongoose.disconnect();
}
checkRecentLecturettes().catch(console.error);
