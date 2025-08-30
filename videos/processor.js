const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const { Converter } = require('opencc-js');
const axios = require('axios');

const execPromise = util.promisify(exec);
const TEMP_DIR = path.join(__dirname, 'temp');
const WHISPER_MODEL_PATH = '/Users/seigneur/lavoro/subtitle/node_modules/whisper-node/whisper/models/ggml-large-v3.bin';

// Store completed videos information
const completedVideos = [];

// Configuration for translation service
const TRANSLATION_CONFIG = {
  baseURL: 'http://localhost:9099',
  timeout: 120000,
  maxRetries: 3,
  retryDelay: 2000,
};

// Initialize opencc-js for Simplified to Traditional Chinese conversion
const converter = Converter({ from: 'cn', to: 'tw' });

async function runCommand(command) {
  try {
    const { stdout, stderr } = await execPromise(command);
    if (stderr) {
      console.error(`Command stderr: ${stderr}`);
    }
    return stdout.trim();
  } catch (error) {
    console.error(`❌ Command failed: ${command}`);
    throw new Error(error.message);
  }
}

async function getVideoMetadata(videoPath) {
  try {
    console.log('🔍 Extracting video metadata...');
    const command = `ffprobe -v quiet -print_format json -show_streams -show_format "${videoPath}"`;
    const output = await runCommand(command);
    const data = JSON.parse(output);
    const videoStream = data.streams.find(stream => stream.codec_type === 'video');
    if (!videoStream) {
      throw new Error('No video stream found in input');
    }
    const { width, height } = videoStream;
    const format = data.format.format_name.includes('mov') ? 'mov' : data.format.format_name.includes('mp4') ? 'mp4' : 'mp4';
    console.log(`📊 Video metadata: Resolution=${width}x${height}, Format=${format}`);
    return { width, height, format };
  } catch (error) {
    console.error('❌ Failed to extract video metadata:', error.message);
    throw error;
  }
}

async function checkTranslationService() {
  try {
    console.log('🔍 Checking FastAPI translation service...');
    const command = `curl --silent -X GET ${TRANSLATION_CONFIG.baseURL}/health`;
    const output = await runCommand(command);
    const response = JSON.parse(output);
    const serviceStatus = response.service_status?.status;
    console.log('📊 Service status:', serviceStatus);
    return serviceStatus === 'ready' || serviceStatus === 'partial';
  } catch (error) {
    console.warn('⚠️ Translation service check failed:', error.message);
    return false;
  }
}

