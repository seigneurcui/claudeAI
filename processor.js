const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const TEMP_DIR = path.join(__dirname, 'temp');
const WHISPER_MODEL_PATH = '/Users/seigneur/lavoro/subtitle/node_modules/whisper-node/whisper/models/ggml-large-v3.bin';

// Helper function to run shell commands as Promises
function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Command failed: ${command}\n${stderr}`);
        return reject(new Error(stderr));
      }
      resolve(stdout);
    });
  });
}

// 1. Extract audio from video
async function extractAudio(videoPath, progressCallback) {
  const audioFileName = `${path.basename(videoPath, path.extname(videoPath))}.wav`;
  const audioPath = path.join(TEMP_DIR, audioFileName);
  const command = `ffmpeg -i "${videoPath}" -vn -ar 16000 -ac 1 -c:a pcm_s16le "${audioPath}" -y`;
  progressCallback({ step: 'extracting_audio', progress: 0.1 });
  await runCommand(command);
  
  const stats = await fs.stat(audioPath);
  if (stats.size < 44) {
    throw new Error('Extracted audio file is empty or too small');
  }
  progressCallback({ step: 'extracting_audio', progress: 0.2 });
  return audioPath;
}

// 2. Transcribe audio to Chinese SRT
async function speechToText(audioPath, progressCallback) {
  progressCallback({ step: 'transcribing', progress: 0.3 });
  const command = `/Users/seigneur/lavoro/subtitle/node_modules/whisper-node/whisper/main -m ${WHISPER_MODEL_PATH} -f "${audioPath}" -l zh --no-gpu --output-srt`;
  const output = await runCommand(command);
  //const srtPath = audioPath.replace('.wav.srt', '.srt');
  //const srtPath = audioPath.replace('.wav', '.srt');
  const srtPath = audioPath.replace('.wav', '.wav.srt');
  
  const srtContent = await fs.readFile(srtPath, 'utf8');
  const segments = parseSrt(srtContent);
  progressCallback({ step: 'transcribing', progress: 0.4 });
  return { segments, srtPath };
}

// Parse SRT content to segments
function parseSrt(srtContent) {
  const segments = [];
  const lines = srtContent.split('\n\n').filter(line => line.trim());
  
  for (const block of lines) {
    const [index, time, ...textLines] = block.split('\n');
    const [start, end] = time.split(' --> ').map(t => parseSrtTime(t));
    const text = textLines.join(' ');
    if (!isNaN(start) && !isNaN(end) && start < end && text) {
      segments.push({ start, end, text });
    }
  }
  return segments;
}

// Parse SRT time format to seconds
function parseSrtTime(timeStr) {
  const [hours, minutes, seconds] = timeStr.replace(',', '.').split(':').map(parseFloat);
  return hours * 3600 + minutes * 60 + seconds;
}

// 3 & 4. Translate SRT to English and French
async function translateSrt(chineseSrtPath, targetLang, progressCallback) {
  progressCallback({ step: `translating_${targetLang}`, progress: 0.5 });
  const srtContent = await fs.readFile(chineseSrtPath, 'utf8');
  const segments = parseSrt(srtContent);
  
  const translatedSegments = await Promise.all(segments.map(async (segment) => {
    try {
      const response = await axios.post(
        `http://localhost:9099/translate/${targetLang}`,
        { text: segment.text },
        { timeout: 60000 }
      );
      return { ...segment, text: response.data.translated };
    } catch (error) {
      console.error(`Translation to ${targetLang} failed:`, error.message);
      return { ...segment, text: `[Translation Error: ${segment.text}]` };
    }
  }));
  
  const outputSrtPath = chineseSrtPath.replace('.srt', `.${targetLang}.srt`);
  await createSrtFile(translatedSegments, outputSrtPath);
  progressCallback({ step: `translating_${targetLang}`, progress: 0.6 });
  return outputSrtPath;
}

// Create SRT file from segments
async function createSrtFile(segments, srtPath) {
  let srtContent = '';
  segments.forEach((segment, index) => {
    srtContent += `${index + 1}\n`;
    srtContent += `${toSrtTime(segment.start)} --> ${toSrtTime(segment.end)}\n`;
    srtContent += `${segment.text}\n\n`;
  });
  await fs.writeFile(srtPath, srtContent);
}

// Convert seconds to SRT time format
function toSrtTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000).toString().padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
}

// 5. Merge subtitles into video
async function mergeSubtitles(originalVideoPath, srtFiles, outputPath, progressCallback) {
  progressCallback({ step: 'merging_subtitles', progress: 0.8 });
  const inputFiles = srtFiles.map(file => `-i "${file.path}"`).join(' ');
  const metadata = srtFiles.map((file, i) => `-metadata:s:s:${i} language=${file.langCode}`).join(' ');
  const command = `ffmpeg -i "${originalVideoPath}" ${inputFiles} -c copy -c:s mov_text ${metadata} "${outputPath}" -y`;
  await runCommand(command);
  progressCallback({ step: 'merging_subtitles', progress: 1.0 });
}

// Main processing function
async function processVideo(videoPath, progressCallback = () => {}) {
  const videoFileName = path.basename(videoPath, path.extname(videoPath));
  const outputPath = path.join(__dirname, 'videos_out', `${videoFileName}_subtitled.mp4`);
  let audioPath;
  const srtFilesToClean = [];

  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(__dirname, 'videos_out'), { recursive: true });

    // Step 1: Extract audio
    audioPath = await extractAudio(videoPath, progressCallback);

    // Step 2: Transcribe to Chinese SRT
    const { srtPath: chineseSrtPath } = await speechToText(audioPath, progressCallback);
    srtFilesToClean.push(chineseSrtPath);

    // Steps 3 & 4: Translate to English and French
    const langMetadata = { 'zh': 'chi', 'en': 'eng', 'fr': 'fra' };
    const srtPaths = [{ path: chineseSrtPath, langCode: 'chi' }];

    for (const lang of ['en', 'fr']) {
      const srtPath = await translateSrt(chineseSrtPath, lang, progressCallback);
      srtFilesToClean.push(srtPath);
      srtPaths.push({ path: srtPath, langCode: langMetadata[lang] });
    }

    // Step 5: Merge subtitles
    await mergeSubtitles(videoPath, srtPaths, outputPath, progressCallback);

    return { success: true, outputPath };
  } catch (error) {
    console.error(`Failed to process ${videoPath}:`, error);
    return { success: false, error: error.message };
  } finally {
    // Cleanup
    if (audioPath) await fs.unlink(audioPath).catch(() => {});
    for (const p of srtFilesToClean) await fs.unlink(p).catch(() => {});
  }
}

// Batch processing function
async function processVideos(videoPaths, progressCallback = () => {}) {
  const results = [];
  for (let i = 0; i < videoPaths.length; i++) {
    progressCallback({ videoIndex: i, totalVideos: videoPaths.length, step: 'starting', progress: 0 });
    const result = await processVideo(videoPaths[i], (progress) => {
      progressCallback({ videoIndex: i, totalVideos: videoPaths.length, ...progress });
    });
    results.push(result);
  }
  return results;
}

module.exports = { processVideo, processVideos };
