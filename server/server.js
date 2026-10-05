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

// ── Firebase Storage setup ───────────────────────────────────────────────────
const {
  initFirebase,
  isFirebaseReady,
  uploadBufferToFirebase,
  getFirebaseStream,
  deleteFromFirebase
} = require('./firebaseStorage');

initFirebase();

// ── Backblaze B2 Storage setup (preferred over Firebase/GridFS) ───────────────
const {
  initB2,
  isB2Ready,
  uploadBufferToB2,
  getB2SignedUrl,
  getB2PublicUrl,
  getB2Stream,
  deleteFromB2,
  b2ObjectExists
} = require('./b2Storage');

initB2();

// Helper: pick best storage backend (B2 → Firebase → GridFS)
function bestStorageReady() {
  return isB2Ready() || isFirebaseReady();
}

// Helper: upload a buffer to Cloudinary, returns the secure_url
function uploadBufferToCloudinary(buffer, originalname, folder = 'ssb-psych-prep/tat', resourceType = 'auto') {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder,
      resource_type: resourceType,
      timeout: 120000,       // 2 min (was 1 min) — prevents timeout on slow connections
      quality: 'auto',       // Cloudinary auto-optimises quality on delivery (no extra encode time)
      fetch_format: 'auto',  // Serve best format per browser (webp/avif for images)
    };
    if (resourceType === 'video' || resourceType === 'auto') {
      // Chunk uploads: pipeline 10MB chunks for faster throughput on large videos
      uploadOptions.chunk_size = 10_000_000; // 10 MB per chunk
    }
    if (resourceType === 'video' && !folder.includes('reviews')) {
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
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB per file (supports video/PDF)
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

// ── Dedicated disk streaming storage for video uploads (prevents RAM buffering) ──
const videoDiskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, 'lecturette-' + uniqueSuffix + ext);
  }
});

const videoDiskUpload = multer({
  storage: videoDiskStorage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

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

async function syncLocalSolutionsToStorage() {
  // Sync local PDFs to B2 (preferred) → Firebase → GridFS
  if (isB2Ready()) {
    try {
      if (!fs.existsSync(solutionsDir)) return;
      const localFiles = fs.readdirSync(solutionsDir).filter(f => f.endsWith('.pdf'));
      for (const file of localFiles) {
        const exists = await b2ObjectExists(`solutions/${file}`);
        if (!exists) {
          const fullPath = path.join(solutionsDir, file);
          const buf = fs.readFileSync(fullPath);
          await uploadBufferToB2(buf, `solutions/${file}`, 'application/pdf');
          console.log(`🗂️  Synced ${file} to Backblaze B2`);
        }
      }
    } catch (b2SyncErr) {
      console.warn('Sync to B2 warning:', b2SyncErr.message);
    }
    return;
  }
  if (isFirebaseReady()) {
    try {
      if (!fs.existsSync(solutionsDir)) return;
      const localFiles = fs.readdirSync(solutionsDir).filter(f => f.endsWith('.pdf'));
      for (const file of localFiles) {
        const fullPath = path.join(solutionsDir, file);
        const buf = fs.readFileSync(fullPath);
        await uploadBufferToFirebase(buf, `solutions/${file}`, 'application/pdf');
        console.log(`🔥 Synced ${file} to Firebase Storage`);
      }
    } catch (fbSyncErr) {
      console.warn('Sync to Firebase warning:', fbSyncErr.message);
    }
    return;
  }

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
    syncLocalSolutionsToStorage();
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
        wat: { title: 'SSB Standard 60 WAT Words Alpha', words: sampleWords, updatedAt: new Date() },
        reviews: [],
        notes: { content: '', plainText: '', updatedAt: null }
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
    firebaseConfigured: isFirebaseReady(),
    b2Configured: isB2Ready(),
    time: new Date().toISOString()
  });
});

