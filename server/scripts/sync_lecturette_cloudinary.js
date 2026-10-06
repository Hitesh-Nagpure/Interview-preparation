require('dotenv').config({ path: './server/.env' });
const mongoose = require('mongoose');
const DateFolder = require('../models/DateFolder');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const folders = await DateFolder.find({ 'lecturettes.0': { $exists: true } });
    let updatedCount = 0;

    for (const folder of folders) {
      let modified = false;
      for (const lec of (folder.lecturettes || [])) {
        if (!lec.cloudinaryUrl && lec.publicId && typeof lec.publicId === 'string' && lec.publicId.startsWith('ssb-psych-prep/')) {
          const cleanId = lec.publicId.replace(/\.(mp4|webm)$/i, '');
          lec.cloudinaryUrl = `https://res.cloudinary.com/bn8zsmom/video/upload/${cleanId}.mp4`;
          modified = true;
          updatedCount++;
          console.log(`Updated [${lec.title}]: ${lec.cloudinaryUrl}`);
        }
      }
      if (modified) {
        folder.markModified('lecturettes');
        await folder.save();
      }
    }

    console.log(`Migration complete: ${updatedCount} lecturettes updated with Cloudinary URLs.`);
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await mongoose.disconnect();
  }
})();
