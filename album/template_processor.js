const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const { Converter } = require('opencc-js');
const axios = require('axios');

const execPromise = util.promisify(exec);
const TEMP_DIR = path.join(__dirname, 'temp');
const FONTS_DIR = path.join(__dirname, 'fonts');
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

// Initialize opencc-js converters
const cnToTwConverter = Converter({ from: 'cn', to: 'tw' });
const twToCnConverter = Converter({ from: 'tw', to: 'cn' });

// Language configuration - UPDATED
const LANGUAGE_CONFIG = {
  'zh-tw': { 
    whisperLang: 'zh',
    needsTranslation: false,
    converter: null,
    displayName: 'Traditional Chinese'
  },
  'zh-cn': { 
    whisperLang: 'zh',
    needsTranslation: false,
    converter: twToCnConverter,
    displayName: 'Simplified Chinese'
  },
  'en': { 
    whisperLang: 'zh',
    needsTranslation: true,
    converter: null,
    displayName: 'English'
  },
  'fr': { 
    whisperLang: 'zh',
    needsTranslation: true,
    converter: null,
    displayName: 'French'
  }
};

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

async function getAvailableFonts() {
  try {
    await fs.mkdir(FONTS_DIR, { recursive: true });
    const fontFiles = await fs.readdir(FONTS_DIR);
    const fonts = [];
    
    // Add default system fonts
    const defaultFonts = [
      'Arial', 'Times New Roman', 'Helvetica', 'Georgia', 'Verdana',
      'Noto Sans TC', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR',
      'Noto Sans Devanagari', 'Noto Sans Thai'
    ];
    
    defaultFonts.forEach(font => {
      fonts.push({ name: font, type: 'system', path: null });
    });
    
    // Add custom fonts from fonts directory
    for (const file of fontFiles) {
      const ext = path.extname(file).toLowerCase();
      if (['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) {
        const fontName = path.basename(file, ext);
        const fontPath = path.join(FONTS_DIR, file);
        fonts.push({ 
          name: fontName, 
          type: 'custom', 
          path: fontPath,
          filename: file
        });
      }
    }
    
    console.log(`📚 Found ${fonts.length} available fonts (${fonts.filter(f => f.type === 'custom').length} custom)`);
    return fonts;
  } catch (error) {
    console.error('❌ Failed to get available fonts:', error.message);
    return [];
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
  
  // Convert to Traditional Chinese
  try {
    console.log('🔄 Converting Simplified Chinese to Traditional Chinese...');
    srtContent = cnToTwConverter(srtContent);
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

async function generateLanguageSubtitles(originalSegments, targetLang, progressCallback) {
  const langConfig = LANGUAGE_CONFIG[targetLang];
  if (!langConfig) {
    throw new Error(`Unsupported language: ${targetLang}`);
  }

  let resultSegments = [...originalSegments]; // Create a copy

  // Apply text conversion if needed (for zh-cn)
  if (langConfig.converter) {
    console.log(`🔄 Converting text for ${langConfig.displayName}...`);
    resultSegments = originalSegments.map(segment => ({
      ...segment,
      text: langConfig.converter(segment.text)
    }));
    console.log(`✅ Text conversion completed for ${langConfig.displayName}`);
  }

  // Apply translation if needed (for en, fr)
  if (langConfig.needsTranslation) {
    console.log(`🌍 Translating to ${langConfig.displayName}...`);
    const translationLang = targetLang === 'zh-cn' ? 'cn' : targetLang;
    resultSegments = await translateSegmentsBatch(resultSegments, translationLang, progressCallback);
  }

  return resultSegments;
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

async function convertSrtToAss(srtPath, lang, subtitleConfig, width, height, positionIndex, totalAtPosition) {
  console.log(`🔄 Converting SRT to ASS for ${lang} with config:`, subtitleConfig);
  const assPath = srtPath.replace('.srt', '.ass');
  const srtContent = await fs.readFile(srtPath, 'utf8');
  const segments = parseSrt(srtContent);

  const fontName = subtitleConfig.font || 'Arial';
  const fontSize = subtitleConfig.size || 20;
  const color = subtitleConfig.color ? subtitleConfig.color.replace('#', '&H00') + '&' : '&H00FFFFFF&';
  const position = subtitleConfig.position || 'top';
  const margin = subtitleConfig.margin || 30;

  // Calculate vertical margin based on position, order, and custom margin
  let marginV;
  if (position != 'top') {
  //if (position === 'top') {
    // Top position: start from custom margin, go down
    marginV = margin + (positionIndex * (fontSize + 10));
  } else {
    // Bottom position: start from bottom minus custom margin, go up
    marginV = height - margin - ((totalAtPosition - positionIndex - 1) * (fontSize + 10));
  }

  // Handle custom fonts
  let fontPath = null;
  const availableFonts = await getAvailableFonts();
  const customFont = availableFonts.find(f => f.name === fontName && f.type === 'custom');
  if (customFont) {
    fontPath = customFont.path;
  }

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
  console.log(`📝 ASS file written for ${lang}: ${path.basename(assPath)} with font=${fontName}, size=${fontSize}, color=${color}, marginV=${marginV}, position=${position}, margin=${margin}px`);
  return { path: assPath, fontPath };
}

function toAssTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(1, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const cs = Math.round((seconds - Math.floor(seconds)) * 100).toString().padStart(2, '0');
  return `${h}:${m}:${s}.${cs}`;
}

async function generateSubtitleFiles(originalSegments, selectedLanguages, subtitleSettings, progressCallback) {
  const srtFiles = [];
  const serviceAvailable = await checkTranslationService();
  
  console.log(`📋 Generating subtitles for languages: ${selectedLanguages.join(', ')}`);
  
  for (let i = 0; i < selectedLanguages.length; i++) {
    const lang = selectedLanguages[i];
    const langConfig = LANGUAGE_CONFIG[lang];
    
    if (!langConfig) {
      console.warn(`⚠️ Unsupported language: ${lang}, skipping...`);
      continue;
    }

    try {
      console.log(`\n🔄 Processing ${langConfig.displayName} subtitles...`);
      
      // Check if translation is needed and service is available
      if (langConfig.needsTranslation && !serviceAvailable) {
        console.warn(`⚠️ Translation service not available for ${lang}, skipping...`);
        continue;
      }

      const segments = await generateLanguageSubtitles(originalSegments, lang, progressCallback);
      
      // Create SRT file
      const srtPath = path.join(TEMP_DIR, `subtitles_${lang}.srt`);
      await createSrtFile(segments, srtPath);
      
      srtFiles.push({
        path: srtPath,
        langCode: lang,
        displayName: langConfig.displayName
      });
      
      console.log(`✅ Successfully generated ${langConfig.displayName} subtitles`);
      
    } catch (error) {
      console.error(`❌ Failed to generate ${langConfig.displayName} subtitles:`, error.message);
    }
  }
  
  console.log(`📊 Generated ${srtFiles.length}/${selectedLanguages.length} subtitle files`);
  return srtFiles;
}

async function mergeSubtitles(originalVideoPath, srtFiles, outputPath, videoMetadata, progressCallback, subtitleSettings) {
  progressCallback({ step: 'merging_subtitles', progress: 0.85 });
  
  if (srtFiles.length === 0) {
    console.warn('❌ No subtitle files to merge');
    await runCommand(`ffmpeg -i "${originalVideoPath}" -c copy "${outputPath}" -y`);
    progressCallback({ step: 'merging_subtitles', progress: 1.0 });
    return;
  }

  console.log(`🎬 Preparing to merge ${srtFiles.length} subtitle tracks into video...`);
  
  // Organize subtitles by position and order
  const topSubtitles = [];
  const bottomSubtitles = [];
  
  const topOrder = subtitleSettings.order?.top || [];
  const bottomOrder = subtitleSettings.order?.bottom || [];
  
  // Sort subtitles according to order settings
  const sortByOrder = (a, b, orderArray) => {
  //const sortByOrder = (b, a, orderArray) => {
    const aIndex = orderArray.indexOf(a.langCode);
    const bIndex = orderArray.indexOf(b.langCode);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  };

  srtFiles.forEach(srtFile => {
    const langConfig = subtitleSettings.configs[srtFile.langCode];
    const position = langConfig?.position || 'top';
    
    if (position === 'top') {
      topSubtitles.push(srtFile);
    } else {
      bottomSubtitles.push(srtFile);
    }
  });

  // Sort by order
  //topSubtitles.sort((a, b) => sortByOrder(a, b, topOrder));
  //bottomSubtitles.sort((a, b) => sortByOrder(a, b, bottomOrder));

  topSubtitles.sort((b, a) => sortByOrder(a, b, topOrder));
  bottomSubtitles.sort((b, a) => sortByOrder(a, b, bottomOrder));

  // Combine ordered subtitles
  const orderedSrtFiles = [...topSubtitles, ...bottomSubtitles];

  try {
    // Convert SRT to ASS with position-aware settings
    const assFiles = [];
    
    for (const [index, srtFile] of orderedSrtFiles.entries()) {
      const lang = srtFile.langCode;
      const langConfig = subtitleSettings.configs[lang];
      const position = langConfig?.position || 'top';
      
      // Calculate position index within the same position group
      let positionIndex, totalAtPosition;
      if (position === 'top') {
        positionIndex = topSubtitles.findIndex(s => s.langCode === lang);
        totalAtPosition = topSubtitles.length;
      } else {
        positionIndex = bottomSubtitles.findIndex(s => s.langCode === lang);
        totalAtPosition = bottomSubtitles.length;
      }
      
      const assResult = await convertSrtToAss(
        srtFile.path, 
        lang, 
        langConfig, 
        videoMetadata.width, 
        videoMetadata.height, 
        positionIndex, 
        totalAtPosition
      );
      
      assFiles.push(assResult);
    }

    // Copy custom fonts to temp directory and build FFmpeg command
    const fontMappings = [];
    for (const assFile of assFiles) {
      if (assFile.fontPath) {
        const fontFileName = path.basename(assFile.fontPath);
        const tempFontPath = path.join(TEMP_DIR, fontFileName);
        await fs.copyFile(assFile.fontPath, tempFontPath);
        fontMappings.push(tempFontPath);
        console.log(`📚 Copied custom font: ${fontFileName}`);
      }
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

    // Add font attachments if any custom fonts are used
    let fontInputs = '';
    let attachmentMaps = '';
    if (fontMappings.length > 0) {
      fontMappings.forEach((fontPath, i) => {
        fontInputs += ` -attach "${fontPath}"`;
        attachmentMaps += ` -map ${i + 1}`;
      });
    }

    const command = `ffmpeg -i "${originalVideoPath}"${fontInputs} -filter_complex "${filterComplex}" -map "${inputLabel}" -map 0:a${attachmentMaps} -c:v libx264 -crf 10 -b:v 9865k -preset medium -profile:v main -c:a copy "${outputPath}" -y`;
    
    console.log('🔧 FFmpeg command:', command);
    await runCommand(command);

    // Clean up ASS and temporary font files
    for (const assFile of assFiles) {
      await fs.unlink(assFile.path);
      console.log(`🧹 Cleaned ASS: ${path.basename(assFile.path)}`);
    }
    
    for (const fontPath of fontMappings) {
      try {
        await fs.unlink(fontPath);
        console.log(`🧹 Cleaned temp font: ${path.basename(fontPath)}`);
      } catch (error) {
        console.warn(`⚠️ Failed to cleanup temp font: ${error.message}`);
      }
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
    const attachmentStreams = streams.filter(s => s.codec_type === 'attachment');
    
    console.log(`📊 Output video analysis:`);
    console.log(`   Video streams: ${videoStreams.length}`);
    console.log(`   Audio streams: ${audioStreams.length}`);
    console.log(`   Font attachments: ${attachmentStreams.length}`);
    console.log(`   Resolution: ${videoStreams[0].width}x${videoStreams[0].height}`);
    console.log(`   Video bitrate: ${videoStreams[0].bit_rate ? videoStreams[0].bit_rate + ' bits/s' : 'N/A'}`);
    console.log(`   H.264 Profile: ${videoStreams[0].profile || 'N/A'}`);
    
    const stats = await fs.stat(videoPath);
    console.log(`📁 Final output: ${stats.size} bytes (~${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  } catch (error) {
    console.warn('⚠️ Could not verify output:', error.message);
  }
}

async function sendNotifications(videoFileName, originalFileName, outputPath, duration, languages) {
  console.log(`📢 Sending notifications for: ${videoFileName}`);
  const languagesList = languages.join(', ');
  
  const notifications = [
    {
      name: 'WxPusher',
      url: 'https://wxpusher.zjiecode.com/api/send/message',
      headers: { 'Content-Type': 'application/json' },
      data: {
        appToken: 'AT_byimkOmi7B0xzvqEvXVYIAj0YkMrwDvV',
        content: `视频转换完毕: ${originalFileName} ==> ${videoFileName} : ${duration}s (字幕: ${languagesList})`,
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
        content: `视频转换完毕: ${originalFileName} ==> ${videoFileName} : ${duration}s (字幕: ${languagesList})`,
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
        html: `<p>视频转换完毕: ${originalFileName} ==> ${videoFileName} : ${duration}s</p><p>字幕语言: ${languagesList}</p>`,
      },
    },
    {
      name: 'Telegram',
      url: `https://api.telegram.org/bot8371556252:AAHUpvXA_73QYDsNbmMWiqG2SOKTKzzOY_Y/sendMessage`,
      headers: { 'Content-Type': 'application/json' },
      data: {
        chat_id: '8200348152',
        text: `视频转换完毕: ${originalFileName} ==> ${videoFileName} : ${duration}s (字幕: ${languagesList})`,
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
  const tempFilesToClean = [];
  const selectedLanguages = subtitleSettings.languages || ['zh-tw'];
  
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(__dirname, 'videos_out'), { recursive: true });
    
    console.log(`\n🎬 Starting processing for: ${videoFileName}`);
    console.log('📋 Selected languages:', selectedLanguages);
    console.log('📋 Subtitle settings:', subtitleSettings);
    console.log('='.repeat(80));

    // Step 1: Extract audio
    console.log('📢 Step 1: Extracting audio from video...');
    audioPath = await extractAudio(videoPath, progressCallback);
    tempFilesToClean.push(audioPath);

    // Step 2: Speech to text (Traditional Chinese)
    console.log('🎙️ Step 2: Transcribing audio to Traditional Chinese subtitles...');
    const { segments: originalSegments, srtPath: originalSrtPath } = await speechToText(audioPath, progressCallback);
    tempFilesToClean.push(originalSrtPath);

    // Step 3: Generate subtitle files for all selected languages
    console.log('🌍 Step 3: Generating subtitle files for selected languages...');
    const srtFiles = await generateSubtitleFiles(originalSegments, selectedLanguages, subtitleSettings, progressCallback);
    
    // Add all generated SRT files to cleanup list
    srtFiles.forEach(srtFile => tempFilesToClean.push(srtFile.path));

    // Step 4: Merge subtitles into video
    console.log(`\n🎬 Step 4: Merging ${srtFiles.length} subtitle tracks into video...`);
    console.log('📋 Subtitle files to merge:');
    srtFiles.forEach((srt, i) => {
      const config = subtitleSettings.configs[srt.langCode];
      console.log(`   ${i + 1}. ${srt.displayName} (${srt.langCode}): ${config?.position || 'top'} position`);
    });

    await mergeSubtitles(videoPath, srtFiles, outputPath, videoMetadata, progressCallback, subtitleSettings);

    const duration = (Date.now() - startTime) / 1000;
    const languages = srtFiles.map(s => s.displayName);
    
    console.log(`\n🎉 Processing completed for: ${videoFileName}`);
    console.log(`   📊 Subtitle tracks: ${srtFiles.length} (${languages.join(', ')})`);
    console.log(`   📁 Output file: ${outputPath}`);
    console.log(`   ⏱️ Duration: ${duration.toFixed(2)} seconds`);
    console.log('='.repeat(80));

    // Store completion info
    completedVideos.push({
      originalFile: originalFileName || path.basename(videoPath),
      newFile: path.basename(outputPath),
      languages: languages,
      duration,
    });

    await sendNotifications(videoFileName, originalFileName, outputPath, duration.toFixed(2), languages);

    return {
      success: true,
      outputPath,
      subtitleCount: srtFiles.length,
      languages,
      duration,
    };

  } catch (error) {
    console.error(`💥 Processing failed for ${videoPath}:`, error);
    return { success: false, error: error.message };
  } finally {
    // Cleanup temporary files
    console.log('\n🧹 Cleaning up temporary files...');
    for (const filePath of tempFilesToClean) {
      try {
        // retain temp fichiers for review purpose
        //await fs.unlink(filePath);
        console.log(`   ✅ Cleaned: ${path.basename(filePath)}`);
      } catch (cleanupError) {
        console.warn(`   ⚠️ Failed to cleanup: ${path.basename(filePath)} - ${cleanupError.message}`);
      }
    }
    console.log('🧹 Cleanup completed');
  }
}

async function processVideos(videoPaths, progressCallback = () => {}, originalFileNames = [], subtitleSettings = {}) {
  const results = [];
  console.log(`\n🚀 Starting batch processing for ${videoPaths.length} videos`);
  console.log('📋 Subtitle settings:', subtitleSettings);
  
  for (let i = 0; i < videoPaths.length; i++) {
    const videoName = path.basename(videoPaths[i]);
    console.log(`\n📹 Processing video ${i + 1}/${videoPaths.length}: ${videoName}`);
    
    progressCallback({ 
      videoIndex: i, 
      totalVideos: videoPaths.length, 
      step: 'starting', 
      progress: 0, 
      queueLength: videoPaths.length - i - 1 
    });

    const result = await processVideo(
      videoPaths[i], 
      (progress) => {
        progressCallback({ 
          videoIndex: i, 
          totalVideos: videoPaths.length, 
          ...progress 
        });
      }, 
      originalFileNames[i] || videoName, 
      subtitleSettings
    );

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

module.exports = { 
  processVideo, 
  processVideos, 
  getCompletedVideos, 
  getAvailableFonts,
  LANGUAGE_CONFIG
};
