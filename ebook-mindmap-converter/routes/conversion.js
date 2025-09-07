const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const FileParser = require('../utils/fileParser');
const OllamaClient = require('../utils/ollamaClient');
const MindmapGenerator = require('../utils/mindmapGenerator');
const Conversion = require('../models/Conversion');

const router = express.Router();

// 开始转换
router.post('/start/:conversionId', async (req, res) => {
  try {
    const conversion = await Conversion.findById(req.params.conversionId);
    
    if (!conversion) {
      return res.status(404).json({ error: '转换记录不存在' });
    }

    if (conversion.status !== 'uploaded') {
      return res.status(400).json({ error: '文件状态不正确，无法开始转换' });
    }

    // 更新状态为处理中
    await conversion.update({ 
      status: 'processing',
      progress: 0
    });

    // 获取WebSocket实例
    const io = req.app.get('io');
    
    // 异步处理转换
    processConversion(conversion, io).catch(error => {
      console.error('转换处理失败:', error);
      conversion.update({
        status: 'failed',
        error_message: error.message
      });
      
      io.emit('conversion_error', {
        conversionId: conversion.id,
        error: error.message
      });
    });

    res.json({
      success: true,
      message: '转换已开始',
      conversion: conversion
    });
  } catch (error) {
    console.error('开始转换失败:', error);
    res.status(500).json({ 
      error: '开始转换失败',
      message: error.message 
    });
  }
});

// 异步转换处理函数
async function processConversion(conversion, io) {
  const startTime = Date.now();
  
  try {
    // 发送开始信号
    io.emit('conversion_started', {
      conversionId: conversion.id,
      message: '开始解析文件...'
    });

    // 1. 解析文件
    await conversion.update({ progress: 10 });
    io.emit('conversion_progress', {
      conversionId: conversion.id,
      progress: 10,
      message: '正在解析文件...'
    });

    const fileParser = new FileParser();
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const filePath = path.join(uploadDir, conversion.filename);
    
    const parsedData = await fileParser.parseFile(filePath, conversion.original_filename);
    
    await conversion.update({ progress: 30 });
    io.emit('conversion_progress', {
      conversionId: conversion.id,
      progress: 30,
      message: '文件解析完成，开始生成思维导图...'
    });

    // 2. 生成思维导图
    const ollamaClient = new OllamaClient(process.env.OLLAMA_BASE_URL);
    
    // 检查模型是否可用
    const modelExists = await ollamaClient.checkModel(conversion.model_used);
    if (!modelExists) {
      throw new Error(`模型 ${conversion.model_used} 不存在，请先安装该模型`);
    }

    await conversion.update({ progress: 40 });
    io.emit('conversion_progress', {
      conversionId: conversion.id,
      progress: 40,
      message: '正在调用AI模型生成思维导图...'
    });

    // 使用流式生成以显示进度
    const mindmapData = await ollamaClient.generateStream(
      parsedData.text,
      conversion.model_used,
      (progressData) => {
        const progress = 40 + (progressData.progress * 0.4); // 40-80%
        io.emit('conversion_progress', {
          conversionId: conversion.id,
          progress: Math.round(progress),
          message: 'AI正在生成思维导图...'
        });
      }
    );

    await conversion.update({ progress: 80 });
    io.emit('conversion_progress', {
      conversionId: conversion.id,
      progress: 80,
      message: '思维导图生成完成，正在保存文件...'
    });

    // 3. 生成思维导图文件
    const mindmapGenerator = new MindmapGenerator();
    const filename = `${conversion.id}_${Date.now()}`;
    
    const generatedFiles = await mindmapGenerator.generateAllFormats(mindmapData, filename);
    
    await conversion.update({ progress: 95 });
    io.emit('conversion_progress', {
      conversionId: conversion.id,
      progress: 95,
      message: '文件生成完成，正在保存到数据库...'
    });

    // 4. 生成摘要
    const summary = await ollamaClient.generateSummary(parsedData.text, conversion.model_used);

    // 5. 更新数据库
    const processingTime = Math.round((Date.now() - startTime) / 1000);
    
    await conversion.update({
      status: 'completed',
      progress: 100,
      mindmap_data: mindmapData,
      summary: summary,
      processing_time: processingTime
    });

    // 发送完成信号
    io.emit('conversion_completed', {
      conversionId: conversion.id,
      processingTime: processingTime,
      mindmapData: mindmapData,
      generatedFiles: generatedFiles,
      summary: summary
    });

    console.log(`转换完成: ${conversion.original_filename}, 耗时: ${processingTime}秒`);

  } catch (error) {
    const processingTime = Math.round((Date.now() - startTime) / 1000);
    
    await conversion.update({
      status: 'failed',
      error_message: error.message,
      processing_time: processingTime
    });

    io.emit('conversion_failed', {
      conversionId: conversion.id,
      error: error.message,
      processingTime: processingTime
    });

    throw error;
  }
}

