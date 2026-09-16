# SSB Psych Prep Platform

A full-stack psychological test preparation web application for SSB (Services Selection Board) aspirants, simulating real-time **TAT (Thematic Apperception Test)** and **WAT (Word Association Test)** protocols with exact SSB-standard timing, batch uploading, date-organized MongoDB Atlas storage, and deletion management.

---

## Features

### TAT Simulation
- **30-second** picture observation phase followed by **4-minute** story writing phase
- Chime sounds strictly upon picture/phase transition (no warning ticks)
- Supports any batch size — upload 4 pictures, test runs for exactly 4 pictures
- Optional SSB-standard blank slide at the end
- Randomly shuffled presentation

### WAT Simulation
- **15-second** continuous word flash per word
- Chime sounds strictly upon word change (no warning ticks)
- Supports any word count — upload 20 words, test runs for 20 words
- Randomly shuffled presentation

### Batch Management
- Upload TAT pictures (drag & drop, multiple files) and WAT words (text paste / .txt / .csv)
- Both TAT and WAT batches saved together inside a unified **Date Folder** (e.g. `2026-09-15`)
- **MongoDB Atlas** (`ssb_psych_prep` database) stores all batches with dates
- Delete individual TAT batch, WAT batch, or entire date folder
- Review/inspect all questions in any past date folder at any time
- One-click launch test from any saved date folder

---

## Project Structure

```
SSB Prep/
├── server/
│   ├── models/
│   │   └── DateFolder.js    # Mongoose schema
│   └── server.js            # Express REST API + MongoDB
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   ├── DateFoldersView.jsx
│   │   │   ├── UploadView.jsx
│   │   │   └── TestSimulator.jsx
│   │   ├── utils/
│   │   │   └── audio.js     # Web Audio API chime engine
│   │   ├── App.jsx
│   │   └── index.css
│   ├── tailwind.config.js
│   └── vite.config.js
├── uploads/                 # Uploaded TAT picture files
├── package.json             # Root (server dependencies)
└── atlas-credentials.env    # MongoDB Atlas credentials (DO NOT COMMIT)
```

---

## Running the App

### Development Mode (2 terminals)

**Terminal 1 — Backend API:**
```bash
node server/server.js
```
Backend runs at `http://localhost:5000`

**Terminal 2 — Frontend Dev Server:**
```bash
cd client
npm run dev
```
Frontend runs at `http://localhost:3000` (with API proxy to :5000)

### Production Mode (single server)

The server automatically serves the built frontend from `client/dist`:
```bash
cd client
npm run build
cd ..
node server/server.js
```
Open `http://localhost:5000`

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | MongoDB connection status |
| GET | `/api/folders` | List all date folders (with summary) |
| GET | `/api/folders/:dateFolder` | Full folder with TAT pictures & WAT words |
| POST | `/api/folders/:dateFolder/tat` | Upload TAT pictures (multipart/form-data) |
| POST | `/api/folders/:dateFolder/wat` | Upload WAT words (JSON) |
| DELETE | `/api/folders/:dateFolder` | Delete entire date folder |
| DELETE | `/api/folders/:dateFolder/tat` | Clear TAT batch |
| DELETE | `/api/folders/:dateFolder/wat` | Clear WAT batch |
| DELETE | `/api/folders/:dateFolder/tat/:pictureId` | Delete single picture |

---

## SSB Psych Protocol Reference

| Test | Observation | Writing | Order | Standard Count |
|------|------------|---------|-------|----------------|
| TAT  | 30 seconds | 4 minutes per picture | Random | 12 (11 + 1 blank) |
| WAT  | 15 seconds continuous | On paper | Random | 60 words |

> **Note:** This app dynamically adapts to any batch size you upload. If you upload 4 pictures, the TAT runs for exactly 4 cycles of 30s + 4m.
