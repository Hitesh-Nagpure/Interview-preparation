const mongoose = require('mongoose');

const PictureSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    default: 'Picture'
  },
  size: {
    type: Number,
    default: 0
  },
  batch: {
    type: String,
    enum: ['rewrite', 'fresh'],
    default: 'fresh'
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

const DateFolderSchema = new mongoose.Schema(
  {
    dateFolder: {
      type: String,
      required: true,
      unique: true, // e.g. "2026-09-15"
      index: true
    },
    folderTitle: {
      type: String,
      default: ''
    },
    tat: {
      title: {
        type: String,
        default: 'TAT Set'
      },
      pictures: [PictureSchema],
      hasBlankSlide: {
        type: Boolean,
        default: true
      },
      updatedAt: {
        type: Date
      }
    },
    wat: {
      title: {
        type: String,
        default: 'WAT Set'
      },
      words: [
        {
          type: String,
          trim: true
        }
      ],
      updatedAt: {
        type: Date
      }
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('DateFolder', DateFolderSchema);
