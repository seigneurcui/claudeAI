const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { processVideos, getCompletedVideos } = require('./processor');
const morgan = require('morgan');

const app = express();
const upload = multer({ dest: 'Uploads/' });

// Configure multer to handle both files and text fields
const uploadMiddleware = upload.fields([
  { name: 'videos', maxCount: 10 },
  { name: 'subtitleSettings', maxCount: 1 }
]);

app.use(express.static('public', {
  setHeaders: (res, path) => {
    if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
  }
}));
app.use(morgan('dev'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/upload', uploadMiddleware, async (req, res) => {
  try {
    if (!req.files || !req.files.videos || req.files.videos.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    // Parse subtitle settings from form data
    let subtitleSettings = {};
    try {
      if (req.body.subtitleSettings) {
        subtitleSettings = JSON.parse(req.body.subtitleSettings);
      }
    } catch (error) {
      console.warn('Failed to parse subtitle settings:', error.message);
    }
    const videoPaths = req.files.videos.map(file => ({
      path: file.path,
      originalName: file.originalname,
      status: 'queued',
      addedAt: new Date(),
      subtitleSettings
    }));
    queue.push(...videoPaths);
    pendingFiles += videoPaths.length;
    console.log(`Queued ${videoPaths.length} videos for processing with subtitle settings:`, subtitleSettings);
    if (!isProcessing) {
      processVideosInQueue();
    }
    res.json({
      message: `Queued ${videoPaths.length} videos for processing`,
      queueLength: queue.length,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

let progressClients = [];
let queue = [];
let pendingFiles = 0;
let completedVideosCount = 0;
let isProcessing = false;
let currentProcessingFile = null;

async function processVideosInQueue() {
  if (isProcessing || queue.length === 0) {
    return;
  }
  isProcessing = true;
  console.log(`Starting queue processing. ${queue.length} videos in queue.`);
  while (queue.length > 0) {
    const video = queue.shift();
    video.status = 'processing';
    currentProcessingFile = video.originalName;
    console.log(`Processing: ${video.originalName}`);
    try {
      const result = await processVideos(
        [video.path],
        (progress) => {
          const progressData = {
            ...progress,
            currentFile: video.originalName,
            queueLength: queue.length,
          };
          progressClients.forEach(client => {
            try {
              client.write(`data: ${JSON.stringify(progressData)}\n\n`);
            } catch (error) {
              console.warn('Failed to send progress to client:', error.message);
            }
          });
        },
        [video.originalName],
        video.subtitleSettings
      );
      if (result[0].success) {
        completedVideosCount++;
        console.log(`Successfully processed: ${video.originalName}`);
      } else {
        console.error(`Failed to process: ${video.originalName} - ${result[0].error}`);
      }
      pendingFiles--;
    } catch (error) {
      console.error(`Error processing ${video.originalName}:`, error);
      pendingFiles--;
    }
    try {
      await fs.unlink(video.path);
      console.log(`Cleaned up uploaded file: ${video.path}`);
    } catch (cleanupError) {
      console.warn(`Failed to cleanup uploaded file: ${video.path}`, cleanupError.message);
    }
  }
  isProcessing = false;
  currentProcessingFile = null;
  console.log('Queue processing completed');
}

app.post('/api/process-videos', uploadMiddleware, async (req, res) => {
  req.url = '/upload';
  app._router.handle(req, res);
});

app.get('/api/process-progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control',
  });
  progressClients.push(res);
  res.write(`data: ${JSON.stringify({
    step: 'connected',
    queueLength: queue.length,
    currentFile: currentProcessingFile,
  })}\n\n`);
  req.on('close', () => {
    progressClients = progressClients.filter(client => client !== res);
  });
});

app.get('/status', (req, res) => {
  const status = {
    queue: queue.map(item => ({
      name: item.originalName,
      status: item.status,
      addedAt: item.addedAt,
    })),
    pending: pendingFiles,
    completed: completedVideosCount,
    isProcessing,
    currentFile: currentProcessingFile,
    completedVideos: getCompletedVideos(),
  };
  res.json(status);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    queue: queue.length,
    processing: isProcessing,
  });
});

app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT. Graceful shutdown...');
  progressClients.forEach(client => {
    try {
      client.end();
    } catch (error) {
      console.warn('Error closing client connection:', error.message);
    }
  });
  process.exit(0);
});

const PORT = process.env.PORT || 9088;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access the application at: http://localhost:${PORT}`);
});