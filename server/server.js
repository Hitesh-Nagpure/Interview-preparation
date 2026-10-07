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

// ── Backblaze B2 Storage setup (preferred storage for all binary and text files) ──
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

// Helper: pick best storage backend (B2 → Firebase)
function bestStorageReady() {
  return isB2Ready() || isFirebaseReady();
}

// ── B2 Text Helpers (store plain text / JSON as a file in B2) ─────────────────
const b2TextCache = new Map();

async function uploadTextToB2(text, b2Path) {
  if (!isB2Ready()) return null;
  try {
    const buf = Buffer.from(text || '', 'utf8');
    const res = await uploadBufferToB2(buf, b2Path, 'text/plain; charset=utf-8');
    if (res?.key) {
      b2TextCache.set(res.key, text || '');
    }
    return res.key;
  } catch (err) {
    console.warn('B2 text upload warning:', err.message);
    return null;
  }
}

async function downloadTextFromB2(b2Key) {
  if (!b2Key) return null;
  if (b2TextCache.has(b2Key)) return b2TextCache.get(b2Key);
  if (!isB2Ready()) return null;
  try {
    const st = await getB2Stream(b2Key);
    if (!st) return null;
    const text = await new Promise((resolve, reject) => {
      const chunks = [];
      st.stream.on('data', d => chunks.push(d));
      st.stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      st.stream.on('error', reject);
    });
    b2TextCache.set(b2Key, text);
    return text;
  } catch (err) {
    console.warn('B2 text download warning:', err.message);
    return null;
  }
}

function evictB2TextCache(b2Key) {
  if (b2Key) b2TextCache.delete(b2Key);
}

async function hydrateGpe(gpe) {
  if (!gpe) return gpe;
  const obj = typeof gpe.toObject === 'function' ? gpe.toObject() : { ...gpe };
  if (obj.descriptionB2Key && !obj.description) {
    const t = await downloadTextFromB2(obj.descriptionB2Key);
    if (t !== null && t !== undefined) obj.description = t;
  }
  if (obj.modelSolutionB2Key && !obj.modelSolution) {
    const t = await downloadTextFromB2(obj.modelSolutionB2Key);
    if (t !== null && t !== undefined) obj.modelSolution = t;
  }
  if (Array.isArray(obj.solutions)) {
    obj.solutions = await Promise.all(obj.solutions.map(async sol => {
      const sObj = typeof sol.toObject === 'function' ? sol.toObject() : { ...sol };
      if (sObj.solutionTextB2Key && !sObj.solutionText) {
        const t = await downloadTextFromB2(sObj.solutionTextB2Key);
        if (t !== null && t !== undefined) sObj.solutionText = t;
      }
      return sObj;
    }));
  }
  return obj;
}

async function hydrateNoteCard(nc) {
  if (!nc) return nc;
  const obj = typeof nc.toObject === 'function' ? nc.toObject() : { ...nc };
  if (obj.contentB2Key && !obj.content) {
    const t = await downloadTextFromB2(obj.contentB2Key);
    if (t !== null && t !== undefined) obj.content = t;
  }
  if (obj.plainTextB2Key && !obj.plainText) {
    const t = await downloadTextFromB2(obj.plainTextB2Key);
    if (t !== null && t !== undefined) obj.plainText = t;
  }
  return obj;
}

