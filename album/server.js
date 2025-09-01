const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8050;

app.use(express.static(__dirname)); 
app.use(express.static('public'));
app.use(morgan('dev'));
app.use('/uploads', express.static('uploads'));
app.use('/output', express.static('output'));

const projectFiles = new Map();

const createDirectories = async () => {
  const dirs = ['uploads/images', 'uploads/videos', 'uploads/audio', 'uploads/subtitles', 'temp', 'output'];
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      console.log(`目录 ${dir} 已存在或创建失败:`, error.message);
    }
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = 'uploads/';
    if (file.fieldname === 'images') uploadPath += 'images/';
    else if (file.fieldname === 'videos') uploadPath += 'videos/';
    else if (file.fieldname === 'audio') uploadPath += 'audio/';
    else if (file.fieldname === 'subtitles') uploadPath += 'subtitles/';
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 提高到200MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = {
      images: ['image/'],
      videos: ['video/'],
      audio: ['audio/'],
      subtitles: ['text/plain', '.srt', '.vtt']
    };
    
    const field = file.fieldname;
    if (allowedTypes[field]) {
      if (allowedTypes[field].some(type => file.mimetype.startsWith(type) || file.originalname.endsWith(type))) {
        return cb(null, true);
      }
    }
    cb(new Error('不支持的文件类型'));
  }
});

app.post('/upload', upload.fields([
  { name: 'images', maxCount: 50 },
  { name: 'videos', maxCount: 20 },
  { name: 'audio', maxCount: 1 },
  { name: 'subtitles', maxCount: 1 }
]), async (req, res) => {
  try {
    const projectId = uuidv4();
    const uploadedFiles = {
      projectId: projectId,
      images: req.files.images || [],
      videos: req.files.videos || [],
      audio: req.files.audio ? req.files.audio[0] : null,
      subtitles: req.files.subtitles ? req.files.subtitles[0] : null
    };
    projectFiles.set(projectId, uploadedFiles);
    console.log(`项目 ${projectId} 上传完成`);
    res.json({ success: true, message: '文件上传成功', data: { projectId } });
  } catch (error) {
    console.error('上传错误:', error);
    res.status(500).json({ success: false, message: '文件上传失败', error: error.message });
  }
});

app.delete('/delete-file', express.json(), async (req, res) => {
    try {
        const { projectId, fileType, fileName } = req.body;
        const projectData = projectFiles.get(projectId);
        if (!projectData) {
            return res.status(404).json({ success: false, message: '项目不存在' });
        }

        let fileToDelete = null;
        let files = projectData[fileType];

        if (Array.isArray(files)) {
            const index = files.findIndex(file => file.originalname === fileName);
            if (index > -1) {
                fileToDelete = files.splice(index, 1)[0];
            }
        } else if (files && files.originalname === fileName) {
            fileToDelete = files;
            projectData[fileType] = null;
        }

        if (fileToDelete) {
            await fs.unlink(fileToDelete.path).catch(err => console.error(`删除磁盘文件失败: ${fileToDelete.path}`, err));
        }

        projectFiles.set(projectId, projectData);
        res.json({ success: true, message: '文件删除成功' });
    } catch (error) {
        console.error('删除文件错误:', error);
        res.status(500).json({ success: false, message: '删除文件失败', error: error.message });
    }
});

const preprocessSubtitleFile = async (subtitlePath, tempDir) => {
  try {
    let subtitleContent;
    try {
      subtitleContent = await fs.readFile(subtitlePath, 'utf8');
    } catch (error) {
      console.warn('UTF-8读取失败，尝试使用latin1编码...');
      subtitleContent = await fs.readFile(subtitlePath, 'latin1');
    }
    
    const processedPath = path.join(tempDir, 'processed_subtitle.srt');
    const cleanedContent = subtitleContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '').trim();

    if (!cleanedContent.includes('-->')) throw new Error('字幕文件格式不正确');
    
    await fs.writeFile(processedPath, cleanedContent, 'utf8');
    console.log('字幕文件预处理完成');
    return processedPath;
  } catch (error) {
    console.error('字幕预处理错误:', error);
    throw error;
  }
};