// 1b. Cloudinary Upload Signature (for direct, accelerated client-to-Cloudinary upload)
app.get('/api/cloudinary-signature', (req, res) => {
  try {
    if (!cloudinary || !CLOUD_NAME || !CLOUD_API_KEY || !CLOUD_API_SECRET) {
      return res.status(503).json({ success: false, message: 'Cloudinary not configured' });
    }
    const timestamp = Math.round(new Date().getTime() / 1000);
    const folder = req.query.folder || 'ssb-psych-prep/lecturettes';
    const paramsToSign = {
      folder,
      timestamp
    };
    const signature = cloudinary.utils.api_sign_request(paramsToSign, CLOUD_API_SECRET);
    res.json({
      success: true,
      signature,
      timestamp,
      apiKey: CLOUD_API_KEY,
      cloudName: CLOUD_NAME,
      folder
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
        id: l.id || l._id?.toString() || l._id,
        _id: l._id?.toString() || l.id,
        title: l.title,
        duration: l.duration,
        url: l.url,
        publicId: l.publicId,
        recordedDate: l.recordedDate || f.dateFolder,
        recordedAt: l.recordedAt
      })),
      reviewsCount: f.reviews?.length || 0,
      reviews: (f.reviews || []).map(r => ({
        id: r.id,
        title: r.title,
        duration: r.duration,
        url: r.url,
        publicId: r.publicId,
        reviewerName: r.reviewerName || '',
        recordedAt: r.recordedAt
      })),
      notes: {
        content: f.notes?.content || '',
        plainText: f.notes?.plainText || '',
        author: f.notes?.author || '',
        updatedAt: f.notes?.updatedAt || null
      },
      noteCardsCount: f.noteCards?.length || (f.notes?.content && f.notes.content.trim() && f.notes.content !== '<p><br></p>' ? 1 : 0),
      noteCards: (f.noteCards || []).map(nc => ({
        id: nc.id,
        title: nc.title || '',
        content: nc.content || '',
        plainText: nc.plainText || '',
        author: nc.author || '',
        createdAt: nc.createdAt,
        updatedAt: nc.updatedAt
      })),
      gpesCount: f.gpes?.length || 0,
      gpes: (f.gpes || []).map(g => ({
        id: g.id,
        title: g.title,
        mapUrl: g.mapUrl,
        scale: g.scale,
        description: g.description || '',
        narrativeImageUrl: g.narrativeImageUrl || '',
        narrativeOriginalName: g.narrativeOriginalName || '',
        modelSolution: g.modelSolution,
        solutionsCount: g.solutions?.length || 0,
        solutions: g.solutions || [],
        createdAt: g.createdAt,
        updatedAt: g.updatedAt
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

          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = path.extname(file.originalname) || '.jpg';
          const filename = 'tat-' + uniqueSuffix + ext;
          fs.writeFileSync(path.join(uploadsDir, filename), file.buffer);
          url = `/uploads/${filename}`;
          fileId = filename;
          let b2Key = null;

          if (isB2Ready()) {
            try {
              const b2Res = await uploadBufferToB2(file.buffer, `tat/${filename}`, file.mimetype || 'image/jpeg');
              b2Key = b2Res.key;
            } catch (b2Err) {
              console.warn('B2 TAT upload warning:', b2Err.message);
            }
          }

          newPics.push({
            id: fileId,
            url,
            b2Key,
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

// 6b. GET notes & note cards for Date Folder
app.get('/api/folders/:dateFolder/notes', async (req, res) => {
  try {
    const folder = await DateFolder.findOne({ dateFolder: req.params.dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Auto-migrate legacy note to noteCards if noteCards is empty
    let noteCards = folder.noteCards || [];
    if (noteCards.length === 0 && folder.notes?.content && folder.notes.content.trim() && folder.notes.content !== '<p><br></p>') {
      const legacyCard = {
        id: 'note-legacy-' + (folder.notes.updatedAt ? new Date(folder.notes.updatedAt).getTime() : Date.now()),
        title: 'Initial Practice Note',
        content: folder.notes.content,
        plainText: folder.notes.plainText || '',
        author: folder.notes.author || '',
        createdAt: folder.notes.updatedAt || new Date(),
        updatedAt: folder.notes.updatedAt || new Date()
      };
      folder.noteCards = [legacyCard];
      await folder.save();
      noteCards = folder.noteCards;
    }

    res.json({
      notes: folder.notes || { content: '', plainText: '', author: '', updatedAt: null },
      noteCards: noteCards.map(nc => ({
        id: nc.id,
        title: nc.title || '',
        content: nc.content,
        plainText: nc.plainText || '',
        author: nc.author || '',
        createdAt: nc.createdAt,
        updatedAt: nc.updatedAt
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6c. POST / Create a new Note Card
app.post('/api/folders/:dateFolder/notes', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { dateFolder } = req.params;
    const { title = '', content = '', plainText = '', author = '' } = req.body;
    const trimmedAuthor = (author || '').trim();
    if (!trimmedAuthor) {
      return res.status(400).json({ error: 'Reviewer name is compulsory' });
    }
    if (!content || (!plainText.trim() && content === '<p><br></p>')) {
      return res.status(400).json({ error: 'Note content cannot be empty' });
    }

    let folder = await DateFolder.findOne({ dateFolder });
    if (!folder) {
      folder = new DateFolder({
        dateFolder,
        tat: { pictures: [] },
        wat: { words: [] },
        solutions: [],
        lecturettes: [],
        reviews: [],
        noteCards: []
      });
    }

    if (!folder.noteCards) folder.noteCards = [];

    const newNoteCard = {
      id: 'note-' + Date.now() + '-' + Math.round(Math.random() * 1e4),
      title: (title || '').trim(),
      content,
      plainText: plainText || '',
      author: trimmedAuthor,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    folder.noteCards.unshift(newNoteCard);

    // Keep folder.notes updated with latest for backward compatibility
    folder.notes = {
      content,
      plainText,
      author: trimmedAuthor,
      updatedAt: new Date()
    };

    await folder.save();
    res.json({
      success: true,
      message: 'Note card saved successfully',
      noteCard: newNoteCard,
      noteCards: folder.noteCards,
      notes: folder.notes,
      dateFolder
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6c-2. PUT / Update an existing Note Card by noteId
app.put('/api/folders/:dateFolder/notes/:noteId', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { dateFolder, noteId } = req.params;
    const { title, content, plainText, author } = req.body;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    if (!folder.noteCards) folder.noteCards = [];
    const cardIndex = folder.noteCards.findIndex(c => c.id === noteId || c._id?.toString() === noteId);

    if (cardIndex === -1) {
      return res.status(404).json({ error: 'Note card not found' });
    }

    const card = folder.noteCards[cardIndex];
    if (title !== undefined) card.title = title.trim();
    if (content !== undefined) card.content = content;
    if (plainText !== undefined) card.plainText = plainText;
    if (author) card.author = author.trim();
    card.updatedAt = new Date();

    folder.markModified('noteCards');

    // Also update legacy folder.notes if this is the first/newest card
    if (cardIndex === 0) {
      folder.notes = {
        content: card.content,
        plainText: card.plainText,
        author: card.author,
        updatedAt: card.updatedAt
      };
    }

    await folder.save();
    res.json({
      success: true,
      message: 'Note card updated successfully',
      noteCard: card,
      noteCards: folder.noteCards,
      notes: folder.notes,
      dateFolder
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6c-3. DELETE a Note Card by noteId
app.delete('/api/folders/:dateFolder/notes/:noteId', async (req, res) => {
  try {
    const { dateFolder, noteId } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    if (!folder.noteCards) folder.noteCards = [];
    folder.noteCards = folder.noteCards.filter(c => c.id !== noteId && c._id?.toString() !== noteId);

    // Update folder.notes with latest remaining card or empty
    if (folder.noteCards.length > 0) {
      const latest = folder.noteCards[0];
      folder.notes = {
        content: latest.content,
        plainText: latest.plainText,
        author: latest.author,
        updatedAt: latest.updatedAt
      };
    } else {
      folder.notes = {
        content: '',
        plainText: '',
        author: '',
        updatedAt: null
      };
    }

    await folder.save();
    res.json({
      success: true,
      message: 'Note card deleted successfully',
      noteCards: folder.noteCards,
      notes: folder.notes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6c-4. Legacy SAVE / UPDATE notes endpoint (backward compatibility)
app.put('/api/folders/:dateFolder/notes', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { dateFolder } = req.params;
    const { title = '', content = '', plainText = '', author = '', id, noteId } = req.body;
    const trimmedAuthor = (author || '').trim();
    if (!trimmedAuthor) {
      return res.status(400).json({ error: 'Reviewer name is compulsory' });
    }
    let folder = await DateFolder.findOne({ dateFolder });
    if (!folder) {
      folder = new DateFolder({ dateFolder });
    }
    if (!folder.noteCards) folder.noteCards = [];

    const targetId = id || noteId;
    let targetCard = null;
    if (targetId) {
      targetCard = folder.noteCards.find(c => c.id === targetId || c._id?.toString() === targetId);
    }

    if (targetCard) {
      if (title !== undefined) targetCard.title = title.trim();
      targetCard.content = content;
      targetCard.plainText = plainText;
      targetCard.author = trimmedAuthor;
      targetCard.updatedAt = new Date();
      folder.markModified('noteCards');
    } else {
      targetCard = {
        id: 'note-' + Date.now() + '-' + Math.round(Math.random() * 1e4),
        title: (title || '').trim(),
        content,
        plainText,
        author: trimmedAuthor,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      folder.noteCards.unshift(targetCard);
    }

    folder.notes = {
      content,
      plainText,
      author: trimmedAuthor,
      updatedAt: new Date()
    };
    await folder.save();
    res.json({
      success: true,
      message: 'Notes saved successfully',
      notes: folder.notes,
      noteCard: targetCard,
      noteCards: folder.noteCards,
      dateFolder
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6d. POST / Upload Audio Review
app.post('/api/folders/:dateFolder/reviews', memoryUpload.single('audio'), async (req, res) => {
  try {
    const { dateFolder } = req.params;
    const { title = 'Audio Review', duration = 0, reviewerName = '' } = req.body;
    const trimmedReviewer = (reviewerName || '').trim();

    if (!trimmedReviewer) {
      return res.status(400).json({ error: 'Reviewer name is compulsory' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Audio recording file is required' });
    }

    let url, fileId;
    if (cloudinary) {
      const origName = req.file.originalname || `review-${Date.now()}.webm`;
      const result = await uploadBufferToCloudinary(req.file.buffer, origName, 'ssb-psych-prep/reviews', 'video');
      url = result.secure_url;
      fileId = result.public_id;
    } else {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(req.file.originalname) || '.webm';
      const filename = 'review-' + uniqueSuffix + ext;
      fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
      url = `/uploads/${filename}`;
      fileId = filename;
    }

    const newReview = {
      id: 'rev-' + Date.now(),
      title: title || `Audio Review ${dateFolder}`,
      duration: Number(duration) || 0,
      url,
      publicId: fileId,
      reviewerName: trimmedReviewer,
      recordedAt: new Date()
    };

    let folder = await DateFolder.findOne({ dateFolder });
    if (!folder) {
      folder = new DateFolder({
        dateFolder,
        tat: { pictures: [] },
        wat: { words: [] },
        solutions: [],
        lecturettes: [],
        reviews: [newReview],
        notes: { content: '', plainText: '', author: '', updatedAt: null }
      });
    } else {
      if (!folder.reviews) folder.reviews = [];
      folder.reviews.unshift(newReview);
    }
    await folder.save();

    res.json({ success: true, message: 'Audio review saved successfully', review: newReview, folder });
  } catch (err) {
    console.error('Audio review upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6e. DELETE Audio Review
app.delete('/api/folders/:dateFolder/reviews/:reviewId', async (req, res) => {
  try {
    const { dateFolder, reviewId } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const review = folder.reviews?.find(r => r.id === reviewId || r._id?.toString() === reviewId);
    if (review) {
      await deleteStoredFile(review.url, review.publicId, 'video');
      folder.reviews = folder.reviews.filter(r => r.id !== reviewId && r._id?.toString() !== reviewId);
      await folder.save();
    }
    res.json({ success: true, message: 'Audio review deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6f. GET reviews and notes for a specific folder
app.get('/api/folders/:dateFolder/reviews', async (req, res) => {
  try {
    const { dateFolder } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    let noteCards = folder.noteCards || [];
    if (noteCards.length === 0 && folder.notes?.content && folder.notes.content.trim() && folder.notes.content !== '<p><br></p>') {
      const legacyCard = {
        id: 'note-legacy-' + (folder.notes.updatedAt ? new Date(folder.notes.updatedAt).getTime() : Date.now()),
        title: 'Initial Practice Note',
        content: folder.notes.content,
        plainText: folder.notes.plainText || '',
        author: folder.notes.author || '',
        createdAt: folder.notes.updatedAt || new Date(),
        updatedAt: folder.notes.updatedAt || new Date()
      };
      folder.noteCards = [legacyCard];
      await folder.save();
      noteCards = folder.noteCards;
    }

    res.json({
      reviews: (folder.reviews || []).map(r => ({
        id: r.id,
        title: r.title,
        duration: r.duration,
        url: r.url,
        publicId: r.publicId,
        reviewerName: r.reviewerName || '',
        recordedAt: r.recordedAt
      })),
      notes: folder.notes || { content: '', plainText: '', author: '', updatedAt: null },
      noteCards: noteCards.map(nc => ({
        id: nc.id,
        title: nc.title || '',
        content: nc.content,
        plainText: nc.plainText || '',
        author: nc.author || '',
        createdAt: nc.createdAt,
        updatedAt: nc.updatedAt
      }))
    });
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
        deleteFromFirebase(`solutions/${sol.localPath || sol.id + '.pdf'}`).catch(() => {});
        if (sol.b2Key) deleteFromB2(sol.b2Key).catch(() => {});
        else deleteFromB2(`solutions/${sol.localPath || sol.id + '.pdf'}`).catch(() => {});
      }
    }
    if (folder.lecturettes) {
      for (const lec of folder.lecturettes) {
        await deleteStoredFile(lec.url, lec.publicId, 'video');
        deleteFromFirebase(`lecturettes/${lec.publicId || path.basename(lec.url)}`).catch(() => {});
        if (lec.b2Key) deleteFromB2(lec.b2Key).catch(() => {});
        else deleteFromB2(`lecturettes/${lec.publicId || path.basename(lec.url)}`).catch(() => {});
      }
    }
    if (folder.reviews) {
      for (const rev of folder.reviews) {
        await deleteStoredFile(rev.url, rev.publicId, 'video');
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

      let firebaseUrl = null;
      let b2Key = null;
      let b2Url = null;

      if (isB2Ready()) {
        try {
          const b2Res = await uploadBufferToB2(req.file.buffer, `solutions/${localFilename}`, 'application/pdf');
          b2Key = b2Res.key;
          b2Url = getB2PublicUrl(b2Key);
          console.log(`🗂️  Solution PDF uploaded to B2: ${b2Key}`);
        } catch (b2Err) {
          console.warn('B2 upload warning (solutions):', b2Err.message);
        }
      } else if (isFirebaseReady()) {
        try {
          const fbRes = await uploadBufferToFirebase(req.file.buffer, `solutions/${localFilename}`, 'application/pdf');
          firebaseUrl = fbRes.url;
          console.log(`🔥 Solution PDF uploaded to Firebase: ${firebaseUrl}`);
        } catch (fbErr) {
          console.warn('Firebase upload warning:', fbErr.message);
        }
      } else {
        // Fallback to MongoDB GridFS only if no cloud storage is configured
        writeBufferToGridFS(localFilename, req.file.buffer, {
          solId,
          dateFolder,
          originalName: req.file.originalname,
          size: req.file.size
        }).catch(gfsErr => console.warn('GridFS save warning:', gfsErr.message));
      }

      const fileProxyUrl = `/api/folders/${encodeURIComponent(dateFolder)}/solutions/${encodeURIComponent(solId)}/file`;

      const newSolution = {
        id: solId,
        solutionDate: sDate,
        title: solTitle,
        testType: testType || 'TAT',
        url: fileProxyUrl,
        cloudinaryUrl: null,
        firebaseUrl,
        b2Key,
        b2Url,
        localPath: localFilename,
        publicId: localFilename,
        originalName: req.file.originalname,
        size: req.file.size,
        uploadedAt: new Date()
      };

      if (!folder.solutions) folder.solutions = [];
      folder.solutions.unshift(newSolution);
      await folder.save();

      // Return response immediately to user
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
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const disposition = download
      ? `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
      : `inline; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

    // 1. Check if local file exists by localPath (supports HTTP 206 Partial Content / Range requests for mobile)
    if (solution.localPath) {
      const localFullPath = path.join(solutionsDir, solution.localPath);
      if (fs.existsSync(localFullPath)) {
        if (download) return res.download(localFullPath, filename);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', disposition);
        res.setHeader('Accept-Ranges', 'bytes');
        return res.sendFile(path.resolve(localFullPath), {
          acceptRanges: true,
          cacheControl: true,
          maxAge: 3600000,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': disposition,
            'Accept-Ranges': 'bytes'
          }
        });
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
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', disposition);
        res.setHeader('Accept-Ranges', 'bytes');
        return res.sendFile(path.resolve(cPath), {
          acceptRanges: true,
          cacheControl: true,
          maxAge: 3600000,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': disposition,
            'Accept-Ranges': 'bytes'
          }
        });
      }
    }

    // 2b. Check Backblaze B2 Storage (preferred)
    if (solution.b2Key) {
      if (download) {
        const dlUrl = await getB2SignedUrl(solution.b2Key, 3600);
        if (dlUrl) return res.redirect(dlUrl);
      }
      const b2St = await getB2Stream(solution.b2Key);
      if (b2St) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', disposition);
        if (b2St.contentLength) res.setHeader('Content-Length', b2St.contentLength);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        b2St.stream.pipe(res);
        return;
      }
      // If stream failed but we have a signed URL, redirect
      if (solution.b2Url) return res.redirect(solution.b2Url);
    }
    if (isB2Ready()) {
      const b2Key2 = `solutions/${solution.localPath || `${solution.id}.pdf`}`;
      const b2St2 = await getB2Stream(b2Key2);
      if (b2St2) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', disposition);
        if (b2St2.contentLength) res.setHeader('Content-Length', b2St2.contentLength);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        b2St2.stream.pipe(res);
        return;
      }
    }

    // 2c. Check Firebase Storage (secondary)
    if (solution.firebaseUrl) {
      if (download) return res.redirect(solution.firebaseUrl);
      const fbStream = await getFirebaseStream(`solutions/${solution.localPath || `${solution.id}.pdf`}`);
      if (fbStream) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', disposition);
        if (fbStream.length) res.setHeader('Content-Length', fbStream.length);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return fbStream.stream.pipe(res);
      }
      return res.redirect(solution.firebaseUrl);
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
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', disposition);
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

        // Also cache reconstructed PDF to B2 so it never has to be reconstructed again
        if (isB2Ready()) {
          uploadBufferToB2(Buffer.from(pdfBytes), `solutions/${solution.id}.pdf`, 'application/pdf').catch(() => {});
        } else {
          writeBufferToGridFS(`${solution.id}.pdf`, Buffer.from(pdfBytes)).catch(() => {});
        }

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
        deleteFromFirebase(`solutions/${solution.localPath || `${solution.id}.pdf`}`).catch(() => {});
        if (solution.b2Key) deleteFromB2(solution.b2Key).catch(() => {});

        // Save new file locally and to B2/Firebase/GridFS
        const newLocalName = `${solution.id}.pdf`;
        fs.writeFileSync(path.join(solutionsDir, newLocalName), req.file.buffer);
        solution.localPath = newLocalName;

        if (isB2Ready()) {
          try {
            const b2Res = await uploadBufferToB2(req.file.buffer, `solutions/${newLocalName}`, 'application/pdf');
            solution.b2Key = b2Res.key;
            solution.b2Url = getB2PublicUrl(b2Res.key);
            console.log(`🗂️  Updated Solution PDF saved to B2: ${b2Res.key}`);
          } catch (b2Err) {
            console.warn('B2 upload warning on edit:', b2Err.message);
          }
        } else if (isFirebaseReady()) {
          try {
            const fbRes = await uploadBufferToFirebase(req.file.buffer, `solutions/${newLocalName}`, 'application/pdf');
            solution.firebaseUrl = fbRes.url;
            console.log(`🔥 Updated Solution PDF saved to Firebase: ${fbRes.url}`);
          } catch (fbErr) {
            console.warn('Firebase upload warning on edit:', fbErr.message);
          }
        } else {
          writeBufferToGridFS(newLocalName, req.file.buffer, {
            solId: solution.id,
            dateFolder,
            originalName: req.file.originalname,
            size: req.file.size
          }).catch(gfsErr => console.warn('GridFS save warning:', gfsErr.message));
        }

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
      deleteFromFirebase(`solutions/${solution.localPath || `${solution.id}.pdf`}`).catch(() => {});
      if (solution.b2Key) deleteFromB2(solution.b2Key).catch(() => {});
      else deleteFromB2(`solutions/${solution.localPath || `${solution.id}.pdf`}`).catch(() => {});
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

// 14. Upload live lecturette video — supports direct Cloudinary URL saving and server upload fallback
app.post('/api/folders/:dateFolder/lecturette',
  (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      return next();
    }
    videoDiskUpload.single('video')(req, res, (err) => {
      if (err) return res.status(400).json({ error: `Upload error: ${err.message}` });
      next();
    });
  },
  async (req, res) => {
    try {
      const { dateFolder } = req.params;
      const { title, duration, url, publicId, recordedDate } = req.body;

      // Case A: Video already uploaded directly to Cloudinary by client (fastest & stored on Cloudinary CDN)
      if (url && (url.includes('cloudinary.com') || url.startsWith('http'))) {
        const newLecId = 'lec-' + Date.now();
        const newLecturette = {
          id: newLecId,
          title: (title || `Lecturette ${dateFolder}`).trim(),
          recordedDate: recordedDate || dateFolder,
          duration: Number(duration) || 0,
          url: url,
          publicId: publicId || ('lec-' + Date.now()),
          recordedAt: new Date()
        };

        const folder = await DateFolder.findOneAndUpdate(
          { dateFolder },
          {
            $setOnInsert: {
              dateFolder,
              folderTitle: `Batch ${dateFolder}`,
              tat: { pictures: [] },
              wat: { words: [] },
              solutions: []
            },
            $push: {
              lecturettes: {
                $each: [newLecturette],
                $position: 0
              }
            }
          },
          { upsert: true, new: true }
        );

        return res.json({
          success: true,
          message: 'Lecturette video stored on Cloudinary successfully',
          lecturette: newLecturette,
          folder
        });
      }

      // Case B: Video file uploaded to server via multipart/form-data
      if (!req.file) return res.status(400).json({ error: 'Video file or video URL is required' });

      const filename = req.file.filename;
      const localFilePath = req.file.path;
      let finalUrl = `/uploads/${filename}`;
      let finalPublicId = filename;
      const newLecId = 'lec-' + Date.now();

      let b2Key = null;
      let b2Url = null;

      // Primary cloud storage: Backblaze B2
      if (isB2Ready()) {
        try {
          console.log(`🗂️  Uploading video ${filename} (${(req.file.size / (1024 * 1024)).toFixed(1)} MB) to Backblaze B2...`);
          const fileBuf = fs.readFileSync(localFilePath);
          const b2Res = await uploadBufferToB2(fileBuf, `lecturettes/${filename}`, req.file.mimetype || 'video/webm');
          b2Key = b2Res.key;
          b2Url = b2Res.publicUrl || getB2PublicUrl(b2Res.key);
          console.log(`🗂️  Backblaze B2 video upload success: ${b2Res.key}`);
        } catch (b2Err) {
          console.warn(`Backblaze B2 upload warning for ${filename}:`, b2Err.message);
        }
      }

      const newLecturette = {
        id: newLecId,
        title: (title || `Lecturette ${dateFolder}`).trim(),
        recordedDate: req.body.recordedDate || dateFolder,
        duration: Number(duration) || 0,
        url: finalUrl,
        b2Key,
        b2Url,
        publicId: finalPublicId,
        recordedAt: new Date()
      };

      // Atomic push — eliminates Mongoose VersionError and executes instantly
      const folder = await DateFolder.findOneAndUpdate(
        { dateFolder },
        {
          $setOnInsert: {
            dateFolder,
            folderTitle: `Batch ${dateFolder}`,
            tat: { pictures: [] },
            wat: { words: [] },
            solutions: []
          },
          $push: {
            lecturettes: {
              $each: [newLecturette],
              $position: 0
            }
          }
        },
        { upsert: true, new: true }
      );

      res.json({
        success: true,
        message: 'Lecturette video saved successfully',
        lecturette: newLecturette,
        folder
      });

      // Fallback: If B2 was not ready, write to Firebase / GridFS in background
      if (!isB2Ready() && isFirebaseReady()) {
        (async () => {
          try {
            if (fs.existsSync(localFilePath)) {
              const fileBuf = fs.readFileSync(localFilePath);
              const fbRes = await uploadBufferToFirebase(
                fileBuf,
                `lecturettes/${filename}`,
                req.file.mimetype || 'video/webm'
              );
              console.log(`🔥 Lecturette video saved to Firebase: ${fbRes.url}`);
              const curFolder = await DateFolder.findOne({ dateFolder });
              if (curFolder && curFolder.lecturettes) {
                const lec = curFolder.lecturettes.find(l => l.id === newLecId);
                if (lec) {
                  lec.firebaseUrl = fbRes.url;
                  await curFolder.save();
                }
              }
            }
          } catch (fbErr) {
            console.warn('Firebase lecturette save warning:', fbErr.message);
          }
        })();
      } else {
        (async () => {
          try {
            const bucket = getGfsBucket();
            if (bucket && fs.existsSync(localFilePath)) {
              const uploadStream = bucket.openUploadStream(filename, {
                contentType: req.file.mimetype || 'video/webm',
                metadata: { lecId: newLecId, dateFolder, originalName: req.file.originalname }
              });
              fs.createReadStream(localFilePath).pipe(uploadStream);
            }
          } catch (gfsErr) {
            console.warn('GridFS lecturette save warning:', gfsErr.message);
          }
        })();
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Fallback: stream lecturette video from B2 / Firebase / GridFS if local file is missing on ephemeral disk
app.get('/uploads/lecturette-:file', async (req, res, next) => {
  const filename = 'lecturette-' + req.params.file;
  const filePath = path.join(uploadsDir, filename);
  if (fs.existsSync(filePath)) {
    return next(); // let express.static serve it with Range support
  }
  // 1. Try B2 first
  if (isB2Ready()) {
    const b2St = await getB2Stream(`lecturettes/${filename}`);
    if (b2St) {
      res.setHeader('Content-Type', b2St.contentType || 'video/webm');
      res.setHeader('Accept-Ranges', 'bytes');
      if (b2St.contentLength) res.setHeader('Content-Length', b2St.contentLength);
      b2St.stream.pipe(res);
      return;
    }
  }
  // 2. Try Firebase
  if (isFirebaseReady()) {
    const fbStream = await getFirebaseStream(`lecturettes/${filename}`);
    if (fbStream) {
      res.setHeader('Content-Type', fbStream.contentType || 'video/webm');
      res.setHeader('Accept-Ranges', 'bytes');
      return fbStream.stream.pipe(res);
    }
  }
  // 3. Try GridFS
  const streamData = await getGridFSStream(filename);
  if (streamData) {
    res.setHeader('Content-Type', streamData.file?.metadata?.contentType || 'video/webm');
    return streamData.stream.pipe(res);
  }
  next();
});

// Fallback: stream TAT pictures from B2 if local file is missing on ephemeral disk
app.get('/uploads/tat-:file', async (req, res, next) => {
  const filename = 'tat-' + req.params.file;
  const filePath = path.join(uploadsDir, filename);
  if (fs.existsSync(filePath)) {
    return next();
  }
  if (isB2Ready()) {
    const b2St = await getB2Stream(`tat/${filename}`);
    if (b2St) {
      res.setHeader('Content-Type', b2St.contentType || 'image/jpeg');
      if (b2St.contentLength) res.setHeader('Content-Length', b2St.contentLength);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      b2St.stream.pipe(res);
      return;
    }
  }
  next();
});

// Fallback: stream GPE map images from B2 if local file is missing on ephemeral disk
app.get('/uploads/gpe-:file', async (req, res, next) => {
  const filename = 'gpe-' + req.params.file;
  const filePath = path.join(uploadsDir, filename);
  if (fs.existsSync(filePath)) {
    return next();
  }
  if (isB2Ready()) {
    const b2St = await getB2Stream(`gpe/maps/${filename}`);
    if (b2St) {
      res.setHeader('Content-Type', b2St.contentType || 'image/png');
      if (b2St.contentLength) res.setHeader('Content-Length', b2St.contentLength);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      b2St.stream.pipe(res);
      return;
    }
  }
  next();
});



// 15. DELETE lecturette video by folder and lecturette ID
app.delete('/api/folders/:dateFolder/lecturette/:lecturetteId', async (req, res) => {
  try {
    const { dateFolder, lecturetteId } = req.params;
    let folder = await DateFolder.findOne({ dateFolder });

    // Fallback: If not found in dateFolder, search all folders
    if (!folder || !folder.lecturettes?.some(l => l.id === lecturetteId || l._id?.toString() === lecturetteId)) {
      const query = {
        $or: [
          { 'lecturettes.id': lecturetteId },
          ...(mongoose.Types.ObjectId.isValid(lecturetteId) ? [{ 'lecturettes._id': new mongoose.Types.ObjectId(lecturetteId) }] : [])
        ]
      };
      const anyFolder = await DateFolder.findOne(query);
      if (anyFolder) folder = anyFolder;
    }

    if (!folder) return res.status(404).json({ error: 'Folder or lecturette not found' });

    const lecturette = folder.lecturettes?.find(l => l.id === lecturetteId || l._id?.toString() === lecturetteId);
    if (lecturette) {
      await deleteStoredFile(lecturette.url, lecturette.publicId, 'video');
      await deleteFromGridFS(lecturette.publicId).catch(() => {});
      deleteFromFirebase(`lecturettes/${lecturette.publicId}`).catch(() => {});
      if (lecturette.b2Key) deleteFromB2(lecturette.b2Key).catch(() => {});
      else deleteFromB2(`lecturettes/${lecturette.publicId}`).catch(() => {});
      const localName = path.basename((lecturette.url || '').split('?')[0]);
      if (localName) {
        await deleteFromGridFS(localName).catch(() => {});
        deleteFromFirebase(`lecturettes/${localName}`).catch(() => {});
        deleteFromB2(`lecturettes/${localName}`).catch(() => {});
        const localPath = path.join(uploadsDir, localName);
        if (fs.existsSync(localPath)) {
          try { fs.unlinkSync(localPath); } catch (e) {}
        }
      }
    }

    folder.lecturettes = (folder.lecturettes || []).filter(
      l => l.id !== lecturetteId && l._id?.toString() !== lecturetteId
    );
    folder.markModified('lecturettes');
    await folder.save();
    res.json({ success: true, message: 'Lecturette video deleted', folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15b. Direct top-level DELETE route for lecturette
app.delete('/api/lecturettes/:lecturetteId', async (req, res) => {
  try {
    const { lecturetteId } = req.params;
    const query = {
      $or: [
        { 'lecturettes.id': lecturetteId },
        ...(mongoose.Types.ObjectId.isValid(lecturetteId) ? [{ 'lecturettes._id': new mongoose.Types.ObjectId(lecturetteId) }] : [])
      ]
    };
    const folder = await DateFolder.findOne(query);
    if (!folder) return res.status(404).json({ error: 'Lecturette not found' });

    const lecturette = folder.lecturettes?.find(l => l.id === lecturetteId || l._id?.toString() === lecturetteId);
    if (lecturette) {
      await deleteStoredFile(lecturette.url, lecturette.publicId, 'video');
      await deleteFromGridFS(lecturette.publicId).catch(() => {});
      const localName = path.basename((lecturette.url || '').split('?')[0]);
      if (localName) {
        await deleteFromGridFS(localName).catch(() => {});
        const localPath = path.join(uploadsDir, localName);
        if (fs.existsSync(localPath)) {
          try { fs.unlinkSync(localPath); } catch (e) {}
        }
      }
    }

    folder.lecturettes = (folder.lecturettes || []).filter(
      l => l.id !== lecturetteId && l._id?.toString() !== lecturetteId
    );
    folder.markModified('lecturettes');
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
    let folder = await DateFolder.findOne({ dateFolder });

    if (!folder || !folder.lecturettes?.some(l => l.id === lecturetteId || l._id?.toString() === lecturetteId)) {
      const query = {
        $or: [
          { 'lecturettes.id': lecturetteId },
          ...(mongoose.Types.ObjectId.isValid(lecturetteId) ? [{ 'lecturettes._id': new mongoose.Types.ObjectId(lecturetteId) }] : [])
        ]
      };
      const anyFolder = await DateFolder.findOne(query);
      if (anyFolder) folder = anyFolder;
    }

    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const lecIndex = (folder.lecturettes || []).findIndex(
      l => l.id === lecturetteId || l._id?.toString() === lecturetteId
    );
    if (lecIndex === -1) return res.status(404).json({ error: 'Lecturette not found' });

    const lec = folder.lecturettes[lecIndex];
    if (title !== undefined) lec.title = title;

    if (recordedDate && recordedDate !== folder.dateFolder) {
      let targetFolder = await DateFolder.findOne({ dateFolder: recordedDate });
      if (!targetFolder) {
        targetFolder = new DateFolder({
          dateFolder: recordedDate,
          folderTitle: `Batch ${recordedDate}`,
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

// ─────────────────────── GPE (Group Planning Exercise) ROUTES ────────────────

// 17. GET all GPEs across all folders
app.get('/api/gpes', async (req, res) => {
  try {
    const folders = await DateFolder.find({ 'gpes.0': { $exists: true } }).sort({ dateFolder: -1 });
    const allGpes = [];
    folders.forEach(f => {
      (f.gpes || []).forEach(g => {
        allGpes.push({
          id: g.id,
          dateFolder: f.dateFolder,
          folderTitle: f.folderTitle,
          title: g.title,
          mapUrl: g.mapUrl,
          scale: g.scale,
          description: g.description || '',
          narrativeImageUrl: g.narrativeImageUrl || '',
          narrativeOriginalName: g.narrativeOriginalName || '',
          modelSolution: g.modelSolution,
          solutionsCount: g.solutions?.length || 0,
          solutions: g.solutions || [],
          createdAt: g.createdAt,
          updatedAt: g.updatedAt
        });
      });
    });
    res.json(allGpes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 18. GET GPEs for a specific dateFolder
app.get('/api/folders/:dateFolder/gpes', async (req, res) => {
  try {
    const { dateFolder } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    res.json(folder.gpes || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 19. POST / Upload a GPE map and narrative (image or text)
app.post('/api/folders/:dateFolder/gpes', (req, res, next) => {
  memoryUpload.fields([
    { name: 'map', maxCount: 1 },
    { name: 'narrativeImage', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) return res.status(400).json({ error: `Upload error: ${err.message}` });
    next();
  });
}, async (req, res) => {
  try {
    const { dateFolder } = req.params;
    const { title, description = '', scale, modelSolution, mapUrl: providedMapUrl, narrativeImageUrl: providedNarrativeUrl } = req.body;

    const mapFile = req.files?.['map']?.[0] || req.file;
    const narrativeFile = req.files?.['narrativeImage']?.[0];

    if (!mapFile && !providedMapUrl) {
      return res.status(400).json({ error: 'GPE map image is required' });
    }
    const hasText = description && description.trim().length > 0;
    const hasImage = narrativeFile || providedNarrativeUrl;
    if (!hasText && !hasImage) {
      return res.status(400).json({ error: 'Please provide the GPE narrative either by pasting text or uploading a narrative card image' });
    }

    let folder = await DateFolder.findOne({ dateFolder });
    if (!folder) {
      folder = new DateFolder({
        dateFolder,
        folderTitle: `Batch ${dateFolder}`,
        tat: { pictures: [] },
        wat: { words: [] },
        solutions: [],
        lecturettes: [],
        gpes: []
      });
    }

    let mapUrl = providedMapUrl || '';
    let mapPublicId = '';
    let originalMapName = mapFile ? mapFile.originalname : 'GPE_Map.jpg';

    if (mapFile) {
      if (cloudinary) {
        const result = await uploadBufferToCloudinary(
          mapFile.buffer,
          mapFile.originalname,
          'ssb-psych-prep/gpe/maps',
          'image'
        );
        mapUrl = result.secure_url;
        mapPublicId = result.public_id;
      } else {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(mapFile.originalname) || '.jpg';
        const filename = 'gpe-map-' + uniqueSuffix + ext;
        fs.writeFileSync(path.join(uploadsDir, filename), mapFile.buffer);
        mapUrl = `/uploads/${filename}`;
        mapPublicId = filename;
      }
    }

    let narrativeImageUrl = providedNarrativeUrl || '';
    let narrativePublicId = '';
    let narrativeOriginalName = narrativeFile ? narrativeFile.originalname : '';

    if (narrativeFile) {
      if (cloudinary) {
        const result = await uploadBufferToCloudinary(
          narrativeFile.buffer,
          narrativeFile.originalname,
          'ssb-psych-prep/gpe/narratives',
          'image'
        );
        narrativeImageUrl = result.secure_url;
        narrativePublicId = result.public_id;
      } else {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(narrativeFile.originalname) || '.jpg';
        const filename = 'gpe-narrative-' + uniqueSuffix + ext;
        fs.writeFileSync(path.join(uploadsDir, filename), narrativeFile.buffer);
        narrativeImageUrl = `/uploads/${filename}`;
        narrativePublicId = filename;
      }
    }

    const newGpe = {
      id: 'gpe-' + Date.now(),
      title: (title || `GPE Exercise ${dateFolder}`).trim(),
      mapUrl,
      mapPublicId,
      originalMapName,
      description: (description || '').trim(),
      narrativeImageUrl,
      narrativePublicId,
      narrativeOriginalName,
      scale: (scale || '1 cm = 2 km').trim(),
      modelSolution: (modelSolution || '').trim(),
      solutions: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (!folder.gpes) folder.gpes = [];
    folder.gpes.unshift(newGpe);
    await folder.save();

    res.json({ success: true, message: 'GPE exercise uploaded successfully', gpe: newGpe, folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 20. PUT / Update an existing GPE
app.put('/api/folders/:dateFolder/gpes/:gpeId', (req, res, next) => {
  memoryUpload.single('map')(req, res, (err) => {
    if (err) return res.status(400).json({ error: `Upload error: ${err.message}` });
    next();
  });
}, async (req, res) => {
  try {
    const { dateFolder, gpeId } = req.params;
    const { title, description, scale, modelSolution } = req.body;

    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const gpe = folder.gpes?.find(g => g.id === gpeId || g._id?.toString() === gpeId);
    if (!gpe) return res.status(404).json({ error: 'GPE exercise not found' });

    if (title !== undefined) gpe.title = title.trim();
    if (description !== undefined) gpe.description = description.trim();
    if (scale !== undefined) gpe.scale = scale.trim();
    if (modelSolution !== undefined) gpe.modelSolution = modelSolution.trim();

    if (req.file) {
      await deleteStoredFile(gpe.mapUrl, gpe.mapPublicId, 'image');
      if (cloudinary) {
        const result = await uploadBufferToCloudinary(
          req.file.buffer,
          req.file.originalname,
          'ssb-psych-prep/gpe',
          'image'
        );
        gpe.mapUrl = result.secure_url;
        gpe.mapPublicId = result.public_id;
      } else {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(req.file.originalname) || '.jpg';
        const filename = 'gpe-map-' + uniqueSuffix + ext;
        fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
        gpe.mapUrl = `/uploads/${filename}`;
        gpe.mapPublicId = filename;
      }
      gpe.originalMapName = req.file.originalname;
    }

    gpe.updatedAt = new Date();
    folder.markModified('gpes');
    await folder.save();

    res.json({ success: true, message: 'GPE updated successfully', gpe, folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 20b. PATCH a GPE (JSON-only field updates: title, description, scale, modelSolution)
app.patch('/api/folders/:dateFolder/gpes/:gpeId', async (req, res) => {
  try {
    const { dateFolder, gpeId } = req.params;
    const { title, description, scale, modelSolution } = req.body;

    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const gpe = folder.gpes?.find(g => g.id === gpeId || g._id?.toString() === gpeId);
    if (!gpe) return res.status(404).json({ error: 'GPE exercise not found' });

    if (title !== undefined) gpe.title = title.trim();
    if (description !== undefined) gpe.description = description.trim();
    if (scale !== undefined) gpe.scale = scale.trim();
    if (modelSolution !== undefined) gpe.modelSolution = modelSolution.trim();

    gpe.updatedAt = new Date();
    folder.markModified('gpes');
    await folder.save();

    res.json({ success: true, gpe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 21. DELETE a GPE
app.delete('/api/folders/:dateFolder/gpes/:gpeId', async (req, res) => {
  try {
    const { dateFolder, gpeId } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const gpe = folder.gpes?.find(g => g.id === gpeId || g._id?.toString() === gpeId);
    if (gpe) {
      await deleteStoredFile(gpe.mapUrl, gpe.mapPublicId, 'image');
      if (gpe.narrativeImageUrl) {
        await deleteStoredFile(gpe.narrativeImageUrl, gpe.narrativePublicId, 'image');
      }
      if (gpe.solutions) {
        for (const sol of gpe.solutions) {
          if (sol.solutionImageUrl) {
            await deleteStoredFile(sol.solutionImageUrl, sol.solutionPublicId, 'image');
          }
        }
      }
      folder.gpes = folder.gpes.filter(g => g.id !== gpeId && g._id?.toString() !== gpeId);
      await folder.save();
    }
    res.json({ success: true, message: 'GPE deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 22. POST / Upload Candidate Solution Photo (stored on Cloudinary)
app.post('/api/folders/:dateFolder/gpes/:gpeId/solutions', (req, res, next) => {
  memoryUpload.single('solutionPhoto')(req, res, (err) => {
    if (err) return res.status(400).json({ error: `Upload error: ${err.message}` });
    next();
  });
}, async (req, res) => {
  try {
    const { dateFolder, gpeId } = req.params;
    const { author = 'Candidate', solutionText = '', solutionImageUrl: providedImageUrl } = req.body;
    const photoFile = req.file;

    if (!photoFile && !providedImageUrl && (!solutionText || !solutionText.trim())) {
      return res.status(400).json({ error: 'Please upload a photo of your handwritten solution' });
    }

    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const gpe = folder.gpes?.find(g => g.id === gpeId || g._id?.toString() === gpeId);
    if (!gpe) return res.status(404).json({ error: 'GPE exercise not found' });

    let solutionImageUrl = providedImageUrl || '';
    let solutionPublicId = '';
    let originalImageName = photoFile ? photoFile.originalname : '';

    if (photoFile) {
      if (cloudinary) {
        const result = await uploadBufferToCloudinary(
          photoFile.buffer,
          photoFile.originalname,
          'ssb-psych-prep/gpe/solutions',
          'image'
        );
        solutionImageUrl = result.secure_url;
        solutionPublicId = result.public_id;
      } else {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(photoFile.originalname) || '.jpg';
        const filename = 'gpe-solution-' + uniqueSuffix + ext;
        fs.writeFileSync(path.join(uploadsDir, filename), photoFile.buffer);
        solutionImageUrl = `/uploads/${filename}`;
        solutionPublicId = filename;
      }
    }

    const newSolution = {
      id: 'gpe-sol-' + Date.now(),
      author: (author || 'Candidate').trim(),
      solutionText: (solutionText || '').trim(),
      solutionImageUrl,
      solutionPublicId,
      originalImageName,
      submittedAt: new Date()
    };

    if (!gpe.solutions) gpe.solutions = [];
    gpe.solutions.unshift(newSolution);
    folder.markModified('gpes');
    await folder.save();

    res.json({ success: true, message: 'Solution photo uploaded and saved successfully', solution: newSolution, gpe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 22b. DELETE a specific Candidate Solution from a GPE
app.delete('/api/folders/:dateFolder/gpes/:gpeId/solutions/:solutionId', async (req, res) => {
  try {
    const { dateFolder, gpeId, solutionId } = req.params;
    const folder = await DateFolder.findOne({ dateFolder });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const gpe = folder.gpes?.find(g => g.id === gpeId || g._id?.toString() === gpeId);
    if (!gpe) return res.status(404).json({ error: 'GPE exercise not found' });

    const sol = gpe.solutions?.find(s => s.id === solutionId || s._id?.toString() === solutionId);
    if (sol && sol.solutionImageUrl) {
      await deleteStoredFile(sol.solutionImageUrl, sol.solutionPublicId, 'image');
    }

    gpe.solutions = (gpe.solutions || []).filter(s => s.id !== solutionId && s._id?.toString() !== solutionId);
    folder.markModified('gpes');
    await folder.save();

    res.json({ success: true, message: 'Solution deleted successfully', gpe });
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
    } else if (url) {
      const filename = path.basename(url.split('?')[0]);
      if (filename) {
        const filePath = path.join(uploadsDir, filename);
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (e) {}
        }
      }
    }
  } catch (e) {
    console.warn('Could not delete file:', e.message);
  }
}

// ── Serve React frontend in production (if built locally/together) ─────────
const clientBuild = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  // SPA fallback — must be LAST, only for non-API routes
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
} else {
  // Standalone API deployment (e.g. Render backend paired with Vercel frontend)
  app.get('/', (req, res) => {
    res.json({
      status: 'ok',
      message: 'SSB Psych Prep API is running',
      dbConnected: mongoose.connection.readyState === 1
    });
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
