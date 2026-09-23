const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const https = require('https');
const { PDFDocument } = require('pdf-lib');
const multer = require('multer');
const DateFolder = require('./models/DateFolder');

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

const app = express();
const PORT = process.env.PORT || 5000;

// MongoDB Connection URI
const MONGO_URI =
  process.env.MONGODB_URI;

// ── Cloudinary setup (direct SDK — no multer-storage-cloudinary) ──────────────
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUD_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUD_API_SECRET = process.env.CLOUDINARY_API_SECRET;
let cloudinary = null;

if (CLOUD_NAME && CLOUD_API_KEY && CLOUD_API_SECRET) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: CLOUD_API_KEY,
    api_secret: CLOUD_API_SECRET
  });
  console.log('☁️  Cloudinary configured — uploads will use CDN');
}

// Helper: upload a buffer to Cloudinary, returns the secure_url
function uploadBufferToCloudinary(buffer, originalname, folder = 'ssb-psych-prep/tat', resourceType = 'auto') {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder,
      resource_type: resourceType,
      timeout: 120000
    };
    if (resourceType === 'video') {
      uploadOptions.eager_async = true;
    }
    const stream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

// ── Multer — always use memory storage; we decide where to put files after ────
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB per file (supports video/PDF)
});

// ── Local disk fallback (for development without Cloudinary) ──────────────────
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const solutionsDir = path.join(__dirname, '../uploads/solutions');
if (!fs.existsSync(solutionsDir)) {
  fs.mkdirSync(solutionsDir, { recursive: true });
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static uploaded files (local dev only)
app.use('/uploads', express.static(uploadsDir));

// ── MongoDB ───────────────────────────────────────────────────────────────────
let gfsBucket = null;
function getGfsBucket() {
  if (gfsBucket) return gfsBucket;
  if (mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db) {
    gfsBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: 'solutions'
    });
    return gfsBucket;
  }
  return null;
}

function writeBufferToGridFS(filename, buffer, metadata = {}) {
  return new Promise((resolve, reject) => {
    const bucket = getGfsBucket();
    if (!bucket) return reject(new Error('GridFS bucket not available'));
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: 'application/pdf',
      metadata
    });
    uploadStream.on('error', reject);
    uploadStream.on('finish', () => resolve(uploadStream.id));
    uploadStream.end(buffer);
  });
}

async function getGridFSStream(filenameOrId) {
  const bucket = getGfsBucket();
  if (!bucket) return null;
  try {
    const files = await bucket.find({ filename: filenameOrId }).toArray();
    if (files && files.length > 0) {
      return {
        stream: bucket.openDownloadStreamByName(filenameOrId),
        file: files[files.length - 1]
      };
    }
    if (mongoose.Types.ObjectId.isValid(filenameOrId)) {
      const id = new mongoose.Types.ObjectId(filenameOrId);
      const filesById = await bucket.find({ _id: id }).toArray();
      if (filesById && filesById.length > 0) {
        return {
          stream: bucket.openDownloadStream(id),
          file: filesById[0]
        };
      }
    }
  } catch (err) {
    console.warn('GridFS read check failed:', err.message);
  }
  return null;
}

async function deleteFromGridFS(filenameOrId) {
  const bucket = getGfsBucket();
  if (!bucket) return;
  try {
    const files = await bucket.find({ filename: filenameOrId }).toArray();
    for (const f of files) {
      await bucket.delete(f._id);
    }
    if (mongoose.Types.ObjectId.isValid(filenameOrId)) {
      await bucket.delete(new mongoose.Types.ObjectId(filenameOrId)).catch(() => {});
    }
  } catch (err) {
    console.warn('GridFS delete warning:', err.message);
  }
}