app.post('/create-album', express.json(), async (req, res) => {
  let tempDir = '';
  const { projectId, settings } = req.body;

  try {
    const projectData = projectFiles.get(projectId);
    if (!projectData) {
      return res.status(400).json({ success: false, message: '项目不存在，请重新上传文件' });
    }

    const {
      imageDuration = 3,
      transitionDuration = 0.5,
      outputResolution = '1280x720',
      frameRate = 30,
      outputFormat = 'mp4',
      subtitle: {
        fontSize = 24,
        fontColor = '#ffffff',
        backgroundColor = '#000000',
        fontName = 'SimHei'
      } = {}
    } = settings || {};

    tempDir = path.join('temp', projectId);
    await fs.mkdir(tempDir, { recursive: true });

    const command = ffmpeg().addOption('-y');
    let complexFilter = [];
    const videoStreams = [], audioStreams = [];
    let inputIndex = 0;
    
    const allMediaFiles = [...projectData.images, ...projectData.videos]
      .sort((a, b) => a.originalname.localeCompare(b.originalname, 'zh-Hans-CN-u-kn-true'));
    
    for (const file of allMediaFiles) {
      const inputPath = path.resolve(file.path);
      if (file.mimetype.startsWith('image/')) {
        command.input(inputPath).inputOptions(['-loop 1', `-t ${imageDuration}`, `-r ${frameRate}`]);
        complexFilter.push(`[${inputIndex}:v]scale=${outputResolution.replace('x', ':')}:force_original_aspect_ratio=decrease,pad=${outputResolution.replace('x', ':')}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p,fade=t=in:st=0:d=${transitionDuration},fade=t=out:st=${imageDuration - transitionDuration}:d=${transitionDuration}[v${inputIndex}]`);
        videoStreams.push(`[v${inputIndex}]`);
        complexFilter.push(`aevalsrc=0:d=${imageDuration}[a${inputIndex}]`);
        audioStreams.push(`[a${inputIndex}]`);
      } else if (file.mimetype.startsWith('video/')) {
        command.input(inputPath);
        complexFilter.push(`[${inputIndex}:v]scale=${outputResolution.replace('x', ':')}:force_original_aspect_ratio=decrease,pad=${outputResolution.replace('x', ':')}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p[v${inputIndex}]`);
        videoStreams.push(`[v${inputIndex}]`);
        complexFilter.push(`[${inputIndex}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${inputIndex}]`);
        audioStreams.push(`[a${inputIndex}]`);
      }
      inputIndex++;
    }

    if (videoStreams.length === 0) throw new Error("没有有效的照片或视频文件用于制作。");

    complexFilter.push(`${videoStreams.join('')}concat=n=${videoStreams.length}:v=1:a=0[concat_v]`);
    complexFilter.push(`${audioStreams.join('')}concat=n=${audioStreams.length}:v=0:a=1[concat_a]`);

    let finalVideoOutput = 'concat_v', finalAudioOutput = 'concat_a';

    if (projectData.subtitles) {
      const processedSubtitleFile = await preprocessSubtitleFile(projectData.subtitles.path, tempDir);
      const safePath = processedSubtitleFile.replace(/\\/g, '/').replace(/:/g, '\\:');
      // Convert colors to ASS/SSA format (&HBBGGRR)
      const primaryColor = fontColor.replace('#', '');
      const bgColor = backgroundColor.replace('#', '');
      const primaryColorASS = `&H${primaryColor.slice(4,6)}${primaryColor.slice(2,4)}${primaryColor.slice(0,2)}`;
      const bgColorASS = `&H${bgColor.slice(4,6)}${bgColor.slice(2,4)}${bgColor.slice(0,2)}`;
      // Ensure proper font name and style formatting
      const subtitleStyle = `FontName=${fontName},FontSize=${fontSize},PrimaryColour=${primaryColorASS},BackColour=${bgColorASS},BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=20`;
      complexFilter.push(`[${finalVideoOutput}]subtitles='${safePath}':force_style='${subtitleStyle}'[v_final]`);
      finalVideoOutput = 'v_final';
    }

    if (projectData.audio) {
      command.input(projectData.audio.path);
      complexFilter.push(`[${finalAudioOutput}][${inputIndex}:a]amix=inputs=2:duration=longest,volume=2[mixed_a]`);
      finalAudioOutput = 'mixed_a';
    }

    const outputFileName = `album_${projectId}_${Date.now()}.${outputFormat}`;
    const outputPath = path.join('output', outputFileName);

    command
        .complexFilter(complexFilter)
        .outputOptions([`-map [${finalVideoOutput}]`, `-map [${finalAudioOutput}]`, '-c:v libx264', '-preset medium', '-crf 23', '-c:a aac', '-b:a 192k', '-shortest'])
        .output(outputPath)
        .on('start', (commandLine) => console.log('FFmpeg Command: ' + commandLine))
        .on('progress', (progress) => console.log(`Processing: ${progress.timemark}`))
        .on('end', async () => {
            console.log('视频相册创建完成');
            res.json({ success: true, message: '视频相册创建成功', downloadUrl: `/output/${outputFileName}` });
            if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
            projectFiles.delete(projectId);
        })
        .on('error', async (err, stdout, stderr) => {
            console.error('FFmpeg Error:', err.message);
            console.error('FFmpeg stderr:', stderr);
            res.status(500).json({ success: false, message: '视频相册创建失败', error: err.message, details: stderr });
            if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
            projectFiles.delete(projectId);
        })
        .run();

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ success: false, message: '视频相册创建失败', error: error.message });
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
    projectFiles.delete(projectId);
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: '文件大小超过限制' });
  }
  console.error('服务器错误:', error);
  res.status(500).json({ success: false, message: '服务器内部错误', error: error.message });
});

const startServer = async () => {
  await createDirectories();
  app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'index.html'));
    });
  });
};

startServer().catch(console.error);