require('dotenv').config({ path: './server/.env' });
const mongoose = require('mongoose');
async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const fLec = await db.collection('datefolders').findOne({ lecturettes: { $elemMatch: { b2Key: { $exists: true } } } });
  if (fLec && fLec.lecturettes) {
    const lec = fLec.lecturettes.find(l => l.b2Key);
    console.log('Lec sample:', { id: lec.id, url: lec.url, b2Key: lec.b2Key, b2Url: lec.b2Url });
  }
  const fTat = await db.collection('datefolders').findOne({ 'tat.pictures': { $elemMatch: { b2Key: { $exists: true } } } });
  if (fTat && fTat.tat && fTat.tat.pictures) {
    const pic = fTat.tat.pictures.find(p => p.b2Key);
    console.log('Tat sample:', { id: pic.id, url: pic.url, b2Key: pic.b2Key, b2Url: pic.b2Url });
  }
  await mongoose.disconnect();
}
check().catch(console.error);
