const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const iconv = require('iconv-lite');
const FileParser = require('../utils/fileParser');
const Conversion = require('../models/Conversion');

const router = express.Router();

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    await fs.ensureDir(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Log raw filename bytes for debugging
    const rawBuffer = Buffer.from(file.originalname, 'binary');
    console.log(`Raw filename bytes: ${rawBuffer.toString('hex')}`);

    // Decode assuming file.originalname is misinterpreted as ISO-8859-1
    let decodedName = file.originalname;
    try {
      // First try decoding from ISO-8859-1 to GBK (common for Chinese filenames)
      decodedName = iconv.decode(rawBuffer, 'gbk');
      if (/�/.test(decodedName)) {
        // Fallback to UTF-8 if GBK decoding produces invalid characters
        decodedName = rawBuffer.toString('utf8');
      }
      if (/�/.test(decodedName)) {
        // Fallback to sanitized name if both attempts fail
        console.warn(`Decoding failed for ${file.originalname}, using sanitized original`);
        decodedName = file.originalname.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
      }
    } catch (error) {
      console.error(`Filename decoding error for ${file.originalname}:`, error);
      decodedName = file.originalname.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    }

    console.log(`Decoded filename: ${decodedName}`);
    const uniqueName = `${uuidv4()}_${decodedName}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: (process.env.MAX_FILE_SIZE || 50) * 1024 * 1024 // Default 50MB
  },
  fileFilter: (req, file, cb) => {
    const fileParser = new FileParser();
    if (fileParser.isSupportedFormat(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式'), false);
    }
  }
});

// Upload single file
router.post('/single', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }

    const fileParser = new FileParser();
    // Decode original filename
    const rawBuffer = Buffer.from(req.file.originalname, 'binary');
    console.log(`Raw original_filename bytes: ${rawBuffer.toString('hex')}`);

    let decodedOriginalName = req.file.originalname;
    try {
      decodedOriginalName = iconv.decode(rawBuffer, 'gbk');
      if (/�/.test(decodedOriginalName)) {
        decodedOriginalName = rawBuffer.toString('utf8');
      }
      if (/�/.test(decodedOriginalName)) {
        console.warn(`Decoding failed for ${req.file.originalname}, using sanitized original`);
        decodedOriginalName = req.file.originalname.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
      }
    } catch (error) {
      console.error(`Original filename decoding error for ${req.file.originalname}:`, error);
      decodedOriginalName = req.file.originalname.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    }

    console.log(`Stored original_filename: ${decodedOriginalName}`);
    const conversion = new Conversion({
      filename: req.file.filename,
      original_filename: decodedOriginalName,
      file_type: fileParser.getFileExtension(decodedOriginalName),
      file_size: req.file.size,
      model_used: req.body.model || process.env.DEFAULT_MODEL || 'llama3.2:1b',
      status: 'uploaded'
    });

    const savedConversion = await Conversion.create(conversion);
    
    res.json({
      success: true,
      message: '文件上传成功',
      conversion: savedConversion
    });
  } catch (error) {
    console.error('文件上传失败:', error);
    res.status(500).json({ 
      error: '文件上传失败',
      message: error.message 
    });
  }
});

// Upload multiple files
router.post('/multiple', upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '没有上传文件' });
    }

    const fileParser = new FileParser();
    const conversions = [];

    for (const file of req.files) {
      // Decode original filename
      const rawBuffer = Buffer.from(file.originalname, 'binary');
      console.log(`Raw filename bytes: ${rawBuffer.toString('hex')}`);

      let decodedOriginalName = file.originalname;
      try {
        decodedOriginalName = iconv.decode(rawBuffer, 'gbk');
        if (/�/.test(decodedOriginalName)) {
          decodedOriginalName = rawBuffer.toString('utf8');
        }
        if (/�/.test(decodedOriginalName)) {
          console.warn(`Decoding failed for ${file.originalname}, using sanitized original`);
          decodedOriginalName = file.originalname.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        }
      } catch (error) {
        console.error(`Original filename decoding error for ${file.originalname}:`, error);
        decodedOriginalName = file.originalname.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
      }

      console.log(`Stored original_filename: ${decodedOriginalName}`);
      const conversion = new Conversion({
        filename: file.filename,
        original_filename: decodedOriginalName,
        file_type: fileParser.getFileExtension(decodedOriginalName),
        file_size: file.size,
        model_used: req.body.model || process.env.DEFAULT_MODEL || 'llama3.2:1b',
        status: 'uploaded'
      });

      const savedConversion = await Conversion.create(conversion);
      conversions.push(savedConversion);
    }

    res.json({
      success: true,
      message: `成功上传 ${conversions.length} 个文件`,
      conversions: conversions
    });
  } catch (error) {
    console.error('批量文件上传失败:', error);
    res.status(500).json({ 
      error: '批量文件上传失败',
      message: error.message 
    });
  }
});

// Get upload progress
router.get('/progress/:conversionId', async (req, res) => {
  try {
    const conversion = await Conversion.findById(req.params.conversionId);
    
    if (!conversion) {
      return res.status(404).json({ error: '转换记录不存在' });
    }

    res.json({
      conversionId: conversion.id,
      status: conversion.status,
      progress: conversion.progress
    });
  } catch (error) {
    console.error('获取上传进度失败:', error);
    res.status(500).json({ 
      error: '获取上传进度失败',
      message: error.message 
    });
  }
});

// Delete uploaded file
router.delete('/:conversionId', async (req, res) => {
  try {
    const conversion = await Conversion.findById(req.params.conversionId);
    
    if (!conversion) {
      return res.status(404).json({ error: '转换记录不存在' });
    }

    // Delete file
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const filePath = path.join(uploadDir, conversion.filename);
    
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }

    // Delete database record
    await conversion.delete();

    res.json({
      success: true,
      message: '文件删除成功'
    });
  } catch (error) {
    console.error('删除文件失败:', error);
    res.status(500).json({ 
      error: '删除文件失败',
      message: error.message 
    });
  }
});

// Get supported file formats
router.get('/formats', (req, res) => {
  const fileParser = new FileParser();
  const supportedFormats = Object.keys(fileParser.supportedFormats);
  
  res.json({
    supportedFormats: supportedFormats,
    maxFileSize: process.env.MAX_FILE_SIZE || 50
  });
});

module.exports = router;
