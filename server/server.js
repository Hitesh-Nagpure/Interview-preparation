const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const DateFolder = require('./models/DateFolder');

const app = express();
const PORT = process.env.PORT || 5000;

// MongoDB Connection URI
const MONGO_URI =
  process.env.MONGODB_URI ||
  'mongodb+srv://hiteshnagpure111_db_user:r0Cqddijcl4kR4Kg@cluster0.zovb7m3.mongodb.net/ssb_psych_prep?appName=Cluster0';

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage config for TAT images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'tat-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB per file
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static uploaded files
app.use('/uploads', express.static(uploadsDir));

// Connect to MongoDB Atlas
let isConnected = false;
mongoose
  .connect(MONGO_URI)
  .then(() => {
    isConnected = true;
    console.log('✅ Connected to MongoDB Atlas: ssb_psych_prep');
    seedInitialDataIfEmpty();
  })
  .catch((err) => {
    console.error('❌ MongoDB Connection Error:', err.message);
  });

// Seed sample TAT & WAT data if empty
async function seedInitialDataIfEmpty() {
  try {
    const count = await DateFolder.countDocuments();
    if (count === 0) {
      console.log('Seeding initial practice batch for demonstration...');
      const today = new Date().toISOString().split('T')[0];

      const sampleWords = [
        'LEADER', 'COURAGE', 'COUNTRY', 'DIFFICULTY', 'WAR',
        'DECISION', 'ATTACK', 'FRIEND', 'DUTY', 'SACRIFICE',
        'FEAR', 'INITIATIVE', 'VICTORY', 'SUCCESS', 'HONOUR',
        'TEAM', 'FAILURE', 'WEAPON', 'DISCIPLINE', 'ALERT',
        'PEACE', 'FAMILY', 'ENEMY', 'HARDWORK', 'PATIENCE',
        'RISK', 'CONFIDENCE', 'RESPONSIBILITY', 'SMILE', 'FUTURE',
        'CHALLENGE', 'ARMY', 'COMMAND', 'HELP', 'SYSTEM',
        'COOPERATION', 'ORGANIZATION', 'INTELLIGENCE', 'PLAN', 'CRISIS',
        'DANGER', 'RESOLVE', 'ACHIEVE', 'SOLVE', 'SOCIETY',
        'SOLDIER', 'NATION', 'BRAVERY', 'SPEED', 'JUSTICE',
        'STAMINA', 'WILL', 'STRENGTH', 'LOGIC', 'ENERGY',
        'SINCERE', 'TRUTH', 'TIME', 'TARGET', 'GOAL'
      ];

      // Sample TAT pictures using clean, high-contrast SVG placeholders representing SSB scenes
      const samplePictures = [
        {
          id: 'tat-seed-1',
          url: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=800&auto=format&fit=crop&q=80',
          originalName: 'Youth Planning Construction.jpg',
          size: 1024,
          uploadedAt: new Date()
        },
        {
          id: 'tat-seed-2',
          url: 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=800&auto=format&fit=crop&q=80',
          originalName: 'Community Relief Action.jpg',
          size: 1024,
          uploadedAt: new Date()
        },
        {
          id: 'tat-seed-3',
          url: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?w=800&auto=format&fit=crop&q=80',
          originalName: 'Discussion in Workshop.jpg',
          size: 1024,
          uploadedAt: new Date()
        },
        {
          id: 'tat-seed-4',
          url: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&auto=format&fit=crop&q=80',
          originalName: 'Students Strategy Meeting.jpg',
          size: 1024,
          uploadedAt: new Date()
        }
      ];

      await DateFolder.create({
        dateFolder: today,
        folderTitle: 'Official SSB Standard Practice Set',
        tat: {
          title: 'SSB Standard TAT Set Alpha',
          pictures: samplePictures,
          hasBlankSlide: true,
          updatedAt: new Date()
        },
        wat: {
          title: 'SSB Standard 60 WAT Words Alpha',
          words: sampleWords,
          updatedAt: new Date()
        }
      });
      console.log('✅ Default SSB practice batch seeded successfully!');
    }
  } catch (seedErr) {
    console.warn('Seed notice:', seedErr.message);
  }
}

