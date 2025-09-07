const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const FileParser = require('../utils/fileParser');
const Conversion = require('../models/Conversion');

const router = express.Router();

// 配置multer用于文件上传
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    await fs.ensureDir(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}_${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: (process.env.MAX_FILE_SIZE || 50) * 1024 * 1024 // 默认50MB
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

// 上传单个文件
router.post('/single', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }

    const fileParser = new FileParser();
    const conversion = new Conversion({
      filename: req.file.filename,
      original_filename: req.file.originalname,
      file_type: fileParser.getFileExtension(req.file.originalname),
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

// 上传多个文件
router.post('/multiple', upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '没有上传文件' });
    }

    const fileParser = new FileParser();
    const conversions = [];

    for (const file of req.files) {
      const conversion = new Conversion({
        filename: file.filename,
        original_filename: file.originalname,
        file_type: fileParser.getFileExtension(file.originalname),
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

// 获取上传进度（用于大文件）
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

// 删除上传的文件
router.delete('/:conversionId', async (req, res) => {
  try {
    const conversion = await Conversion.findById(req.params.conversionId);
    
    if (!conversion) {
      return res.status(404).json({ error: '转换记录不存在' });
    }

    // 删除文件
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const filePath = path.join(uploadDir, conversion.filename);
    
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }

    // 删除数据库记录
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

// 获取支持的文件格式
router.get('/formats', (req, res) => {
  const fileParser = new FileParser();
  const supportedFormats = Object.keys(fileParser.supportedFormats);
  
  res.json({
    supportedFormats: supportedFormats,
    maxFileSize: process.env.MAX_FILE_SIZE || 50
  });
});

module.exports = router;
