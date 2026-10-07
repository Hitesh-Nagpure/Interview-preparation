/**
 * Script to migrate existing GPE texts and Notes texts from MongoDB to Backblaze B2.
 * Leaves MongoDB documents lean, storing only metadata and B2 keys.
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { initB2, isB2Ready, uploadBufferToB2 } = require('../b2Storage');
const DateFolder = require('../models/DateFolder');

async function uploadText(text, b2Path) {
  if (!text || !text.trim()) return null;
  const buf = Buffer.from(text, 'utf8');
  const res = await uploadBufferToB2(buf, b2Path, 'text/plain; charset=utf-8');
  return res.key;
}

async function migrateTexts() {
  console.log('🚀 Starting Text Migration to Backblaze B2...');
  initB2();

  if (!isB2Ready()) {
    console.error('❌ Backblaze B2 is not ready. Please check environment variables.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const folders = await DateFolder.find();
  console.log(`📁 Scanning ${folders.length} date folders...\n`);

  let gpeMigrated = 0;
  let notesMigrated = 0;
  let candidateSolMigrated = 0;

  for (const folder of folders) {
    let modified = false;

    // 1. Migrate GPE texts
    if (folder.gpes && folder.gpes.length > 0) {
      for (const gpe of folder.gpes) {
        if (gpe.description && gpe.description.trim() && !gpe.descriptionB2Key) {
          const key = await uploadText(gpe.description, `gpe/text/${gpe.id}-description.txt`);
          if (key) {
            gpe.descriptionB2Key = key;
            gpe.description = '';
            gpeMigrated++;
            modified = true;
            console.log(`  📝 Offloaded GPE description to B2: ${key}`);
          }
        }

        if (gpe.modelSolution && gpe.modelSolution.trim() && !gpe.modelSolutionB2Key) {
          const key = await uploadText(gpe.modelSolution, `gpe/text/${gpe.id}-model-solution.txt`);
          if (key) {
            gpe.modelSolutionB2Key = key;
            gpe.modelSolution = '';
            gpeMigrated++;
            modified = true;
            console.log(`  📝 Offloaded GPE model solution to B2: ${key}`);
          }
        }

        if (gpe.solutions && gpe.solutions.length > 0) {
          for (const sol of gpe.solutions) {
            if (sol.solutionText && sol.solutionText.trim() && !sol.solutionTextB2Key) {
              const key = await uploadText(sol.solutionText, `gpe/text/${sol.id}-solution-text.txt`);
              if (key) {
                sol.solutionTextB2Key = key;
                sol.solutionText = '';
                candidateSolMigrated++;
                modified = true;
                console.log(`  📝 Offloaded candidate solution text to B2: ${key}`);
              }
            }
          }
        }
      }
      if (modified) folder.markModified('gpes');
    }

    // 2. Migrate NoteCards texts
    if (folder.noteCards && folder.noteCards.length > 0) {
      for (const nc of folder.noteCards) {
        if (nc.content && nc.content.trim() && !nc.contentB2Key) {
          const key = await uploadText(nc.content, `notes/text/${nc.id}-content.html`);
          if (key) {
            nc.contentB2Key = key;
            nc.content = '';
            notesMigrated++;
            modified = true;
            console.log(`  📋 Offloaded noteCard content to B2: ${key}`);
          }
        }
        if (nc.plainText && nc.plainText.trim() && !nc.plainTextB2Key) {
          const key = await uploadText(nc.plainText, `notes/text/${nc.id}-plain.txt`);
          if (key) {
            nc.plainTextB2Key = key;
            nc.plainText = '';
            modified = true;
          }
        }
      }
      if (modified) folder.markModified('noteCards');
    }

    // 3. Migrate legacy folder.notes
    if (folder.notes) {
      if (folder.notes.content && folder.notes.content.trim() && !folder.notes.contentB2Key) {
        const key = await uploadText(folder.notes.content, `notes/text/folder-${folder.dateFolder}-content.html`);
        if (key) {
          folder.notes.contentB2Key = key;
          folder.notes.content = '';
          notesMigrated++;
          modified = true;
          console.log(`  📋 Offloaded folder note content to B2: ${key}`);
        }
      }
      if (folder.notes.plainText && folder.notes.plainText.trim() && !folder.notes.plainTextB2Key) {
        const key = await uploadText(folder.notes.plainText, `notes/text/folder-${folder.dateFolder}-plain.txt`);
        if (key) {
          folder.notes.plainTextB2Key = key;
          folder.notes.plainText = '';
          modified = true;
        }
      }
      if (modified) folder.markModified('notes');
    }

    if (modified) {
      await folder.save();
      console.log(`💾 Saved updated folder: ${folder.dateFolder}`);
    }
  }

  console.log('\n====================================');
  console.log('🎉 Text Migration to B2 Complete!');
  console.log(`   GPE text items offloaded: ${gpeMigrated}`);
  console.log(`   Candidate solutions text offloaded: ${candidateSolMigrated}`);
  console.log(`   Note text items offloaded: ${notesMigrated}`);
  console.log('====================================');

  await mongoose.disconnect();
}

migrateTexts().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