// ---------------------- API ROUTES ---------------------- //

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    dbConnected: mongoose.connection.readyState === 1,
    time: new Date().toISOString()
  });
});

// 2. Get all Date Folders (with summary counts)
app.get('/api/folders', async (req, res) => {
  try {
    const folders = await DateFolder.find().sort({ dateFolder: -1 });
    const formatted = folders.map((f) => ({
      _id: f._id,
      dateFolder: f.dateFolder,
      folderTitle: f.folderTitle,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      tat: {
        title: f.tat?.title || 'TAT Set',
        count: f.tat?.pictures?.length || 0,
        rewriteCount: f.tat?.pictures?.filter(p => p.batch === 'rewrite').length || 0,
        freshCount: f.tat?.pictures?.filter(p => p.batch !== 'rewrite').length || 0,
        pictures: (f.tat?.pictures || []).slice(0, 8).map(p => ({
          id: p.id,
          url: p.url,
          batch: p.batch || 'fresh',
          originalName: p.originalName
        })),
        hasBlankSlide: f.tat?.hasBlankSlide ?? true,
        updatedAt: f.tat?.updatedAt
      },
      wat: {
        title: f.wat?.title || 'WAT Set',
        count: f.wat?.words?.length || 0,
        words: (f.wat?.words || []).slice(0, 15),
        updatedAt: f.wat?.updatedAt
      }
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get single Date Folder with full pictures & words
app.get('/api/folders/:dateFolder', async (req, res) => {
  try {
    const { dateFolder } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) {
      return res.status(404).json({ error: `No folder found for date ${dateFolder}` });
    }
    res.json(folder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Upload / Update TAT pictures in a Date Folder
app.post('/api/folders/:dateFolder/tat', upload.array('pictures', 50), async (req, res) => {
  try {
    const { dateFolder } = req.params;
    const { title, hasBlankSlide, append, folderTitle } = req.body;

    let folder = await DateFolder.findOne({ dateFolder });
    if (!folder) {
      folder = new DateFolder({
        dateFolder,
        folderTitle: folderTitle || `Batch ${dateFolder}`,
        tat: { pictures: [] },
        wat: { words: [] }
      });
    } else if (folderTitle) {
      folder.folderTitle = folderTitle;
    }

    // Process uploaded files
    const newPics = [];
    if (req.files && req.files.length > 0) {
      // pictureBatches is a JSON array mapping each file index to 'rewrite' or 'fresh'
      let batchMap = [];
      try {
        if (req.body.pictureBatches) {
          batchMap = JSON.parse(req.body.pictureBatches);
        }
      } catch (e) {
        console.warn('Could not parse pictureBatches:', e.message);
      }
      req.files.forEach((file, idx) => {
        newPics.push({
          id: file.filename,
          url: `/uploads/${file.filename}`,
          originalName: file.originalname,
          size: file.size,
          batch: batchMap[idx] || 'fresh',
          uploadedAt: new Date()
        });
      });
    }

    // Support Base64 or external URLs in body (if provided)
    if (req.body.directImages) {
      try {
        const directList = typeof req.body.directImages === 'string' 
          ? JSON.parse(req.body.directImages) 
          : req.body.directImages;
        if (Array.isArray(directList)) {
          directList.forEach((item, idx) => {
            newPics.push({
              id: 'direct-' + Date.now() + '-' + idx,
              url: item.url || item,
              originalName: item.name || `Picture ${idx + 1}`,
              size: item.size || 0,
              uploadedAt: new Date()
            });
          });
        }
      } catch (parseErr) {
        console.warn('Error parsing directImages:', parseErr.message);
      }
    }

    if (!folder.tat) {
      folder.tat = { pictures: [] };
    }

    if (append === 'true' || append === true) {
      folder.tat.pictures = [...folder.tat.pictures, ...newPics];
    } else {
      folder.tat.pictures = newPics.length > 0 ? newPics : folder.tat.pictures;
    }

    if (title) folder.tat.title = title;
    if (typeof hasBlankSlide !== 'undefined') {
      folder.tat.hasBlankSlide = hasBlankSlide === 'true' || hasBlankSlide === true;
    }
    folder.tat.updatedAt = new Date();

    await folder.save();
    res.json({
      success: true,
      message: `TAT set updated with ${folder.tat.pictures.length} pictures.`,
      folder
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Upload / Update WAT words in a Date Folder
app.post('/api/folders/:dateFolder/wat', async (req, res) => {
  try {
    const { dateFolder } = req.params;
    const { words, title, append, folderTitle } = req.body;

    let folder = await DateFolder.findOne({ dateFolder });
    if (!folder) {
      folder = new DateFolder({
        dateFolder,
        folderTitle: folderTitle || `Batch ${dateFolder}`,
        tat: { pictures: [] },
        wat: { words: [] }
      });
    } else if (folderTitle) {
      folder.folderTitle = folderTitle;
    }

    let parsedWords = [];
    if (Array.isArray(words)) {
      parsedWords = words;
    } else if (typeof words === 'string') {
      // Split by commas, newlines, or tabs and trim
      parsedWords = words
        .split(/[\r\n,]+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 0);
    }

    if (!folder.wat) {
      folder.wat = { words: [] };
    }

    if (append === true || append === 'true') {
      folder.wat.words = [...folder.wat.words, ...parsedWords];
    } else {
      folder.wat.words = parsedWords;
    }

    if (title) folder.wat.title = title;
    folder.wat.updatedAt = new Date();

    await folder.save();
    res.json({
      success: true,
      message: `WAT set updated with ${folder.wat.words.length} words.`,
      folder
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. DELETE entire Date Folder
app.delete('/api/folders/:dateFolder', async (req, res) => {
  try {
    const { dateFolder } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    // Clean up local uploaded files if any
    if (folder.tat && folder.tat.pictures) {
      folder.tat.pictures.forEach((pic) => {
        if (pic.url && pic.url.startsWith('/uploads/')) {
          const filePath = path.join(__dirname, '..', pic.url);
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
            } catch (e) {
              console.warn('File unlink error:', e.message);
            }
          }
        }
      });
    }

    await DateFolder.deleteOne({ dateFolder });
    res.json({ success: true, message: `Date folder ${dateFolder} deleted successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. DELETE only TAT batch from a Date Folder
app.delete('/api/folders/:dateFolder/tat', async (req, res) => {
  try {
    const { dateFolder } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    // Delete local files
    if (folder.tat && folder.tat.pictures) {
      folder.tat.pictures.forEach((pic) => {
        if (pic.url && pic.url.startsWith('/uploads/')) {
          const filePath = path.join(__dirname, '..', pic.url);
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
            } catch (e) {
              // ignore
            }
          }
        }
      });
    }

    folder.tat = { title: 'TAT Set', pictures: [], hasBlankSlide: true };
    await folder.save();
    res.json({ success: true, message: 'TAT batch removed from folder', folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. DELETE only WAT batch from a Date Folder
app.delete('/api/folders/:dateFolder/wat', async (req, res) => {
  try {
    const { dateFolder } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    folder.wat = { title: 'WAT Set', words: [] };
    await folder.save();
    res.json({ success: true, message: 'WAT batch removed from folder', folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. DELETE single picture from TAT set
app.delete('/api/folders/:dateFolder/tat/:pictureId', async (req, res) => {
  try {
    const { dateFolder, pictureId } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder || !folder.tat || !folder.tat.pictures) {
      return res.status(404).json({ error: 'Folder or TAT set not found' });
    }

    const pic = folder.tat.pictures.find((p) => p.id === pictureId || p._id.toString() === pictureId);
    if (pic && pic.url && pic.url.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '..', pic.url);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          // ignore
        }
      }
    }

    folder.tat.pictures = folder.tat.pictures.filter(
      (p) => p.id !== pictureId && p._id.toString() !== pictureId
    );
    await folder.save();
    res.json({ success: true, message: 'Picture deleted', folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend in production (if built)
const clientBuild = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 SSB Psych Prep API running on http://localhost:${PORT}`);
});