// 获取转换状态
router.get('/status/:conversionId', async (req, res) => {
  try {
    const conversion = await Conversion.findById(req.params.conversionId);
    
    if (!conversion) {
      return res.status(404).json({ error: '转换记录不存在' });
    }

    res.json({
      conversionId: conversion.id,
      status: conversion.status,
      progress: conversion.progress,
      processingTime: conversion.processing_time,
      errorMessage: conversion.error_message,
      summary: conversion.summary
    });
  } catch (error) {
    console.error('获取转换状态失败:', error);
    res.status(500).json({ 
      error: '获取转换状态失败',
      message: error.message 
    });
  }
});

// 批量开始转换
router.post('/batch-start', async (req, res) => {
  try {
    const { conversionIds } = req.body;
    
    if (!conversionIds || !Array.isArray(conversionIds)) {
      return res.status(400).json({ error: '请提供有效的转换ID列表' });
    }

    const results = [];
    const io = req.app.get('io');

    for (const conversionId of conversionIds) {
      try {
        const conversion = await Conversion.findById(conversionId);
        
        if (conversion && conversion.status === 'uploaded') {
          await conversion.update({ 
            status: 'processing',
            progress: 0
          });

          // 异步处理转换
          processConversion(conversion, io).catch(error => {
            console.error(`转换 ${conversionId} 失败:`, error);
            conversion.update({
              status: 'failed',
              error_message: error.message
            });
          });

          results.push({
            conversionId: conversion.id,
            status: 'started'
          });
        } else {
          results.push({
            conversionId: conversionId,
            status: 'skipped',
            reason: '文件状态不正确或不存在'
          });
        }
      } catch (error) {
        results.push({
          conversionId: conversionId,
          status: 'error',
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `批量转换已开始，共处理 ${results.length} 个文件`,
      results: results
    });
  } catch (error) {
    console.error('批量开始转换失败:', error);
    res.status(500).json({ 
      error: '批量开始转换失败',
      message: error.message 
    });
  }
});

// 取消转换
router.post('/cancel/:conversionId', async (req, res) => {
  try {
    const conversion = await Conversion.findById(req.params.conversionId);
    
    if (!conversion) {
      return res.status(404).json({ error: '转换记录不存在' });
    }

    if (conversion.status === 'processing') {
      await conversion.update({
        status: 'cancelled',
        error_message: '用户取消转换'
      });

      const io = req.app.get('io');
      io.emit('conversion_cancelled', {
        conversionId: conversion.id
      });

      res.json({
        success: true,
        message: '转换已取消'
      });
    } else {
      res.status(400).json({ error: '只能取消正在处理的转换' });
    }
  } catch (error) {
    console.error('取消转换失败:', error);
    res.status(500).json({ 
      error: '取消转换失败',
      message: error.message 
    });
  }
});

// 获取所有转换记录
router.get('/all', async (req, res) => {
  try {
    const conversions = await Conversion.findAll();
    
    res.json({
      success: true,
      data: conversions
    });
  } catch (error) {
    console.error('获取转换列表失败:', error);
    res.status(500).json({ 
      error: '获取转换列表失败',
      message: error.message 
    });
  }
});

module.exports = router;
