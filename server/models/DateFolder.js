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

const SolutionSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  solutionDate: {
    type: String, // Editable date of the solution, e.g. "2026-09-21"
    required: true,
    default: () => new Date().toISOString().split('T')[0]
  },
  title: {
    type: String,
    default: function() {
      return this.solutionDate || new Date().toISOString().split('T')[0];
    }
  },
  testType: {
    type: String,
    enum: ['TAT', 'WAT', 'GENERAL', 'SRT', 'SDT'],
    default: 'TAT'
  },
  url: {
    type: String,
    required: true
  },
  cloudinaryUrl: {
    type: String
  },
  localPath: {
    type: String
  },
  publicId: {
    type: String
  },
  originalName: {
    type: String,
    default: 'Solution.pdf'
  },
  size: {
    type: Number,
    default: 0
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

const LecturetteSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  title: {
    type: String,
    default: 'Lecturette Recording'
  },
  duration: {
    type: Number, // duration in seconds (tracked in background)
    default: 0
  },
  url: {
    type: String,
    required: true
  },
  publicId: {
    type: String
  },
  recordedDate: {
    type: String,
    default: ''
  },
  recordedAt: {
    type: Date,
    default: Date.now
  }
});

const ReviewSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  title: {
    type: String,
    default: 'Audio Review'
  },
  duration: {
    type: Number,
    default: 0
  },
  url: {
    type: String,
    required: true
  },
  publicId: {
    type: String,
    default: ''
  },
  reviewerName: {
    type: String,
    default: ''
  },
  recordedAt: {
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
    },
    solutions: [SolutionSchema],
    lecturettes: [LecturetteSchema],
    reviews: [ReviewSchema],
    notes: {
      content: {
        type: String,
        default: ''
      },
      plainText: {
        type: String,
        default: ''
      },
      author: {
        type: String,
        default: ''
      },
      updatedAt: {
        type: Date,
        default: null
      }
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('DateFolder', DateFolderSchema);
