const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { authorize } = require('./auth');
const { insertUploadRecord, updateUploadRecord } = require('./db');

async function uploadVideo(videoBuffer, fileName, title, description) {
  const auth = await authorize();
  const youtube = google.youtube({ version: 'v3', auth });

  // Save buffer to temporary file
  const tempPath = path.join(__dirname, '../videos', fileName);
  fs.writeFileSync(tempPath, videoBuffer);

  const fileSize = fs.statSync(tempPath).size;
  const recordId = await insertUploadRecord(fileName, 'pending');

  try {
    const res = await youtube.videos.insert({
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
      },
    });

    await updateUploadRecord(recordId, 'success', 100, res.data.id);
    fs.unlinkSync(tempPath);
    return { videoId: res.data.id };
  } catch (err) {
    await updateUploadRecord(recordId, 'failed', 0, null, err.message);
    fs.unlinkSync(tempPath);
    throw err;
  }
}

module.exports = { uploadVideo };
