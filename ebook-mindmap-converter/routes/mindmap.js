const express = require('express');
const Conversion = require('../models/Conversion');

const router = express.Router();

// 获取所有思维导图
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      model_used,
      start_date,
      end_date,
      keyword
    } = req.query;

    const options = {
      status,
      model_used,
      start_date,
      end_date,
      keyword,
      limit: parseInt(limit)
    };

    const conversions = await Conversion.findAll(options);
    
    // 只返回已完成的转换
    const completedConversions = conversions.filter(conv => conv.status === 'completed');
    
    res.json({
      success: true,
      data: completedConversions,
      total: completedConversions.length,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('获取思维导图列表失败:', error);
    res.status(500).json({ 
      error: '获取思维导图列表失败',
      message: error.message 
    });
  }
});

// 获取单个思维导图详情
router.get('/:conversionId', async (req, res) => {
  try {
    const conversion = await Conversion.findById(req.params.conversionId);
    
    if (!conversion) {
      return res.status(404).json({ error: '思维导图不存在' });
    }

    if (conversion.status !== 'completed') {
      return res.status(400).json({ error: '思维导图尚未完成' });
    }

    res.json({
      success: true,
      data: conversion
    });
  } catch (error) {
    console.error('获取思维导图详情失败:', error);
    res.status(500).json({ 
      error: '获取思维导图详情失败',
      message: error.message 
    });
  }
});

// 搜索思维导图
router.get('/search', async (req, res) => {
  try {
    const {
      keyword,
      start_date,
      end_date,
      model_used,
      file_type,
      limit = 50
    } = req.query;

    if (!keyword && !start_date && !end_date && !model_used && !file_type) {
      return res.status(400).json({ error: '请提供搜索条件' });
    }

    const options = {
      keyword,
      start_date,
      end_date,
      model_used,
      limit: parseInt(limit)
    };

    const conversions = await Conversion.findAll(options);
    
    // 只返回已完成的转换
    const completedConversions = conversions.filter(conv => conv.status === 'completed');
    
    res.json({
      success: true,
      data: completedConversions,
      total: completedConversions.length,
      searchParams: {
        keyword,
        start_date,
        end_date,
        model_used,
        file_type
      }
    });
  } catch (error) {
    console.error('搜索思维导图失败:', error);
    res.status(500).json({ 
      error: '搜索思维导图失败',
      message: error.message 
    });
  }
});

// 获取思维导图统计数据
router.get('/stats/overview', async (req, res) => {
  try {
    const allConversions = await Conversion.findAll();
    
    const stats = {
      total: allConversions.length,
      completed: allConversions.filter(c => c.status === 'completed').length,
      processing: allConversions.filter(c => c.status === 'processing').length,
      failed: allConversions.filter(c => c.status === 'failed').length,
      pending: allConversions.filter(c => c.status === 'pending').length,
      uploaded: allConversions.filter(c => c.status === 'uploaded').length,
      
      // 按文件类型统计
      byFileType: {},
      
      // 按模型统计
      byModel: {},
      
      // 按日期统计（最近7天）
      byDate: {},
      
      // 平均处理时间
      avgProcessingTime: 0
    };

    // 计算各维度统计
    allConversions.forEach(conv => {
      // 文件类型统计
      stats.byFileType[conv.file_type] = (stats.byFileType[conv.file_type] || 0) + 1;
      
      // 模型统计
      stats.byModel[conv.model_used] = (stats.byModel[conv.model_used] || 0) + 1;
      
      // 日期统计
      const date = conv.created_at.toISOString().split('T')[0];
      stats.byDate[date] = (stats.byDate[date] || 0) + 1;
    });

    // 计算平均处理时间
    const completedWithTime = allConversions.filter(c => 
      c.status === 'completed' && c.processing_time
    );
    
    if (completedWithTime.length > 0) {
      const totalTime = completedWithTime.reduce((sum, c) => sum + c.processing_time, 0);
      stats.avgProcessingTime = Math.round(totalTime / completedWithTime.length);
    }

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('获取统计数据失败:', error);
    res.status(500).json({ 
      error: '获取统计数据失败',
      message: error.message 
    });
  }
});

// 获取最近转换的思维导图
router.get('/recent/:limit?', async (req, res) => {
  try {
    const limit = parseInt(req.params.limit) || 10;
    
    const conversions = await Conversion.findAll({ limit });
    const recentConversions = conversions
      .filter(conv => conv.status === 'completed')
      .slice(0, limit);

    res.json({
      success: true,
      data: recentConversions
    });
  } catch (error) {
    console.error('获取最近思维导图失败:', error);
    res.status(500).json({ 
      error: '获取最近思维导图失败',
      message: error.message 
    });
  }
});

// 删除思维导图
router.delete('/:conversionId', async (req, res) => {
  try {
    const conversion = await Conversion.findById(req.params.conversionId);
    
    if (!conversion) {
      return res.status(404).json({ error: '思维导图不存在' });
    }

    // 删除相关文件
    const fs = require('fs-extra');
    const path = require('path');
    const outputDir = process.env.OUTPUT_DIR || './outputs';
    
    const filePatterns = [
      `${conversion.id}_*.html`,
      `${conversion.id}_*.png`,
      `${conversion.id}_*.pdf`
    ];

    for (const pattern of filePatterns) {
      const files = await fs.readdir(outputDir).catch(() => []);
      for (const file of files) {
        if (file.includes(conversion.id)) {
          await fs.remove(path.join(outputDir, file)).catch(() => {});
        }
      }
    }

    // 删除数据库记录
    await conversion.delete();

    res.json({
      success: true,
      message: '思维导图删除成功'
    });
  } catch (error) {
    console.error('删除思维导图失败:', error);
    res.status(500).json({ 
      error: '删除思维导图失败',
      message: error.message 
    });
  }
});

module.exports = router;