async function translateText(text, targetLang, retryCount = 0) {
  try {
    const startTime = Date.now();
    console.log(`🔤 Translating to ${targetLang}: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`);
    const escapedText = text.replace(/"/g, '\\"').replace(/\n/g, ' ');
    const command = `curl --silent -X POST -H "Content-Type: application/json" -d '{"text":"${escapedText}"}' ${TRANSLATION_CONFIG.baseURL}/translate/${targetLang}`;
    const output = await runCommand(command);
    let translatedText;
    try {
      const result = JSON.parse(output);
      translatedText = result.translated || result.text || output;
    } catch (parseError) {
      console.warn(`JSON parse error for "${text}" (${targetLang}):`, parseError.message);
      translatedText = output;
    }
    const duration = Date.now() - startTime;
    console.log(`✅ Translation completed in ${duration}ms: "${translatedText}"`);
    return translatedText;
  } catch (error) {
    console.error(`❌ Translation failed (attempt ${retryCount + 1}/${TRANSLATION_CONFIG.maxRetries}): ${error.message}`);
    if (retryCount < TRANSLATION_CONFIG.maxRetries - 1) {
      const delayMs = TRANSLATION_CONFIG.retryDelay * (retryCount + 1);
      console.log(`⏳ Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return translateText(text, targetLang, retryCount + 1);
    }
    console.warn(`⚠️ All retries failed for: "${text}"`);
    return `[Translation Failed: ${text}]`;
  }
}

async function translateSegmentsBatch(segments, targetLang, progressCallback) {
  const results = [];
  const total = segments.length;
  console.log(`\n🌍 Starting ${targetLang.toUpperCase()} translation for ${total} segments...`);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const translatedText = await translateText(segment.text, targetLang);
    results.push({ ...segment, text: translatedText });
    const progress = 0.6 + ((i + 1) / total) * 0.2;
    progressCallback({ step: `translating_${targetLang}`, progress });
    if ((i + 1) % 5 === 0 && i < segments.length - 1) {
      console.log(`⏳ Processed ${i + 1}/${total} segments, brief pause...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  const successful = results.filter(r => !r.text.startsWith('[Translation Failed:')).length;
  console.log(`📊 Translation completed: ${successful}/${total} successful`);
  return results;
}

async function extractAudio(videoPath, progressCallback) {
  const audioFileName = `${path.basename(videoPath, path.extname(videoPath))}.wav`;
  const audioPath = path.join(TEMP_DIR, audioFileName);
  const command = `ffmpeg -i "${videoPath}" -vn -ar 16000 -ac 1 -c:a pcm_s16le "${audioPath}" -y`;
  console.log('🔧 Extracting audio with command:', command);
  progressCallback({ step: 'extracting_audio', progress: 0.1 });
  await runCommand(command);
  const stats = await fs.stat(audioPath);
  console.log(`📊 Audio extracted: ${stats.size} bytes`);
  if (stats.size < 44) {
    throw new Error('Extracted audio file is empty or too small');
  }
  progressCallback({ step: 'extracting_audio', progress: 0.2 });
  return audioPath;
}

async function speechToText(audioPath, progressCallback) {
  progressCallback({ step: 'transcribing', progress: 0.3 });
  const command = `/Users/seigneur/lavoro/subtitle/node_modules/whisper-node/whisper/main -m ${WHISPER_MODEL_PATH} -f "${audioPath}" -l zh --no-gpu --output-srt`;
  console.log('🔧 Whisper command:', command);
  await runCommand(command);
  const srtPath = audioPath.replace('.wav', '.wav.srt');
  try {
    const srtStats = await fs.stat(srtPath);
    console.log(`📄 SRT file generated: ${srtStats.size} bytes`);
  } catch (error) {
    throw new Error(`SRT file not generated: ${srtPath}`);
  }
  let srtContent = await fs.readFile(srtPath, 'utf8');
  console.log('📝 Original SRT content preview:', srtContent.substring(0, 200) + (srtContent.length > 200 ? '...' : ''));
  try {
    console.log('🔄 Converting Simplified Chinese to Traditional Chinese...');
    srtContent = converter(srtContent);
    console.log('📝 Converted Traditional Chinese SRT content preview:', srtContent.substring(0, 200) + (srtContent.length > 200 ? '...' : ''));
    await fs.writeFile(srtPath, srtContent);
    console.log('📝 Updated SRT file with Traditional Chinese');
  } catch (error) {
    console.error('❌ Failed to convert to Traditional Chinese:', error.message);
    throw new Error('SRT conversion to Traditional Chinese failed');
  }
  const segments = parseSrt(srtContent);
  console.log(`📊 Transcription completed: ${segments.length} segments`);
  progressCallback({ step: 'transcribing', progress: 0.4 });
  return { segments, srtPath };
}

function parseSrt(srtContent) {
  const segments = [];
  const lines = srtContent.split('\n\n').filter(line => line.trim());
  for (const block of lines) {
    const blockLines = block.split('\n');
    if (blockLines.length < 3) continue;
    const [index, time, ...textLines] = blockLines;
    if (!time || !time.includes('-->')) continue;
    const [start, end] = time.split(' --> ').map(t => parseSrtTime(t));
    const text = textLines.join(' ').trim();
    if (!isNaN(start) && !isNaN(end) && start < end && text) {
      segments.push({ start, end, text });
    }
  }
  return segments;
}

function parseSrtTime(timeStr) {
  try {
    const [hours, minutes, seconds] = timeStr.replace(',', '.').split(':').map(parseFloat);
    return hours * 3600 + minutes * 60 + seconds;
  } catch (error) {
    console.error('Error parsing SRT time:', timeStr);
    return 0;
  }
}

async function translateSrt(chineseSrtPath, targetLang, progressCallback) {
  progressCallback({ step: `translating_${targetLang}`, progress: 0.5 });
  const srtContent = await fs.readFile(chineseSrtPath, 'utf8');
  const segments = parseSrt(srtContent);
  if (segments.length === 0) {
    console.warn('❌ No segments found in SRT file');
    return null;
  }
  console.log(`\n🔄 Starting translation to ${targetLang.toUpperCase()} for ${segments.length} segments...`);
  const translatedSegments = await translateSegmentsBatch(segments, targetLang, progressCallback);
  const successfulTranslations = translatedSegments.filter(seg => !seg.text.startsWith('[Translation Failed:')).length;
  if (successfulTranslations.length === 0) {
    console.error(`❌ All translations failed for ${targetLang}`);
    return null;
  }
  if (successfulTranslations.length < segments.length) {
    console.warn(`⚠️ ${segments.length - successfulTranslations.length} translations failed for ${targetLang}`);
  }
  const outputSrtPath = chineseSrtPath.replace('.srt', `.${targetLang}.srt`);
  await createSrtFile(translatedSegments, outputSrtPath);
  const outputStats = await fs.stat(outputSrtPath);
  console.log(`📄 Generated ${targetLang.toUpperCase()} SRT: ${outputStats.size} bytes`);
  progressCallback({ step: `translating_${targetLang}`, progress: 0.8 });
  return outputSrtPath;
}

async function createSrtFile(segments, srtPath) {
  let srtContent = '';
  segments.forEach((segment, index) => {
    srtContent += `${index + 1}\n`;
    srtContent += `${toSrtTime(segment.start)} --> ${toSrtTime(segment.end)}\n`;
    srtContent += `${segment.text}\n\n`;
  });
  await fs.writeFile(srtPath, srtContent);
  console.log(`📝 SRT file written: ${path.basename(srtPath)} (${srtContent.length} chars)`);
}

function toSrtTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000).toString().padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
}

async function convertSrtToAss(srtPath, lang, subtitleSettings, width, height, index) {
  console.log(`🔄 Converting SRT to ASS for ${lang} with settings:`, subtitleSettings[lang]);
  const assPath = srtPath.replace('.srt', '.ass');
  const srtContent = await fs.readFile(srtPath, 'utf8');
  const segments = parseSrt(srtContent);

  // Use subtitle settings or defaults
  const fontName = subtitleSettings[lang]?.font || (lang === 'zh' ? 'Noto Sans TC' : 'Arial');
  const fontSize = subtitleSettings[lang]?.size || (lang === 'zh' ? 24 : 20);
  const color = subtitleSettings[lang]?.color || (lang === 'zh' ? '&H00FFFF00' : lang === 'en' ? '&H00FFFFFF' : '&H0000FFFF');
  // Calculate vertical margin based on order index (top-to-bottom)
  const marginV = subtitleSettings[lang]?.marginV || (height - 50 - index * 40); // Dynamic margin based on order

  let assContent = `[Script Info]
Title: ${lang} Subtitles
ScriptType: v4.00+
Collisions: Normal
PlayResX: ${width}
PlayResY: ${height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${color},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,2,2,10,10,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  segments.forEach((segment, index) => {
    const start = toAssTime(segment.start);
    const end = toAssTime(segment.end);
    const text = segment.text.replace(/\n/g, '\\N').replace(/"/g, '\\"');
    assContent += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
  });
  await fs.writeFile(assPath, assContent);
  console.log(`📝 ASS file written for ${lang}: ${path.basename(assPath)} with font=${fontName}, size=${fontSize}, color=${color}, marginV=${marginV}`);
  return assPath;
}

function toAssTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(1, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const cs = Math.round((seconds - Math.floor(seconds)) * 100).toString().padStart(2, '0');
  return `${h}:${m}:${s}.${cs}`;
}

async function mergeSubtitles(originalVideoPath, srtFiles, outputPath, videoMetadata, progressCallback, subtitleSettings) {
  progressCallback({ step: 'merging_subtitles', progress: 0.85 });
  const validSrtFiles = srtFiles.filter(file => file && file.path);
  if (validSrtFiles.length === 0) {
    console.warn('❌ No valid subtitle files to merge');
    await runCommand(`ffmpeg -i "${originalVideoPath}" -c copy "${outputPath}" -y`);
    progressCallback({ step: 'merging_subtitles', progress: 1.0 });
    return;
  }
  console.log(`🎬 Preparing to merge ${validSrtFiles.length} subtitle tracks into video...`);
  for (const srtFile of validSrtFiles) {
    try {
      const stats = await fs.stat(srtFile.path);
      const content = await fs.readFile(srtFile.path, 'utf8');
      const segments = content.split('\n\n').filter(line => line.trim()).length;
      console.log(`📄 SRT ${srtFile.langCode}: ${stats.size} bytes, ${segments} segments`);
      console.log(`   Preview: ${content.substring(0, 100)}...`);
    } catch (error) {
      console.error(`❌ Cannot access SRT file ${srtFile.langCode}:`, error.message);
      throw error;
    }
  }
  try {
    // Use subtitle order from settings or default
    const subtitleOrder = subtitleSettings.order || ['en', 'zh', 'fr'];
    console.log('📋 Subtitle order:', subtitleOrder);
    const orderedSrtFiles = [];
    for (const lang of subtitleOrder) {
      const srtFile = validSrtFiles.find(file => file.langCode === lang);
      if (srtFile) {
        orderedSrtFiles.push(srtFile);
      }
    }

    // Convert SRT to ASS with custom settings
    const assFiles = [];
    for (const [index, srtFile] of orderedSrtFiles.entries()) {
      const lang = srtFile.langCode;
      const assPath = await convertSrtToAss(srtFile.path, lang, subtitleSettings, videoMetadata.width, videoMetadata.height, index);
      assFiles.push({ path: assPath, langCode: lang });
    }

    // Build FFmpeg complex filtergraph for sequential overlay
    let filterComplex = '';
    let inputLabel = '[0:v]';
    assFiles.forEach((file, i) => {
      const escapedPath = file.path.replace(/\\/g, '/').replace(/:/g, '\\:');
      const outputLabel = `[v${i}]`;
      filterComplex += `${inputLabel}ass=${escapedPath}${outputLabel};`;
      inputLabel = outputLabel;
    });
    filterComplex = filterComplex.slice(0, -1);
    const command = `ffmpeg -i "${originalVideoPath}" -filter_complex "${filterComplex}" -map "${inputLabel}" -map 0:a -c:v libx264 -crf 10 -b:v 9865k -preset medium -profile:v main -c:a copy "${outputPath}" -y`;
    console.log('🔧 FFmpeg command:', command);
    await runCommand(command);
    // Clean up ASS files
    for (const assFile of assFiles) {
      await fs.unlink(assFile.path);
      console.log(`🧹 Cleaned ASS: ${path.basename(assFile.path)}`);
    }
    await verifySubtitleEmbedding(outputPath);
  } catch (error) {
    console.error('❌ Subtitle burning failed:', error.message);
    console.log('\n🔄 Fallback: Copying video without subtitles...');
    await runCommand(`ffmpeg -i "${originalVideoPath}" -c copy "${outputPath}" -y`);
  }
  progressCallback({ step: 'merging_subtitles', progress: 1.0 });
}

async function verifySubtitleEmbedding(videoPath) {
  try {
    console.log('🔍 Verifying video output...');
    const verifyCommand = `ffprobe -v quiet -print_format json -show_streams "${videoPath}"`;
    const probeOutput = await runCommand(verifyCommand);
    const streams = JSON.parse(probeOutput).streams;
    const videoStreams = streams.filter(s => s.codec_type === 'video');
    const audioStreams = streams.filter(s => s.codec_type === 'audio');
    console.log(`📊 Output video analysis:`);
    console.log(`   Video streams: ${videoStreams.length}`);
    console.log(`   Audio streams: ${audioStreams.length}`);
    console.log(`   Resolution: ${videoStreams[0].width}x${videoStreams[0].height}`);
    console.log(`   Video bitrate: ${videoStreams[0].bit_rate ? videoStreams[0].bit_rate + ' bits/s' : 'N/A'}`);
    console.log(`   H.264 Profile: ${videoStreams[0].profile || 'N/A'}`);
    const stats = await fs.stat(videoPath);
    console.log(`📁 Final output: ${stats.size} bytes (~${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  } catch (error) {
    console.warn('⚠️ Could not verify output:', error.message);
  }
}

async function sendNotifications(videoFileName, originalFileName, outputPath, duration) {
  console.log(`📢 Sending notifications for: ${videoFileName}`);
  const notifications = [
    {
      name: 'WxPusher',
      url: 'https://wxpusher.zjiecode.com/api/send/message',
      headers: { 'Content-Type': 'application/json' },
      data: {
        appToken: 'AT_byimkOmi7B0xzvqEvXVYIAj0YkMrwDvV',
        content: `视频转换完毕: ${originalFileName} ==> ${videoFileName} : ${duration}`,
        summary: '视频转换完毕',
        contentType: 2,
        topicIds: [36095],
        uids: ['UID_FD24Cus5ocGO5CKQAcxkw8gP2ZRu'],
        verifyPay: false,
        verifyPayType: 0,
      },
    },
    {
      name: 'PushPlus',
      url: 'http://www.pushplus.plus/send',
      headers: { 'Content-Type': 'application/json' },
      data: {
        token: 'f76bf4e54490439c86fdae45e9db76ce',
        title: '视频转换完毕',
        content: `视频转换完毕: ${originalFileName} ==> ${videoFileName} : ${duration}`,
      },
    },
    {
      name: 'Resend Email',
      url: 'https://api.resend.com/emails',
      headers: {
        'Authorization': 'Bearer re_KwMt5gij_5c7XvcqJeNjmAhV3cy1DAvfj',
        'Content-Type': 'application/json',
      },
      data: {
        from: 'onboarding@resend.dev',
        to: 'seigneurtsui@goallez.dpdns.org',
        subject: '视频转换完毕',
        html: `<p>视频转换完毕: ${originalFileName} ==> ${videoFileName} : ${duration}</p>`,
      },
    },
    {
      name: 'Telegram',
      url: `https://api.telegram.org/bot8371556252:AAHUpvXA_73QYDsNbmMWiqG2SOKTKzzOY_Y/sendMessage`,
      headers: { 'Content-Type': 'application/json' },
      data: {
        chat_id: '8200348152',
        text: `视频转换完毕: ${originalFileName} ==> ${videoFileName} : ${duration}`,
      },
    },
  ];

  for (const notification of notifications) {
    try {
      const response = await axios.post(notification.url, notification.data, {
        headers: notification.headers,
      });
      console.log(`✅ ${notification.name} notification sent successfully:`, response.status);
    } catch (error) {
      console.error(`❌ Failed to send ${notification.name} notification:`, error.message);
    }
  }
}

async function processVideo(videoPath, progressCallback = () => {}, originalFileName, subtitleSettings = {}) {
  const startTime = Date.now();
  const videoFileName = path.basename(videoPath, path.extname(videoPath));
  const videoMetadata = await getVideoMetadata(videoPath);
  const outputPath = path.join(__dirname, 'videos_out', `${videoFileName}_subtitled.${videoMetadata.format}`);
  let audioPath;
  const srtFilesToClean = [];
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(__dirname, 'videos_out'), { recursive: true });
    console.log(`\n🎬 Starting processing for: ${videoFileName}`);
    console.log('📋 Subtitle settings received:', subtitleSettings);
    console.log('='.repeat(80));
    console.log('📢 Step 1: Extracting audio from video...');
    audioPath = await extractAudio(videoPath, progressCallback);
    console.log('🎙️ Step 2: Transcribing audio to Chinese subtitles...');
    const { srtPath: chineseSrtPath } = await speechToText(audioPath, progressCallback);
    srtFilesToClean.push(chineseSrtPath);
    console.log('🌍 Step 3-4: Translating subtitles...');
    const langMetadata = { 'zh-tw': 'zh', en: 'en', fr: 'fr' };
    const srtPaths = [{ path: chineseSrtPath, langCode: 'zh' }];
    const serviceAvailable = await checkTranslationService();
    if (serviceAvailable) {
      console.log('✅ Translation service is available, proceeding with AI translation...');
      for (const lang of ['en', 'fr']) {
        try {
          console.log(`\n🔄 Attempting ${lang.toUpperCase()} translation...`);
          const srtPath = await translateSrt(chineseSrtPath, lang, progressCallback);
          if (srtPath) {
            srtFilesToClean.push(srtPath);
            srtPaths.push({ path: srtPath, langCode: langMetadata[lang] });
            console.log(`✅ Successfully added ${lang.toUpperCase()} subtitles`);
          } else {
            console.warn(`⚠️ Translation to ${lang} returned null, skipping`);
          }
        } catch (error) {
          console.error(`❌ Failed to translate to ${lang}:`, error.message);
        }
      }
    } else {
      console.warn('⚠️ Translation service not available');
      console.log('💡 To enable translations, start the FastAPI service:');
      console.log('   python translation_service.py');
      console.log('📱 Proceeding with Traditional Chinese subtitles only...');
    }
    console.log(`\n🎬 Step 5: Merging ${srtPaths.length} subtitle tracks into video...`);
    console.log('📋 Subtitle files to merge:');
    srtPaths.forEach((srt, i) => {
      console.log(`   ${i + 1}. ${srt.langCode}: ${srt.path}`);
    });
    await mergeSubtitles(videoPath, srtPaths, outputPath, videoMetadata, progressCallback, subtitleSettings);
    const finalSubtitleCount = srtPaths.length;
    const languages = srtPaths.map(s => s.langCode);
    const duration = (Date.now() - startTime) / 1000;
    console.log(`\n🎉 Processing completed for: ${videoFileName}`);
    console.log(`   📊 Subtitle tracks: ${finalSubtitleCount} (${languages.join(', ')})`);
    console.log(`   📁 Output file: ${outputPath}`);
    console.log(`   ⏱️ Duration: ${duration.toFixed(2)} seconds`);
    console.log('='.repeat(80));
    completedVideos.push({
      originalFile: originalFileName || path.basename(videoPath),
      newFile: path.basename(outputPath),
      duration,
    });
    await sendNotifications(videoFileName, originalFileName, outputPath, duration);
    return {
      success: true,
      outputPath,
      subtitleCount: finalSubtitleCount,
      languages,
      duration,
    };
  } catch (error) {
    console.error(`💥 Processing failed for ${videoPath}:`, error);
    return { success: false, error: error.message };
  } finally {
    console.log('\n🧹 Cleaning up temporary files...');
    if (audioPath) {
      try {
        await fs.unlink(audioPath);
        console.log(`   ✅ Cleaned audio: ${path.basename(audioPath)}`);
      } catch (cleanupError) {
        console.warn(`   ⚠️ Failed to cleanup audio: ${cleanupError.message}`);
      }
    }
    for (const p of srtFilesToClean) {
      try {
        await fs.unlink(p);
        console.log(`   ✅ Cleaned SRT: ${path.basename(p)}`);
      } catch (cleanupError) {
        console.warn(`   ⚠️ Failed to cleanup SRT: ${cleanupError.message}`);
      }
    }
    console.log('🧹 Cleanup completed');
  }
}

async function processVideos(videoPaths, progressCallback = () => {}, originalFileNames = [], subtitleSettings = {}) {
  const results = [];
  console.log(`\n🚀 Starting batch processing for ${videoPaths.length} videos with subtitle settings:`, subtitleSettings);
  for (let i = 0; i < videoPaths.length; i++) {
    const videoName = path.basename(videoPaths[i]);
    console.log(`\n📹 Processing video ${i + 1}/${videoPaths.length}: ${videoName}`);
    progressCallback({ videoIndex: i, totalVideos: videoPaths.length, step: 'starting', progress: 0, queueLength: videoPaths.length - i - 1 });
    const result = await processVideo(videoPaths[i], (progress) => {
      progressCallback({ videoIndex: i, totalVideos: videoPaths.length, ...progress });
    }, originalFileNames[i] || videoName, subtitleSettings);
    results.push(result);
    if (result.success) {
      console.log(`✅ Video ${i + 1} completed successfully`);
      console.log(`   📊 Languages: ${result.languages.join(', ')}`);
      console.log(`   📁 Output: ${result.outputPath}`);
      console.log(`   ⏱️ Duration: ${result.duration.toFixed(2)} seconds`);
    } else {
      console.log(`❌ Video ${i + 1} failed: ${result.error}`);
    }
  }
  console.log(`\n📊 Batch processing summary:`);
  console.log(`   Total videos: ${results.length}`);
  console.log(`   Successful: ${results.filter(r => r.success).length}`);
  console.log(`   Failed: ${results.filter(r => !r.success).length}`);
  console.log(`   Total subtitle tracks: ${results.reduce((sum, r) => sum + (r.subtitleCount || 0), 0)}`);
  return results;
}

function getCompletedVideos() {
  return completedVideos;
}

module.exports = { processVideo, processVideos, getCompletedVideos };
