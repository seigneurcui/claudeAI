const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { processVideos } = require('./processor');
const morgan = require('morgan');

const app = express();
const upload = multer({ dest: 'uploads/' });
let progressClients = [];
let queue = [];
let pendingFiles = 0;
let completedVideos = 0;

app.use(express.static('public'));
app.use(morgan('dev'));

app.post('/upload', upload.array('videos'), async (req, res) => {
  const videoPaths = req.files.map(file => file.path);
  queue.push(...videoPaths.map(path => ({ path, status: 'queued' })));
  pendingFiles += videoPaths.length;
  processVideosInQueue();
  res.json({ message: `Queued ${videoPaths.length} videos for processing` });
});

async function processVideosInQueue() {
  while (queue.length > 0) {
    const video = queue.shift();
    video.status = 'processing';
    try {
      const result = await processVideos([video.path], (progress) => {
        progressClients.forEach(client => client.write(`data: ${JSON.stringify(progress)}\n\n`));
      });
      if (result[0].success) {
        completedVideos++;
      }
      pendingFiles--;
    } catch (error) {
      console.error(`Error processing ${video.path}:`, error);
      pendingFiles--;
    }
    await fs.unlink(video.path).catch(() => {});
  }
}

app.post('/api/process-videos', upload.array('videos'), async (req, res) => {
  const videoPaths = req.files.map(file => file.path);
  queue.push(...videoPaths.map(path => ({ path, status: 'queued' })));
  pendingFiles += videoPaths.length;
  processVideosInQueue();
  res.json({ message: `Queued ${videoPaths.length} videos for processing` });
});

app.get('/api/process-progress', (req, res) => {
  res.writeHead({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  progressClients.push(res);
  req.on('close', () => {
    progressClients = progressClients.filter(client => client !== res);
  });
});

app.get('/status', (req, res) => {
  res.json({
    queue: queue,
    pending: pendingFiles,
    completed: completedVideos
  });
});

app.listen(3000, () => console.log('Server running on port 3000'));
