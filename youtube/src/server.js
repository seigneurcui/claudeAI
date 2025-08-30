const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const { authorize } = require('./auth');
const { insertUploadRecord, updateUploadRecord } = require('./db');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Initialize Express
const app = express();
app.use(cors({ origin: 'http://localhost:8077' }));
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  dest: 'videos/',
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10GB limit
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.(mp4|mov|avi)$/)) {
      return cb(new Error('Only video files (mp4, mov, avi) are allowed'));
    }
    cb(null, true);
  },
});

// Upload endpoint
app.post('/upload', upload.single('video'), async (req, res) => {
  console.log('Received upload request:', {
    title: req.body.title,
    description: req.body.description,
    fileName: req.file ? req.file.originalname : 'No file',
  });
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  const { title = 'Untitled', description = '' } = req.body;
  const fileName = req.file.originalname;
  const tempPath = req.file.path;

  try {
    const auth = await authorize();
    const youtube = google.youtube({ version: 'v3', auth });

    const fileSize = (await fs.stat(tempPath)).size;
    const recordId = await insertUploadRecord(fileName, 'pending');

    const response = await youtube.videos.insert({
      part: 'snippet,status',
      notifySubscribers: false,
      requestBody: {
        snippet: { title, description, categoryId: 22 },
        status: { privacyStatus: 'private' },
      },
      media: {
        body: fs.createReadStream(tempPath),
      },
    }, {
      onUploadProgress: async (evt) => {
        const progress = Math.round((evt.bytesRead / fileSize) * 100);
        await updateUploadRecord(recordId, 'uploading', progress);
        console.log(`Progress for ${fileName}: ${progress}%`);
      },
    });

    await updateUploadRecord(recordId, 'success', 100, response.data.id);
    await fs.unlink(tempPath); // Clean up
    res.json({ videoId: response.data.id, recordId });
  } catch (err) {
    console.error(`Upload error for ${fileName}:`, err);
    await updateUploadRecord(recordId, 'failed', 0, null, err.message);
    await fs.unlink(tempPath).catch(() => {}); // Clean up even on error
    res.status(500).json({ error: `Upload failed: ${err.message}` });
  }
});

// Progress endpoint for polling
app.get('/progress/:recordId', async (req, res) => {
  const { recordId } = req.params;
  try {
    const result = await pool.query('SELECT progress, status, error_message FROM uploads WHERE id = $1', [recordId]);
    res.json(result.rows[0] || { progress: 0, status: 'not found' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

const PORT = 8011;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