async function syncLocalSolutionsToGridFS() {
  try {
    const bucket = getGfsBucket();
    if (!bucket || !fs.existsSync(solutionsDir)) return;
    const localFiles = fs.readdirSync(solutionsDir).filter(f => f.endsWith('.pdf'));
    for (const file of localFiles) {
      const existing = await bucket.find({ filename: file }).limit(1).toArray();
      if (!existing || existing.length === 0) {
        const fullPath = path.join(solutionsDir, file);
        const buf = fs.readFileSync(fullPath);
        await writeBufferToGridFS(file, buf, { syncedFromDisk: true });
        console.log(`📦 Synced ${file} to MongoDB GridFS`);
      }
    }
  } catch (syncErr) {
    console.warn('Sync to GridFS warning:', syncErr.message);
  }
}

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB Atlas: ssb_psych_prep');
    getGfsBucket();
    syncLocalSolutionsToGridFS();
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
      console.log('Seeding initial practice batch...');
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
        tat: { title: 'SSB Standard TAT Set Alpha', pictures: samplePictures, hasBlankSlide: true, updatedAt: new Date() },
        wat: { title: 'SSB Standard 60 WAT Words Alpha', words: sampleWords, updatedAt: new Date() }
      });
      console.log('✅ Default SSB practice batch seeded!');
    }
  } catch (seedErr) {
    console.warn('Seed notice:', seedErr.message);
  }
}

// ─────────────────────── API ROUTES ──────────────────────────────────────────

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    dbConnected: mongoose.connection.readyState === 1,
    storageMode: cloudinary ? 'cloudinary' : 'disk',
    time: new Date().toISOString()
  });
});