async function hydrateFolder(folder) {
  if (!folder) return folder;
  const obj = typeof folder.toObject === 'function' ? folder.toObject() : { ...folder };
  if (Array.isArray(obj.gpes)) {
    obj.gpes = await Promise.all(obj.gpes.map(hydrateGpe));
  }
  if (Array.isArray(obj.noteCards)) {
    obj.noteCards = await Promise.all(obj.noteCards.map(hydrateNoteCard));
  }
  if (obj.notes) {
    if (obj.notes.contentB2Key && !obj.notes.content) {
      const t = await downloadTextFromB2(obj.notes.contentB2Key);
      if (t !== null && t !== undefined) obj.notes.content = t;
    }
    if (obj.notes.plainTextB2Key && !obj.notes.plainText) {
      const t = await downloadTextFromB2(obj.notes.plainTextB2Key);
      if (t !== null && t !== undefined) obj.notes.plainText = t;
    }
  }
  return obj;
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
app.use(cors({
  origin: true,       // reflect the request origin (allows any origin)
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static uploaded files ONLY when the file actually exists locally.
// If not found locally, call next() so that the B2/Firebase fallback routes below can handle it.
// This is critical on Render where the ephemeral disk is wiped between deploys.
app.use('/uploads', (req, res, next) => {
  const filePath = path.join(uploadsDir, req.path);
  if (fs.existsSync(filePath)) {
    // File exists locally — serve with full Range support via express.static handler
    express.static(uploadsDir)(req, res, next);
  } else {
    // File missing (ephemeral disk wiped) — fall through to B2/Firebase fallback routes
    next();
  }
});

// ── MongoDB ───────────────────────────────────────────────────────────────────
// GridFS has been removed. All binary files are stored in Backblaze B2 or Firebase.
// MongoDB only stores structured metadata (text, dates, IDs, URLs/keys).

async function syncLocalSolutionsToStorage() {
  // Sync local PDFs to B2 (preferred) → Firebase
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

  // No GridFS fallback — if no cloud storage is configured, files remain only on local disk.
  console.warn('⚠️  No cloud storage configured. Local PDF files will not be persisted after restarts.');
}

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB Atlas: ssb_psych_prep');
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
    const hydratedFolders = await Promise.all(folders.map(hydrateFolder));
    const formatted = hydratedFolders.map((f) => ({
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
        pictures: (f.tat?.pictures || []).map(p => ({
          id: p.id,
          url: p.url,
          cloudinaryUrl: p.cloudinaryUrl || '',
          b2Key: p.b2Key || '',
          b2Url: p.b2Url || '',
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
      lecturettes: (f.lecturettes || []).map(l => {
        let cUrl = l.cloudinaryUrl || '';
        if (!cUrl && l.publicId && typeof l.publicId === 'string' && l.publicId.startsWith('ssb-psych-prep/')) {
          cUrl = `https://res.cloudinary.com/${CLOUD_NAME || 'bn8zsmom'}/video/upload/${l.publicId.replace(/\.(mp4|webm)$/i, '')}.mp4`;
        }
        let safeUrl = l.url;
        if (safeUrl && safeUrl.includes('.backblazeb2.com/')) {
          safeUrl = l.b2Key ? `/api/media/${l.b2Key.replace(/^\/+/, '')}` : (l.publicId ? `/uploads/${l.publicId}` : safeUrl);
        }
        let safeB2Url = l.b2Url;
        if (safeB2Url && safeB2Url.includes('.backblazeb2.com/')) {
          safeB2Url = l.b2Key ? `/api/media/${l.b2Key.replace(/^\/+/, '')}` : safeB2Url;
        }
        return {
          id: l.id || l._id?.toString() || l._id,
          _id: l._id?.toString() || l.id,
          title: l.title,
          duration: l.duration,
          url: safeUrl,
          publicId: l.publicId,
          cloudinaryUrl: cUrl,
          firebaseUrl: l.firebaseUrl || '',
          b2Key: l.b2Key || '',
          b2Url: safeB2Url || (l.b2Key ? `/api/media/${l.b2Key.replace(/^\/+/, '')}` : ''),
          recordedDate: l.recordedDate || f.dateFolder,
          recordedAt: l.recordedAt
        };
      }),
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
        mapPublicId: g.mapPublicId || '',
        mapB2Key: g.mapB2Key || '',
        scale: g.scale,
        description: g.description || '',
        narrativeImageUrl: g.narrativeImageUrl || '',
        narrativePublicId: g.narrativePublicId || '',
        narrativeB2Key: g.narrativeB2Key || '',
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
    const hydrated = await hydrateFolder(folder);
    res.json(hydrated);
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

    const hydFolder = await hydrateFolder(folder);
    let noteCards = hydFolder.noteCards || [];
    if (noteCards.length === 0 && hydFolder.notes?.content && hydFolder.notes.content.trim() && hydFolder.notes.content !== '<p><br></p>') {
      const legacyCard = {
        id: 'note-legacy-' + (hydFolder.notes.updatedAt ? new Date(hydFolder.notes.updatedAt).getTime() : Date.now()),
        title: 'Initial Practice Note',
        content: hydFolder.notes.content,
        plainText: hydFolder.notes.plainText || '',
        author: hydFolder.notes.author || '',
        createdAt: hydFolder.notes.updatedAt || new Date(),
        updatedAt: hydFolder.notes.updatedAt || new Date()
      };
      folder.noteCards = [legacyCard];
      await folder.save();
      noteCards = [legacyCard];
    }

    res.json({
      notes: hydFolder.notes || { content: '', plainText: '', author: '', updatedAt: null },
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

    const noteId = 'note-' + Date.now() + '-' + Math.round(Math.random() * 1e4);
    let contentB2Key = null;
    let plainTextB2Key = null;

    if (isB2Ready()) {
      if (content) contentB2Key = await uploadTextToB2(content, `notes/text/${noteId}-content.html`);
      if (plainText) plainTextB2Key = await uploadTextToB2(plainText, `notes/text/${noteId}-plain.txt`);
    }

    const newNoteCard = {
      id: noteId,
      title: (title || '').trim(),
      content: content || '',
      contentB2Key,
      plainText: plainText || '',
      plainTextB2Key,
      author: trimmedAuthor,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    folder.noteCards.unshift(newNoteCard);

    // Keep folder.notes updated with latest for backward compatibility
    folder.notes = {
      content: content || '',
      contentB2Key,
      plainText: plainText || '',
      plainTextB2Key,
      author: trimmedAuthor,
      updatedAt: new Date()
    };

    await folder.save();
    const hydFolder = await hydrateFolder(folder);
    const hydCard = await hydrateNoteCard(newNoteCard);
    res.json({
      success: true,
      message: 'Note card saved successfully',
      noteCard: hydCard,
      noteCards: hydFolder.noteCards,
      notes: hydFolder.notes,
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
    if (content !== undefined) {
      card.content = content || '';
      if (isB2Ready() && content) {
        if (card.contentB2Key) { deleteFromB2(card.contentB2Key).catch(() => {}); evictB2TextCache(card.contentB2Key); }
        card.contentB2Key = await uploadTextToB2(content, `notes/text/${card.id}-content.html`);
      } else {
        if (card.contentB2Key) { deleteFromB2(card.contentB2Key).catch(() => {}); evictB2TextCache(card.contentB2Key); card.contentB2Key = null; }
      }
    }
    if (plainText !== undefined) {
      card.plainText = plainText || '';
      if (isB2Ready() && plainText) {
        if (card.plainTextB2Key) { deleteFromB2(card.plainTextB2Key).catch(() => {}); evictB2TextCache(card.plainTextB2Key); }
        card.plainTextB2Key = await uploadTextToB2(plainText, `notes/text/${card.id}-plain.txt`);
      } else {
        if (card.plainTextB2Key) { deleteFromB2(card.plainTextB2Key).catch(() => {}); evictB2TextCache(card.plainTextB2Key); card.plainTextB2Key = null; }
      }
    }
    if (author) card.author = author.trim();
    card.updatedAt = new Date();

    folder.markModified('noteCards');

    // Also update legacy folder.notes if this is the first/newest card
    if (cardIndex === 0) {
      folder.notes = {
        content: card.content,
        contentB2Key: card.contentB2Key,
        plainText: card.plainText,
        plainTextB2Key: card.plainTextB2Key,
        author: card.author,
        updatedAt: card.updatedAt
      };
    }

    await folder.save();
    const hydFolder = await hydrateFolder(folder);
    const hydCard = await hydrateNoteCard(card);
    res.json({
      success: true,
      message: 'Note card updated successfully',
      noteCard: hydCard,
      noteCards: hydFolder.noteCards,
      notes: hydFolder.notes,
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
    const targetCard = folder.noteCards.find(c => c.id === noteId || c._id?.toString() === noteId);
    if (targetCard) {
      if (targetCard.contentB2Key) { deleteFromB2(targetCard.contentB2Key).catch(() => {}); evictB2TextCache(targetCard.contentB2Key); }
      if (targetCard.plainTextB2Key) { deleteFromB2(targetCard.plainTextB2Key).catch(() => {}); evictB2TextCache(targetCard.plainTextB2Key); }
    }
    folder.noteCards = folder.noteCards.filter(c => c.id !== noteId && c._id?.toString() !== noteId);

    // Update folder.notes with latest remaining card or empty
    if (folder.noteCards.length > 0) {
      const latest = folder.noteCards[0];
      folder.notes = {
        content: latest.content,
        contentB2Key: latest.contentB2Key,
        plainText: latest.plainText,
        plainTextB2Key: latest.plainTextB2Key,
        author: latest.author,
        updatedAt: latest.updatedAt
      };
    } else {
      folder.notes = {
        content: '',
        contentB2Key: null,
        plainText: '',
        plainTextB2Key: null,
        author: '',
        updatedAt: null
      };
    }

    await folder.save();
    const hydFolder = await hydrateFolder(folder);
    res.json({
      success: true,
      message: 'Note card deleted successfully',
      noteCards: hydFolder.noteCards,
      notes: hydFolder.notes
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
    const hydFolder = await hydrateFolder(folder);

    let noteCards = hydFolder.noteCards || [];
    if (noteCards.length === 0 && hydFolder.notes?.content && hydFolder.notes.content.trim() && hydFolder.notes.content !== '<p><br></p>') {
      const legacyCard = {
        id: 'note-legacy-' + (hydFolder.notes.updatedAt ? new Date(hydFolder.notes.updatedAt).getTime() : Date.now()),
        title: 'Initial Practice Note',
        content: hydFolder.notes.content,
        plainText: hydFolder.notes.plainText || '',
        author: hydFolder.notes.author || '',
        createdAt: hydFolder.notes.updatedAt || new Date(),
        updatedAt: hydFolder.notes.updatedAt || new Date()
      };
      folder.noteCards = [legacyCard];
      await folder.save();
      noteCards = [legacyCard];
    }

    res.json({
      reviews: (hydFolder.reviews || []).map(r => ({
        id: r.id,
        title: r.title,
        duration: r.duration,
        url: r.url,
        publicId: r.publicId,
        reviewerName: r.reviewerName || '',
        recordedAt: r.recordedAt
      })),
      notes: hydFolder.notes || { content: '', plainText: '', author: '', updatedAt: null },
      noteCards: noteCards.map(nc => ({
        id: nc.id,
        title: nc.title || '',
        content: nc.content || '',
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
        }
        deleteFromFirebase(`solutions/${sol.localPath || sol.id + '.pdf'}`).catch(() => {});
        if (sol.b2Key) deleteFromB2(sol.b2Key).catch(() => {});
        else deleteFromB2(`solutions/${sol.localPath || sol.id + '.pdf'}`).catch(() => {});
        // Also delete B2 text files for GPE-related text stored in B2
        if (sol.descriptionB2Key) deleteFromB2(sol.descriptionB2Key).catch(() => {});
        if (sol.modelSolutionB2Key) deleteFromB2(sol.modelSolutionB2Key).catch(() => {});
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
        console.warn('⚠️  No cloud storage configured. Solution PDF saved only to local disk.');
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

    // 2b. Check Backblaze B2 Storage (preferred direct stream)
    if (solution.b2Key) {
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

    // 3. PDF not found anywhere — return 404
    // (GridFS has been removed; files are in B2 / Firebase / local disk only)

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

        // Cache reconstructed PDF to B2 so it never has to be reconstructed again
        if (isB2Ready()) {
          uploadBufferToB2(Buffer.from(pdfBytes), `solutions/${solution.id}.pdf`, 'application/pdf').catch(() => {});
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
    // 5. Last resort: pre-signed URL directly from B2
    if (solution.b2Key) {
      try {
        const signedUrl = await getB2SignedUrl(solution.b2Key, 3600);
        if (signedUrl) return res.redirect(signedUrl);
      } catch (_) {}
    }

    // 6. Direct Cloudinary URL if it's already a native PDF
    if (solution.cloudinaryUrl && solution.cloudinaryUrl.endsWith('.pdf')) {
      return res.redirect(solution.cloudinaryUrl);
    }
    if (solution.publicId && solution.publicId.endsWith('.pdf')) {
      return res.redirect(`https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${solution.publicId}`);
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
        }
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
          console.warn('⚠️  No cloud storage configured. Updated solution PDF saved only to local disk.');
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
      }
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
          const ext = path.extname(filename).toLowerCase();
          const videoMime = {
            '.webm': 'video/webm',
            '.mp4': 'video/mp4',
            '.mov': 'video/quicktime'
          }[ext] || req.file.mimetype || 'video/webm';
          const b2Res = await uploadBufferToB2(fileBuf, `lecturettes/${filename}`, videoMime);
          b2Key = b2Res.key;
          b2Url = `/api/media/${b2Res.key.replace(/^\/+/, '')}`;
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
        b2Url: b2Key ? `/api/media/${b2Key.replace(/^\/+/, '')}` : null,
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

      // Asynchronously mirror lecturette to Cloudinary for resilient CDN playback
      if (cloudinary && fs.existsSync(localFilePath)) {
        (async () => {
          try {
            console.log(`☁️  Mirroring lecturette ${filename} to Cloudinary...`);
            const fileBuf = fs.readFileSync(localFilePath);
            const cRes = await uploadBufferToCloudinary(
              fileBuf,
              filename,
              'ssb-psych-prep/lecturettes',
              'video'
            );
            if (cRes?.secure_url) {
              console.log(`☁️  Cloudinary video mirror success: ${cRes.secure_url}`);
              const curFolder = await DateFolder.findOne({ dateFolder });
              const curLec = curFolder?.lecturettes?.find(l => l.id === newLecId);
              if (curLec) {
                curLec.cloudinaryUrl = cRes.secure_url;
                curLec.publicId = cRes.public_id;
                await curFolder.save();
              }
            }
          } catch (cErr) {
            console.warn('Cloudinary lecturette mirror warning:', cErr.message);
          }
        })();
      }

      // Fallback: If B2 was not ready, write to Firebase in background
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
      } else if (!isB2Ready() && !isFirebaseReady()) {
        console.warn('⚠️  No cloud storage configured. Lecturette saved only to local disk.');
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
    return next(); // let the smart static middleware above serve it with Range support
  }
  // 1. Try B2 first — with full HTTP Range request support for video seeking
  if (isB2Ready()) {
    try {
      const b2Key = `lecturettes/${filename}`;
      // Check if Range header is present (browser video seek/stream)
      const rangeHeader = req.headers['range'];
      if (rangeHeader) {
        // Fetch with Range to support partial content (byte-range requests)
        const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
        const { getBucketName } = require('./b2Storage');
        const endpoint = process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com';
        const region = process.env.B2_REGION || 'us-east-005';
        const keyId = process.env.B2_KEY_ID || '005b4c93476e4610000000001';
        const appKey = process.env.B2_APPLICATION_KEY || 'K005ivXe5R+ov97avZpjWDs6IDe7T34';
        const bucketName = getBucketName();
        if (bucketName) {
          const s3 = new S3Client({
            endpoint, region,
            credentials: { accessKeyId: keyId, secretAccessKey: appKey },
            forcePathStyle: true
          });
          try {
            // First get full size with HeadObject
            const { HeadObjectCommand } = require('@aws-sdk/client-s3');
            const head = await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: b2Key }));
            const totalSize = head.ContentLength;
            const ext = path.extname(filename).toLowerCase();
            const deducedMime = {
              '.webm': 'video/webm',
              '.mp4': 'video/mp4',
              '.mov': 'video/quicktime'
            }[ext] || 'video/webm';
            let contentType = deducedMime;
            if (head.ContentType && head.ContentType !== 'text/plain' && head.ContentType !== 'application/octet-stream') {
              contentType = head.ContentType;
            }
            // Parse Range header
            const parts = rangeHeader.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 10 * 1024 * 1024 - 1, totalSize - 1);
            const chunkSize = end - start + 1;
            const rangeCmd = new GetObjectCommand({
              Bucket: bucketName,
              Key: b2Key,
              Range: `bytes=${start}-${end}`
            });
            const rangeRes = await s3.send(rangeCmd);
            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${end}/${totalSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': chunkSize,
              'Content-Type': contentType
            });
            rangeRes.Body.pipe(res);
            return;
          } catch (rangeErr) {
            // Fall through to full stream if range request fails
            console.warn('B2 range request failed, falling back to full stream:', rangeErr.message);
          }
        }
      }
      // Full stream (no Range header or range failed)
      const b2St = await getB2Stream(b2Key);
      if (b2St) {
        const ext = path.extname(filename).toLowerCase();
        const deducedMime = {
          '.webm': 'video/webm',
          '.mp4': 'video/mp4',
          '.mov': 'video/quicktime'
        }[ext] || 'video/webm';
        let contentType = deducedMime;
        if (b2St.contentType && b2St.contentType !== 'text/plain' && b2St.contentType !== 'application/octet-stream') {
          contentType = b2St.contentType;
        }
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');
        if (b2St.contentLength) res.setHeader('Content-Length', b2St.contentLength);
        b2St.stream.pipe(res);
        return;
      }
    } catch (b2Err) {
      console.warn('B2 lecturette stream error:', b2Err.message);
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
  // 3. Try Cloudinary redirect from DB (by url or b2Key)
  try {
    const folder = await DateFolder.findOne({ 'lecturettes.url': `/uploads/${filename}` });
    const lec = folder?.lecturettes?.find(l => l.url === `/uploads/${filename}`);
    if (lec) {
      // Prefer cloudinaryUrl; fall back to Cloudinary via publicId
      if (lec.cloudinaryUrl && lec.cloudinaryUrl.startsWith('http')) {
        return res.redirect(lec.cloudinaryUrl);
      }
      if (lec.publicId && lec.publicId.startsWith('ssb-psych-prep/')) {
        const cloudUrl = `https://res.cloudinary.com/${CLOUD_NAME}/video/upload/${lec.publicId}`;
        return res.redirect(cloudUrl);
      }
    }
    // Also check by b2Key pattern
    const folder2 = await DateFolder.findOne({ 'lecturettes.b2Key': `lecturettes/${filename}` });
    const lec2 = folder2?.lecturettes?.find(l => l.b2Key === `lecturettes/${filename}`);
    if (lec2) {
      if (lec2.cloudinaryUrl && lec2.cloudinaryUrl.startsWith('http')) {
        return res.redirect(lec2.cloudinaryUrl);
      }
      if (lec2.publicId && lec2.publicId.startsWith('ssb-psych-prep/')) {
        const cloudUrl = `https://res.cloudinary.com/${CLOUD_NAME}/video/upload/${lec2.publicId}`;
        return res.redirect(cloudUrl);
      }
    }
  } catch (_) {}
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
  // Try Cloudinary redirect from DB
  try {
    const folder = await DateFolder.findOne({ 'tat.pictures.url': `/uploads/${filename}` });
    const pic = folder?.tat?.pictures?.find(p => p.url === `/uploads/${filename}`);
    if (pic && pic.cloudinaryUrl && pic.cloudinaryUrl.startsWith('http')) {
      return res.redirect(pic.cloudinaryUrl);
    }
  } catch (_) {}
  next();
});

// ── Unified Media Proxy (/api/media/:type/:filename) ─────────────────────────
// Serves any stored file from B2 by type folder and filename.
// This is the PRIMARY way the Vercel frontend accesses media in production —
// it routes through the Render backend which has B2 credentials.
// Types: tat | lecturettes | gpe/maps | gpe/narratives | gpe/solutions | solutions
app.get('/api/media/:type/:filename', async (req, res) => {
  try {
    let { type, filename } = req.params;
    filename = decodeURIComponent(filename);
    type = decodeURIComponent(type);
    // Sanitise — no path traversal
    if (filename.includes('..') || type.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    // 1. Try local disk first (fast, works in dev)
    const localPath = path.join(uploadsDir, filename);
    if (fs.existsSync(localPath)) {
      const ext = path.extname(filename).toLowerCase();
      const mime = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp',
        '.webm': 'video/webm', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
        '.pdf': 'application/pdf'
      }[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Accept-Ranges', 'bytes');
      // Support Range requests for local video files
      const stat = fs.statSync(localPath);
      const rangeHeader = req.headers['range'];
      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mime
        });
        fs.createReadStream(localPath, { start, end }).pipe(res);
      } else {
        res.setHeader('Content-Length', stat.size);
        fs.createReadStream(localPath).pipe(res);
      }
      return;
    }
    // 2. Stream from B2 — with Range request support for videos
    if (isB2Ready()) {
      const b2Key = `${type}/${filename}`;
      const ext = path.extname(filename).toLowerCase();
      const deducedMime = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp',
        '.webm': 'video/webm', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
        '.pdf': 'application/pdf'
      }[ext];
      const rangeHeader = req.headers['range'];
      if (rangeHeader) {
        // Support byte-range streaming from B2 for video seeking
        try {
          const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
          const { getBucketName } = require('./b2Storage');
          const endpoint = process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com';
          const region = process.env.B2_REGION || 'us-east-005';
          const keyId = process.env.B2_KEY_ID || '005b4c93476e4610000000001';
          const appKey = process.env.B2_APPLICATION_KEY || 'K005ivXe5R+ov97avZpjWDs6IDe7T34';
          const bucketName = getBucketName();
          if (bucketName) {
            const s3 = new S3Client({
              endpoint, region,
              credentials: { accessKeyId: keyId, secretAccessKey: appKey },
              forcePathStyle: true
            });
            const head = await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: b2Key }));
            const totalSize = head.ContentLength;
            let contentType = deducedMime || head.ContentType || 'application/octet-stream';
            if ((contentType === 'text/plain' || contentType === 'application/octet-stream') && deducedMime) {
              contentType = deducedMime;
            }
            const parts = rangeHeader.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 10 * 1024 * 1024 - 1, totalSize - 1);
            const chunkSize = end - start + 1;
            const rangeRes = await s3.send(new GetObjectCommand({
              Bucket: bucketName, Key: b2Key, Range: `bytes=${start}-${end}`
            }));
            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${end}/${totalSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': chunkSize,
              'Content-Type': contentType
            });
            rangeRes.Body.pipe(res);
            return;
          }
        } catch (rangeErr) {
          console.warn('B2 range request failed in /api/media:', rangeErr.message);
          // Fall through to full stream
        }
      }
      const b2St = await getB2Stream(b2Key);
      if (b2St) {
        let contentType = deducedMime || b2St.contentType || 'application/octet-stream';
        if ((contentType === 'text/plain' || contentType === 'application/octet-stream') && deducedMime) {
          contentType = deducedMime;
        }
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        if (b2St.contentLength) res.setHeader('Content-Length', b2St.contentLength);
        b2St.stream.pipe(res);
        return;
      }
    }

    // 3. Fallback: stream or redirect from Cloudinary / Firebase if B2 is unavailable
    try {
      if (type === 'lecturettes') {
        const folder = await DateFolder.findOne({
          $or: [
            { 'lecturettes.b2Key': `lecturettes/${filename}` },
            { 'lecturettes.url': `/uploads/${filename}` },
            { 'lecturettes.url': { $regex: filename } },
            { 'lecturettes.publicId': filename.replace(/\.[^/.]+$/, '') }
          ]
        });
        const lec = folder?.lecturettes?.find(l =>
          l.b2Key === `lecturettes/${filename}` ||
          l.url?.includes(filename) ||
          l.publicId === filename ||
          l.publicId === filename.replace(/\.[^/.]+$/, '')
        );
        if (lec) {
          if (lec.cloudinaryUrl && lec.cloudinaryUrl.startsWith('http')) {
            return res.redirect(lec.cloudinaryUrl);
          }
          if (lec.publicId && typeof lec.publicId === 'string' && lec.publicId.startsWith('ssb-psych-prep/')) {
            const cleanId = lec.publicId.replace(/\.(mp4|webm)$/i, '');
            return res.redirect(`https://res.cloudinary.com/${CLOUD_NAME || 'bn8zsmom'}/video/upload/${cleanId}.mp4`);
          }
          if (lec.firebaseUrl && isFirebaseReady()) {
            const fbStream = await getFirebaseStream(`lecturettes/${filename}`);
            if (fbStream) {
              res.setHeader('Content-Type', fbStream.contentType || 'video/webm');
              res.setHeader('Accept-Ranges', 'bytes');
              return fbStream.stream.pipe(res);
            }
          }
        }
      }
    } catch (fbErr) {
      console.warn('Fallback stream error in /api/media:', fbErr.message);
    }

    res.status(404).json({ error: 'Media not found' });
  } catch (err) {
    console.warn('Media proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// Support nested type paths like gpe/maps, gpe/narratives, gpe/solutions
app.get('/api/media/:type1/:type2/:filename', async (req, res) => {
  try {
    const type = `${decodeURIComponent(req.params.type1)}/${decodeURIComponent(req.params.type2)}`;
    const filename = decodeURIComponent(req.params.filename);
    if (filename.includes('..') || type.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    const localPath = path.join(uploadsDir, filename);
    if (fs.existsSync(localPath)) {
      const ext = path.extname(filename).toLowerCase();
      const mime = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp',
        '.webm': 'video/webm', '.mp4': 'video/mp4'
      }[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(localPath).pipe(res);
    }
    if (isB2Ready()) {
      const b2St = await getB2Stream(`${type}/${filename}`);
      if (b2St) {
        res.setHeader('Content-Type', b2St.contentType || 'application/octet-stream');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        if (b2St.contentLength) res.setHeader('Content-Length', b2St.contentLength);
        b2St.stream.pipe(res);
        return;
      }
    }
    res.status(404).json({ error: 'Media not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/uploads/gpe-:file', async (req, res, next) => {
  const filename = 'gpe-' + req.params.file;
  const filePath = path.join(uploadsDir, filename);
  if (fs.existsSync(filePath)) {
    return next();
  }
  if (isB2Ready()) {
    let b2Folder = 'gpe/maps';
    if (filename.startsWith('gpe-narrative-')) {
      b2Folder = 'gpe/narratives';
    } else if (filename.startsWith('gpe-solution-')) {
      b2Folder = 'gpe/solutions';
    }
    const b2St = await getB2Stream(`${b2Folder}/${filename}`);
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

// Fallback: stream GPE narrative images from B2 if local file is missing
app.get('/uploads/gpe-narrative-:file', async (req, res, next) => {
  const filename = 'gpe-narrative-' + req.params.file;
  const filePath = path.join(uploadsDir, filename);
  if (fs.existsSync(filePath)) return next();
  if (isB2Ready()) {
    const b2St = await getB2Stream(`gpe/narratives/${filename}`);
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

// Fallback: stream GPE solution photos from B2 if local file is missing
app.get('/uploads/gpe-solution-:file', async (req, res, next) => {
  const filename = 'gpe-solution-' + req.params.file;
  const filePath = path.join(uploadsDir, filename);
  if (fs.existsSync(filePath)) return next();
  if (isB2Ready()) {
    const b2St = await getB2Stream(`gpe/solutions/${filename}`);
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

// Fallback: stream GPE map images from B2 if local file is missing
app.get('/uploads/gpe-map-:file', async (req, res, next) => {
  const filename = 'gpe-map-' + req.params.file;
  const filePath = path.join(uploadsDir, filename);
  if (fs.existsSync(filePath)) return next();
  if (isB2Ready()) {
    const b2St = await getB2Stream(`gpe/maps/${filename}`);
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
      deleteFromFirebase(`lecturettes/${lecturette.publicId}`).catch(() => {});
      if (lecturette.b2Key) deleteFromB2(lecturette.b2Key).catch(() => {});
      else deleteFromB2(`lecturettes/${lecturette.publicId}`).catch(() => {});
      const localName = path.basename((lecturette.url || '').split('?')[0]);
      if (localName) {
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
      const localName = path.basename((lecturette.url || '').split('?')[0]);
      if (localName) {
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
    for (const f of folders) {
      const hydratedGpes = await Promise.all((f.gpes || []).map(hydrateGpe));
      hydratedGpes.forEach(g => {
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
    }
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
    const hydratedGpes = await Promise.all((folder.gpes || []).map(hydrateGpe));
    res.json(hydratedGpes);
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

    let mapB2Key = null;
    if (mapFile) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(mapFile.originalname) || '.jpg';
      const filename = 'gpe-map-' + uniqueSuffix + ext;
      fs.writeFileSync(path.join(uploadsDir, filename), mapFile.buffer);
      mapUrl = `/uploads/${filename}`;
      mapPublicId = filename;
      // Upload to B2 (preferred persistent storage)
      if (isB2Ready()) {
        try {
          const b2Res = await uploadBufferToB2(mapFile.buffer, `gpe/maps/${filename}`, mapFile.mimetype || 'image/jpeg');
          mapB2Key = b2Res.key;
          console.log(`🗂️  GPE map uploaded to B2: ${mapB2Key}`);
        } catch (b2Err) {
          console.warn('B2 GPE map upload warning:', b2Err.message);
        }
      } else if (cloudinary) {
        try {
          const result = await uploadBufferToCloudinary(mapFile.buffer, mapFile.originalname, 'ssb-psych-prep/gpe/maps', 'image');
          mapUrl = result.secure_url;
          mapPublicId = result.public_id;
        } catch (cErr) {
          console.warn('Cloudinary GPE map upload warning:', cErr.message);
        }
      }
    }

    let narrativeImageUrl = providedNarrativeUrl || '';
    let narrativePublicId = '';
    let narrativeB2Key = null;
    let narrativeOriginalName = narrativeFile ? narrativeFile.originalname : '';

    if (narrativeFile) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(narrativeFile.originalname) || '.jpg';
      const filename = 'gpe-narrative-' + uniqueSuffix + ext;
      fs.writeFileSync(path.join(uploadsDir, filename), narrativeFile.buffer);
      narrativeImageUrl = `/uploads/${filename}`;
      narrativePublicId = filename;
      // Upload to B2
      if (isB2Ready()) {
        try {
          const b2Res = await uploadBufferToB2(narrativeFile.buffer, `gpe/narratives/${filename}`, narrativeFile.mimetype || 'image/jpeg');
          narrativeB2Key = b2Res.key;
          console.log(`🗂️  GPE narrative uploaded to B2: ${narrativeB2Key}`);
        } catch (b2Err) {
          console.warn('B2 GPE narrative upload warning:', b2Err.message);
        }
      } else if (cloudinary) {
        try {
          const result = await uploadBufferToCloudinary(narrativeFile.buffer, narrativeFile.originalname, 'ssb-psych-prep/gpe/narratives', 'image');
          narrativeImageUrl = result.secure_url;
          narrativePublicId = result.public_id;
        } catch (cErr) {
          console.warn('Cloudinary GPE narrative upload warning:', cErr.message);
        }
      }
    }

    const gpeId = 'gpe-' + Date.now();
    const descriptionText = (description || '').trim();
    const modelSolutionText = (modelSolution || '').trim();

    // Upload text fields to B2 to keep MongoDB document lean
    let descriptionB2Key = null;
    let modelSolutionB2Key = null;
    if (isB2Ready()) {
      if (descriptionText) {
        descriptionB2Key = await uploadTextToB2(descriptionText, `gpe/text/${gpeId}-description.txt`);
      }
      if (modelSolutionText) {
        modelSolutionB2Key = await uploadTextToB2(modelSolutionText, `gpe/text/${gpeId}-model-solution.txt`);
      }
    }

    const newGpe = {
      id: gpeId,
      title: (title || `GPE Exercise ${dateFolder}`).trim(),
      mapUrl,
      mapPublicId,
      mapB2Key,
      originalMapName,
      // Store description/modelSolution in MongoDB only if B2 is not available
      description: descriptionB2Key ? '' : descriptionText,
      descriptionB2Key,
      narrativeImageUrl,
      narrativePublicId,
      narrativeB2Key,
      narrativeOriginalName,
      scale: (scale || '1 cm = 2 km').trim(),
      modelSolution: modelSolutionB2Key ? '' : modelSolutionText,
      modelSolutionB2Key,
      solutions: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (!folder.gpes) folder.gpes = [];
    folder.gpes.unshift(newGpe);
    await folder.save();

    // Return the full text in the response (not the empty MongoDB field)
    const responseGpe = { ...newGpe, description: descriptionText, modelSolution: modelSolutionText };
    res.json({ success: true, message: 'GPE exercise uploaded successfully', gpe: responseGpe, folder });
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
    if (description !== undefined) {
      const newDesc = description.trim();
      if (isB2Ready() && newDesc) {
        if (gpe.descriptionB2Key) deleteFromB2(gpe.descriptionB2Key).catch(() => {});
        gpe.descriptionB2Key = await uploadTextToB2(newDesc, `gpe/text/${gpe.id}-description.txt`);
        gpe.description = '';
      } else {
        gpe.description = newDesc;
        if (gpe.descriptionB2Key) { deleteFromB2(gpe.descriptionB2Key).catch(() => {}); gpe.descriptionB2Key = null; }
      }
    }
    if (scale !== undefined) gpe.scale = scale.trim();
    if (modelSolution !== undefined) {
      const newMS = modelSolution.trim();
      if (isB2Ready() && newMS) {
        if (gpe.modelSolutionB2Key) deleteFromB2(gpe.modelSolutionB2Key).catch(() => {});
        gpe.modelSolutionB2Key = await uploadTextToB2(newMS, `gpe/text/${gpe.id}-model-solution.txt`);
        gpe.modelSolution = '';
      } else {
        gpe.modelSolution = newMS;
        if (gpe.modelSolutionB2Key) { deleteFromB2(gpe.modelSolutionB2Key).catch(() => {}); gpe.modelSolutionB2Key = null; }
      }
    }

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
        // Also upload to B2 if ready
        if (isB2Ready()) {
          try {
            const b2Res = await uploadBufferToB2(req.file.buffer, `gpe/maps/${filename}`, req.file.mimetype || 'image/jpeg');
            gpe.mapB2Key = b2Res.key;
          } catch (b2Err) { console.warn('B2 GPE map update warning:', b2Err.message); }
        }
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
    if (description !== undefined) {
      const newDesc = description.trim();
      if (isB2Ready() && newDesc) {
        if (gpe.descriptionB2Key) { deleteFromB2(gpe.descriptionB2Key).catch(() => {}); evictB2TextCache(gpe.descriptionB2Key); }
        gpe.descriptionB2Key = await uploadTextToB2(newDesc, `gpe/text/${gpe.id}-description.txt`);
        gpe.description = '';
      } else {
        gpe.description = newDesc;
        if (gpe.descriptionB2Key) { deleteFromB2(gpe.descriptionB2Key).catch(() => {}); evictB2TextCache(gpe.descriptionB2Key); gpe.descriptionB2Key = null; }
      }
    }
    if (scale !== undefined) gpe.scale = scale.trim();
    if (modelSolution !== undefined) {
      const newMS = modelSolution.trim();
      if (isB2Ready() && newMS) {
        if (gpe.modelSolutionB2Key) { deleteFromB2(gpe.modelSolutionB2Key).catch(() => {}); evictB2TextCache(gpe.modelSolutionB2Key); }
        gpe.modelSolutionB2Key = await uploadTextToB2(newMS, `gpe/text/${gpe.id}-model-solution.txt`);
        gpe.modelSolution = '';
      } else {
        gpe.modelSolution = newMS;
        if (gpe.modelSolutionB2Key) { deleteFromB2(gpe.modelSolutionB2Key).catch(() => {}); evictB2TextCache(gpe.modelSolutionB2Key); gpe.modelSolutionB2Key = null; }
      }
    }

    gpe.updatedAt = new Date();
    folder.markModified('gpes');
    await folder.save();

    const hydrated = await hydrateGpe(gpe);
    res.json({ success: true, gpe: hydrated });
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
      if (gpe.mapB2Key) deleteFromB2(gpe.mapB2Key).catch(() => {});
      if (gpe.narrativeImageUrl) await deleteStoredFile(gpe.narrativeImageUrl, gpe.narrativePublicId, 'image');
      if (gpe.narrativeB2Key) deleteFromB2(gpe.narrativeB2Key).catch(() => {});
      // Delete B2 text files
      if (gpe.descriptionB2Key) deleteFromB2(gpe.descriptionB2Key).catch(() => {});
      if (gpe.modelSolutionB2Key) deleteFromB2(gpe.modelSolutionB2Key).catch(() => {});
      if (gpe.solutions) {
        for (const sol of gpe.solutions) {
          if (sol.solutionImageUrl) await deleteStoredFile(sol.solutionImageUrl, sol.solutionPublicId, 'image');
          if (sol.solutionB2Key) deleteFromB2(sol.solutionB2Key).catch(() => {});
          if (sol.solutionTextB2Key) deleteFromB2(sol.solutionTextB2Key).catch(() => {});
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

    let solutionB2Key = null;
    if (photoFile) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(photoFile.originalname) || '.jpg';
      const filename = 'gpe-solution-' + uniqueSuffix + ext;
      fs.writeFileSync(path.join(uploadsDir, filename), photoFile.buffer);
      solutionImageUrl = `/uploads/${filename}`;
      solutionPublicId = filename;
      // Upload to B2 for persistent storage
      if (isB2Ready()) {
        try {
          const b2Res = await uploadBufferToB2(photoFile.buffer, `gpe/solutions/${filename}`, photoFile.mimetype || 'image/jpeg');
          solutionB2Key = b2Res.key;
          console.log(`🗂️  GPE solution photo uploaded to B2: ${solutionB2Key}`);
        } catch (b2Err) {
          console.warn('B2 GPE solution upload warning:', b2Err.message);
        }
      } else if (cloudinary) {
        try {
          const result = await uploadBufferToCloudinary(photoFile.buffer, photoFile.originalname, 'ssb-psych-prep/gpe/solutions', 'image');
          solutionImageUrl = result.secure_url;
          solutionPublicId = result.public_id;
        } catch (cErr) {
          console.warn('Cloudinary GPE solution upload warning:', cErr.message);
        }
      }
    }

    const gpeSolId = 'gpe-sol-' + Date.now();
    const solutionTextRaw = (solutionText || '').trim();

    // Upload solutionText to B2 to keep MongoDB document lean
    let solutionTextB2Key = null;
    if (isB2Ready() && solutionTextRaw) {
      solutionTextB2Key = await uploadTextToB2(solutionTextRaw, `gpe/text/${gpeSolId}-solution-text.txt`);
    }

    const newSolution = {
      id: gpeSolId,
      author: (author || 'Candidate').trim(),
      // Store solutionText in MongoDB only if B2 is not available
      solutionText: solutionTextB2Key ? '' : solutionTextRaw,
      solutionTextB2Key,
      solutionImageUrl,
      solutionPublicId,
      solutionB2Key,
      originalImageName,
      submittedAt: new Date()
    };

    if (!gpe.solutions) gpe.solutions = [];
    gpe.solutions.unshift(newSolution);
    folder.markModified('gpes');
    await folder.save();

    // Return full text in the response
    const responseSolution = { ...newSolution, solutionText: solutionTextRaw };
    res.json({ success: true, message: 'Solution photo uploaded and saved successfully', solution: responseSolution, gpe });
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
    if (sol) {
      if (sol.solutionImageUrl) await deleteStoredFile(sol.solutionImageUrl, sol.solutionPublicId, 'image');
      if (sol.solutionB2Key) deleteFromB2(sol.solutionB2Key).catch(() => {});
      if (sol.solutionTextB2Key) deleteFromB2(sol.solutionTextB2Key).catch(() => {});
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
  // SPA fallback — must be LAST, only for non-API and non-uploads routes
  app.get(/^(?!\/(api|uploads)).*/, (req, res) => {
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