// 2. Get all Date Folders
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
      },
      solutionsCount: f.solutions?.length || 0,
      solutions: (f.solutions || []).map(s => ({
        id: s.id,
        solutionDate: s.solutionDate,
        title: s.title,
        testType: s.testType,
        url: s.url,
        size: s.size,
        originalName: s.originalName,
        uploadedAt: s.uploadedAt
      })),
      lecturettesCount: f.lecturettes?.length || 0,
      lecturettes: (f.lecturettes || []).map(l => ({
        id: l.id,
        title: l.title,
        duration: l.duration,
        url: l.url,
        recordedDate: l.recordedDate || f.dateFolder,
        recordedAt: l.recordedAt
      }))
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get single Date Folder with full data
app.get('/api/folders/:dateFolder', async (req, res) => {
  try {
    const folder = await DateFolder.findOne({ dateFolder: req.params.dateFolder });
    if (!folder) return res.status(404).json({ error: `No folder found for date ${req.params.dateFolder}` });
    res.json(folder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Upload / Update TAT pictures — memory storage + Cloudinary SDK or disk
app.post('/api/folders/:dateFolder/tat',
  // Step 1: receive files into memory (catches multer errors as JSON)
  (req, res, next) => {
    memoryUpload.array('pictures', 50)(req, res, (err) => {
      if (err) return res.status(400).json({ error: `Upload error: ${err.message}` });
      next();
    });
  },
  // Step 2: persist files (Cloudinary or disk) then save to DB
  async (req, res) => {
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

      // Parse batch map
      let batchMap = [];
      try {
        if (req.body.pictureBatches) batchMap = JSON.parse(req.body.pictureBatches);
      } catch (e) { /* ignore */ }

      // Upload each file
      const newPics = [];
      if (req.files && req.files.length > 0) {
        for (let idx = 0; idx < req.files.length; idx++) {
          const file = req.files[idx];
          let url, fileId;

          if (cloudinary) {
            // Upload buffer directly to Cloudinary — official SDK, no signature issues
            const result = await uploadBufferToCloudinary(file.buffer, file.originalname);
            url = result.secure_url;
            fileId = result.public_id;
          } else {
            // Disk fallback for local development
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            const ext = path.extname(file.originalname) || '.jpg';
            const filename = 'tat-' + uniqueSuffix + ext;
            fs.writeFileSync(path.join(uploadsDir, filename), file.buffer);
            url = `/uploads/${filename}`;
            fileId = filename;
          }

          newPics.push({
            id: fileId,
            url,
            originalName: file.originalname,
            size: file.size,
            batch: batchMap[idx] || 'fresh',
            uploadedAt: new Date()
          });
        }
      }

      // Support external URL list in body
      if (req.body.directImages) {
        try {
          const directList = typeof req.body.directImages === 'string'
            ? JSON.parse(req.body.directImages) : req.body.directImages;
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
        } catch (e) { /* ignore */ }
      }

      if (!folder.tat) folder.tat = { pictures: [] };

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
  }
);

// 5. Upload / Update WAT words
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
      parsedWords = words.split(/[\r\n,]+/).map(w => w.trim()).filter(w => w.length > 0);
    }

    if (!folder.wat) folder.wat = { words: [] };

    if (append === true || append === 'true') {
      folder.wat.words = [...folder.wat.words, ...parsedWords];
    } else {
      folder.wat.words = parsedWords;
    }

    if (title) folder.wat.title = title;
    folder.wat.updatedAt = new Date();

    await folder.save();
    res.json({ success: true, message: `WAT set updated with ${folder.wat.words.length} words.`, folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Create or skip materials for Date Folder
app.post('/api/folders', async (req, res) => {
  try {
    const { dateFolder, folderTitle } = req.body;
    if (!dateFolder) return res.status(400).json({ error: 'dateFolder is required' });
    let folder = await DateFolder.findOne({ dateFolder });
    if (!folder) {
      folder = new DateFolder({
        dateFolder,
        folderTitle: folderTitle || `Batch ${dateFolder}`,
        tat: { pictures: [] },
        wat: { words: [] },
        solutions: [],
        lecturettes: []
      });
      await folder.save();
    } else if (folderTitle) {
      folder.folderTitle = folderTitle;
      await folder.save();
    }
    res.json({ success: true, message: `Date folder ${dateFolder} saved`, folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. DELETE entire Date Folder
app.delete('/api/folders/:dateFolder', async (req, res) => {
  try {
    const folder = await DateFolder.findOne({ dateFolder: req.params.dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Clean up files
    if (folder.tat && folder.tat.pictures) {
      for (const pic of folder.tat.pictures) {
        await deleteStoredFile(pic.url, pic.id, 'image');
      }
    }
    if (folder.solutions) {
      for (const sol of folder.solutions) {
        await deleteStoredFile(sol.url, sol.publicId, 'raw');
        if (sol.localPath) {
          const lp = path.join(solutionsDir, sol.localPath);
          if (fs.existsSync(lp)) fs.unlinkSync(lp);
          await deleteFromGridFS(sol.localPath);
        }
        await deleteFromGridFS(`${sol.id}.pdf`);
      }
    }
    if (folder.lecturettes) {
      for (const lec of folder.lecturettes) {
        await deleteStoredFile(lec.url, lec.publicId, 'video');
      }
    }

    await DateFolder.deleteOne({ dateFolder: req.params.dateFolder });
    res.json({ success: true, message: `Date folder ${req.params.dateFolder} deleted` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. DELETE only TAT batch
app.delete('/api/folders/:dateFolder/tat', async (req, res) => {
  try {
    const folder = await DateFolder.findOne({ dateFolder: req.params.dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    if (folder.tat && folder.tat.pictures) {
      for (const pic of folder.tat.pictures) {
        await deleteStoredFile(pic.url, pic.id, 'image');
      }
    }

    folder.tat = { title: 'TAT Set', pictures: [], hasBlankSlide: true };
    await folder.save();
    res.json({ success: true, message: 'TAT batch removed', folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. DELETE only WAT batch
app.delete('/api/folders/:dateFolder/wat', async (req, res) => {
  try {
    const folder = await DateFolder.findOne({ dateFolder: req.params.dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    folder.wat = { title: 'WAT Set', words: [] };
    await folder.save();
    res.json({ success: true, message: 'WAT batch removed', folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. DELETE single picture from TAT set
app.delete('/api/folders/:dateFolder/tat/:pictureId', async (req, res) => {
  try {
    const { dateFolder, pictureId } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder || !folder.tat || !folder.tat.pictures) {
      return res.status(404).json({ error: 'Folder or TAT set not found' });
    }

    const pic = folder.tat.pictures.find(p => p.id === pictureId || p._id?.toString() === pictureId);
    if (pic) await deleteStoredFile(pic.url, pic.id, 'image');

    folder.tat.pictures = folder.tat.pictures.filter(
      p => p.id !== pictureId && p._id?.toString() !== pictureId
    );
    await folder.save();
    res.json({ success: true, message: 'Picture deleted', folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Upload Solution PDF for a test
app.post('/api/folders/:dateFolder/solutions',
  (req, res, next) => {
    memoryUpload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: `Upload error: ${err.message}` });
      next();
    });
  },
  async (req, res) => {
    try {
      const { dateFolder } = req.params;
      const { solutionDate, testType, title } = req.body;
      if (!req.file) return res.status(400).json({ error: 'PDF file is required' });

      let folder = await DateFolder.findOne({ dateFolder });
      if (!folder) {
        folder = new DateFolder({
          dateFolder,
          folderTitle: `Batch ${dateFolder}`,
          tat: { pictures: [] },
          wat: { words: [] },
          solutions: [],
          lecturettes: []
        });
      }

      const solId = 'sol-' + Date.now();
      const sDate = solutionDate || dateFolder || new Date().toISOString().split('T')[0];
      const solTitle = title || sDate;

      // 1. Always save a local copy in uploads/solutions/
      const localFilename = `${solId}.pdf`;
      fs.writeFileSync(path.join(solutionsDir, localFilename), req.file.buffer);

      // 2. Save directly into MongoDB GridFS for 100% reliable persistence
      writeBufferToGridFS(localFilename, req.file.buffer, {
        solId,
        dateFolder,
        originalName: req.file.originalname,
        size: req.file.size
      }).catch(gfsErr => console.warn('GridFS save warning:', gfsErr.message));

      const fileProxyUrl = `/api/folders/${encodeURIComponent(dateFolder)}/solutions/${encodeURIComponent(solId)}/file`;

      const newSolution = {
        id: solId,
        solutionDate: sDate,
        title: solTitle,
        testType: testType || 'TAT',
        url: fileProxyUrl,
        cloudinaryUrl: null,
        localPath: localFilename,
        publicId: localFilename,
        originalName: req.file.originalname,
        size: req.file.size,
        uploadedAt: new Date()
      };

      if (!folder.solutions) folder.solutions = [];
      folder.solutions.unshift(newSolution);
      await folder.save();

      // Return response immediately to user — no waiting for slow Cloudinary upload!
      res.json({ success: true, message: 'Solution PDF uploaded', solution: newSolution, folder });

      // 3. Background Cloudinary upload if under 10MB (Cloudinary free tier limit)
      if (cloudinary && req.file.size <= 10485760) {
        const fileBuffer = req.file.buffer;
        const origName = req.file.originalname;
        setImmediate(async () => {
          try {
            const result = await uploadBufferToCloudinary(fileBuffer, origName, 'ssb-psych-prep/solutions', 'auto');
            const currentFolder = await DateFolder.findOne({ dateFolder });
            if (currentFolder && currentFolder.solutions) {
              const sol = currentFolder.solutions.find(s => s.id === solId);
              if (sol) {
                sol.publicId = result.public_id;
                sol.cloudinaryUrl = result.secure_url;
                await currentFolder.save();
                console.log(`☁️ Cloudinary upload completed in background for ${solId}`);
              }
            }
          } catch (cErr) {
            console.warn('Background Cloudinary upload warning:', cErr.message);
          }
        });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// 12. Stream or download solution PDF directly from server (avoids Cloudinary 401 ACL error!)
app.get('/api/folders/:dateFolder/solutions/:solutionId/file', async (req, res) => {
  try {
    const { dateFolder, solutionId } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder || !folder.solutions) return res.status(404).json({ error: 'Folder not found' });

    const solution = folder.solutions.find(s => s.id === solutionId || s._id?.toString() === solutionId);
    if (!solution) return res.status(404).json({ error: 'Solution not found' });

    const download = req.query.download === 'true';
    const filename = solution.originalName || `${solution.title || 'solution'}.pdf`;

    // 1. Check if local file exists by localPath
    if (solution.localPath) {
      const localFullPath = path.join(solutionsDir, solution.localPath);
      if (fs.existsSync(localFullPath)) {
        if (download) return res.download(localFullPath, filename);
        const stat = fs.statSync(localFullPath);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('ETag', `"${solution.id}-${stat.mtimeMs}"`);
        return fs.createReadStream(localFullPath).pipe(res);
      }
    }

    // 2. Check candidate local filenames
    const candidateFiles = [
      path.join(solutionsDir, `${solution.id}.pdf`),
      path.join(solutionsDir, `${solution.publicId ? solution.publicId.split('/').pop() : ''}.pdf`)
    ];
    for (const cPath of candidateFiles) {
      if (cPath && fs.existsSync(cPath)) {
        if (download) return res.download(cPath, filename);
        const stat = fs.statSync(cPath);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('ETag', `"${solution.id}-${stat.mtimeMs}"`);
        return fs.createReadStream(cPath).pipe(res);
      }
    }

    // 3. Check MongoDB GridFS
    const gfsCandidates = [
      solution.localPath,
      `${solution.id}.pdf`,
      solution.publicId ? solution.publicId.split('/').pop() + '.pdf' : '',
      solution.publicId,
      solution.id
    ].filter(Boolean);

    for (const gfsName of gfsCandidates) {
      const gfsItem = await getGridFSStream(gfsName);
      if (gfsItem) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', download ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`);
        if (gfsItem.file && gfsItem.file.length) {
          res.setHeader('Content-Length', gfsItem.file.length);
        }
        res.setHeader('Cache-Control', 'private, max-age=3600');

        // Also cache to local disk asynchronously for subsequent instant hits
        try {
          const cacheLocalPath = path.join(solutionsDir, solution.localPath || `${solution.id}.pdf`);
          const cacheWriter = fs.createWriteStream(cacheLocalPath);
          const gfsCacheStream = await getGridFSStream(gfsName);
          if (gfsCacheStream) gfsCacheStream.stream.pipe(cacheWriter);
        } catch (_) {}

        return gfsItem.stream.pipe(res);
      }
    }

    // 4. Fallback: If on Cloudinary, fetch page images and reconstruct PDF
    if (cloudinary && solution.publicId && !solution.publicId.endsWith('.pdf')) {
      try {
        const resData = await cloudinary.api.resource(solution.publicId, { pages: true });
        const numPages = resData.pages || 1;
        const pdfDoc = await PDFDocument.create();
        for (let p = 1; p <= numPages; p++) {
          const pageImgUrl = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/pg_${p}/${solution.publicId}.jpg`;
          const imgBuf = await fetchBuffer(pageImgUrl);
          const img = await pdfDoc.embedJpg(imgBuf);
          const page = pdfDoc.addPage([img.width, img.height]);
          page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
        }
        const pdfBytes = await pdfDoc.save();
        const savedPath = path.join(solutionsDir, `${solution.id}.pdf`);
        fs.writeFileSync(savedPath, pdfBytes);
        solution.localPath = `${solution.id}.pdf`;
        await folder.save();

        // Also save reconstructed PDF to GridFS so it never has to be reconstructed again!
        writeBufferToGridFS(`${solution.id}.pdf`, Buffer.from(pdfBytes)).catch(() => {});

        if (download) return res.download(savedPath, filename);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBytes.length);
        return res.end(Buffer.from(pdfBytes));
      } catch (reconErr) {
        console.error('PDF reconstruction error:', reconErr.message);
      }
    }

    return res.status(404).json({ error: 'PDF file not available' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12b. Get solution page images
app.get('/api/folders/:dateFolder/solutions/:solutionId/pages', async (req, res) => {
  try {
    const { dateFolder, solutionId } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder || !folder.solutions) return res.status(404).json({ error: 'Folder not found' });

    const solution = folder.solutions.find(s => s.id === solutionId || s._id?.toString() === solutionId);
    if (!solution) return res.status(404).json({ error: 'Solution not found' });

    if (cloudinary && solution.publicId) {
      const resData = await cloudinary.api.resource(solution.publicId, { pages: true });
      const numPages = resData.pages || 1;
      const pages = [];
      for (let p = 1; p <= numPages; p++) {
        pages.push(`https://res.cloudinary.com/${CLOUD_NAME}/image/upload/pg_${p}/${solution.publicId}.jpg`);
      }
      return res.json({ pages, count: numPages });
    }
    return res.json({ pages: [], count: 0 });
  } catch (err) {
    res.json({ pages: [], count: 0 });
  }
});

// 13. Update / replace solution PDF
app.put('/api/folders/:dateFolder/solutions/:solutionId',
  (req, res, next) => {
    memoryUpload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: `Upload error: ${err.message}` });
      next();
    });
  },
  async (req, res) => {
    try {
      const { dateFolder, solutionId } = req.params;
      const { solutionDate, testType, title } = req.body;

      const folder = await DateFolder.findOne({ dateFolder });
      if (!folder) return res.status(404).json({ error: 'Folder not found' });

      const solution = folder.solutions?.find(s => s.id === solutionId || s._id?.toString() === solutionId);
      if (!solution) return res.status(404).json({ error: 'Solution not found' });

      if (solutionDate) solution.solutionDate = solutionDate;
      if (title !== undefined) solution.title = title || solutionDate || solution.solutionDate;
      if (testType) solution.testType = testType;

      if (req.file) {
        // Delete old file
        await deleteStoredFile(solution.cloudinaryUrl || solution.url, solution.publicId, 'raw');
        if (solution.localPath) {
          const oldLocal = path.join(solutionsDir, solution.localPath);
          if (fs.existsSync(oldLocal)) fs.unlinkSync(oldLocal);
          await deleteFromGridFS(solution.localPath);
        }
        await deleteFromGridFS(`${solution.id}.pdf`);

        // Save new file locally and to GridFS
        const newLocalName = `${solution.id}.pdf`;
        fs.writeFileSync(path.join(solutionsDir, newLocalName), req.file.buffer);
        solution.localPath = newLocalName;

        writeBufferToGridFS(newLocalName, req.file.buffer, {
          solId: solution.id,
          dateFolder,
          originalName: req.file.originalname,
          size: req.file.size
        }).catch(gfsErr => console.warn('GridFS save warning:', gfsErr.message));

        solution.url = `/api/folders/${encodeURIComponent(dateFolder)}/solutions/${encodeURIComponent(solution.id)}/file`;
        solution.originalName = req.file.originalname;
        solution.size = req.file.size;
        solution.uploadedAt = new Date();

        // Background Cloudinary upload if under 10MB
        if (cloudinary && req.file.size <= 10485760) {
          const fileBuffer = req.file.buffer;
          const origName = req.file.originalname;
          setImmediate(async () => {
            try {
              const result = await uploadBufferToCloudinary(fileBuffer, origName, 'ssb-psych-prep/solutions', 'auto');
              const currentFolder = await DateFolder.findOne({ dateFolder });
              if (currentFolder && currentFolder.solutions) {
                const sol = currentFolder.solutions.find(s => s.id === solutionId || s._id?.toString() === solutionId);
                if (sol) {
                  sol.publicId = result.public_id;
                  sol.cloudinaryUrl = result.secure_url;
                  await currentFolder.save();
                  console.log(`☁️ Cloudinary update completed in background for ${solutionId}`);
                }
              }
            } catch (cErr) {
              console.warn('Cloudinary upload warning:', cErr.message);
            }
          });
        }
      }

      await folder.save();
      res.json({ success: true, message: 'Solution updated', solution, folder });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// 14. DELETE solution PDF
app.delete('/api/folders/:dateFolder/solutions/:solutionId', async (req, res) => {
  try {
    const { dateFolder, solutionId } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const solution = folder.solutions?.find(s => s.id === solutionId || s._id?.toString() === solutionId);
    if (solution) {
      await deleteStoredFile(solution.cloudinaryUrl || solution.url, solution.publicId, 'raw');
      if (solution.localPath) {
        const localPath = path.join(solutionsDir, solution.localPath);
        if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
        await deleteFromGridFS(solution.localPath);
      }
      await deleteFromGridFS(`${solution.id}.pdf`);
    }

    folder.solutions = (folder.solutions || []).filter(
      s => s.id !== solutionId && s._id?.toString() !== solutionId
    );
    await folder.save();
    res.json({ success: true, message: 'Solution deleted', folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. Upload live lecturette video
app.post('/api/folders/:dateFolder/lecturette',
  (req, res, next) => {
    memoryUpload.single('video')(req, res, (err) => {
      if (err) return res.status(400).json({ error: `Upload error: ${err.message}` });
      next();
    });
  },
  async (req, res) => {
    try {
      const { dateFolder } = req.params;
      const { title, duration } = req.body;
      if (!req.file) return res.status(400).json({ error: 'Video file is required' });

      let folder = await DateFolder.findOne({ dateFolder });
      if (!folder) {
        folder = new DateFolder({
          dateFolder,
          folderTitle: `Batch ${dateFolder}`,
          tat: { pictures: [] },
          wat: { words: [] },
          solutions: [],
          lecturettes: []
        });
      }

      let url, fileId;
      if (cloudinary) {
        const result = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname, 'ssb-psych-prep/lecturettes', 'video');
        url = result.secure_url;
        fileId = result.public_id;
      } else {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(req.file.originalname) || '.webm';
        const filename = 'lecturette-' + uniqueSuffix + ext;
        fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
        url = `/uploads/${filename}`;
        fileId = filename;
      }

      const newLecturette = {
        id: 'lec-' + Date.now(),
        title: title || `Lecturette ${dateFolder}`,
        recordedDate: req.body.recordedDate || dateFolder,
        duration: Number(duration) || 0,
        url,
        publicId: fileId,
        recordedAt: new Date()
      };

      if (!folder.lecturettes) folder.lecturettes = [];
      folder.lecturettes.unshift(newLecturette);
      await folder.save();

      res.json({ success: true, message: 'Lecturette video saved', lecturette: newLecturette, folder });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// 15. DELETE lecturette video
app.delete('/api/folders/:dateFolder/lecturette/:lecturetteId', async (req, res) => {
  try {
    const { dateFolder, lecturetteId } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const lecturette = folder.lecturettes?.find(l => l.id === lecturetteId || l._id?.toString() === lecturetteId);
    if (lecturette) {
      await deleteStoredFile(lecturette.url, lecturette.publicId, 'video');
    }

    folder.lecturettes = (folder.lecturettes || []).filter(
      l => l.id !== lecturetteId && l._id?.toString() !== lecturetteId
    );
    await folder.save();
    res.json({ success: true, message: 'Lecturette video deleted', folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. PATCH lecturette — edit title / date
app.patch('/api/folders/:dateFolder/lecturette/:lecturetteId', async (req, res) => {
  try {
    const { dateFolder, lecturetteId } = req.params;
    const { title, recordedDate } = req.body;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const lecIndex = (folder.lecturettes || []).findIndex(
      l => l.id === lecturetteId || l._id?.toString() === lecturetteId
    );
    if (lecIndex === -1) return res.status(404).json({ error: 'Lecturette not found' });

    const lec = folder.lecturettes[lecIndex];
    if (title !== undefined) lec.title = title;

    if (recordedDate && recordedDate !== dateFolder) {
      let targetFolder = await DateFolder.findOne({ dateFolder: recordedDate });
      if (!targetFolder) {
        targetFolder = new DateFolder({
          dateFolder: recordedDate,
          tat: { pictures: [] },
          wat: { words: [] },
          solutions: [],
          lecturettes: []
        });
      }
      lec.recordedDate = recordedDate;
      folder.lecturettes.splice(lecIndex, 1);
      folder.markModified('lecturettes');
      await folder.save();

      if (!targetFolder.lecturettes) targetFolder.lecturettes = [];
      targetFolder.lecturettes.unshift(lec);
      targetFolder.markModified('lecturettes');
      await targetFolder.save();

      return res.json({ success: true, lecturette: lec, movedTo: recordedDate });
    } else {
      if (recordedDate !== undefined) lec.recordedDate = recordedDate;
      folder.markModified('lecturettes');
      await folder.save();
      return res.json({ success: true, lecturette: lec });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: delete a file from Cloudinary or local disk ──────────────────────
async function deleteStoredFile(url, publicId, resourceType = 'image') {
  try {
    if (cloudinary && url && url.startsWith('http')) {
      if (publicId) {
        try {
          await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
        } catch (destroyErr) {
          if (resourceType === 'raw') {
            await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
          } else if (resourceType === 'image') {
            await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
          }
        }
      }
    } else if (url && url.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '..', url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.warn('Could not delete file:', e.message);
  }
}

// ── Serve React frontend in production ────────────────────────────────────────
const clientBuild = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  // SPA fallback — must be LAST, only for non-API routes
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

// ── Global JSON error handler — never returns HTML ────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 SSB Psych Prep API running on http://localhost:${PORT}`);
});
