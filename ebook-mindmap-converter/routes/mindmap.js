const express = require('express');
const Conversion = require('../models/Conversion');

const router = express.Router();

// 获取所有思维导图
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      status = 'completed'
    } = req.query;

    const options = {
      where: {
        status: status
      },
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
      order: [['created_at', 'DESC']]
    };

    console.log('Mindmap fetch options:', JSON.stringify(options, null, 2));

    const conversions = await Conversion.findAll(options);
    const total = await Conversion.count({ where: { status: status } });
    
    res.json({
      success: true,
      data: conversions,
      total: total,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('获取思维导图列表失败:', error);
    res.status(500).json({ 
      success: false,
      error: '获取思维导图列表失败',
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
      limit = 100
    } = req.query;

    console.log('收到搜索请求参数:', {
      keyword,
      start_date,
      end_date,
      model_used,
      file_type,
      limit
    });

    // 构建查询条件
    const whereConditions = {
      status: 'completed' // 只返回已完成的转换
    };

    // 关键字搜索 - 在文件名中搜索
    if (keyword && keyword.trim()) {
      const decodedKeyword = decodeURIComponent(keyword.trim());
      //whereConditions.original_filename = {
      whereConditions.summary= {
        iLike: `%${decodedKeyword}%`
      };
      console.log('添加关键字筛选:', decodedKeyword);
    }

    // 模型筛选
    if (model_used && model_used.trim()) {
      const decodedModel = decodeURIComponent(model_used.trim());
      whereConditions.model_used = decodedModel;
      console.log('添加模型筛选:', decodedModel);
    }

    // 文件类型筛选
    if (file_type && file_type.trim()) {
      const decodedFileType = decodeURIComponent(file_type.trim());
      whereConditions.file_type = decodedFileType;
      console.log('添加文件类型筛选:', decodedFileType);
    }

    // 日期筛选
    if (start_date && end_date) {
      const startDate = new Date(decodeURIComponent(start_date));
      const endDate = new Date(decodeURIComponent(end_date));
      
      // 确保结束日期包含当天的所有时间
      endDate.setHours(23, 59, 59, 999);
      
      whereConditions.created_at = {
        between: [startDate, endDate]
      };
      console.log('添加日期筛选:', { startDate, endDate });
    }

    const options = {
      where: whereConditions,
      limit: parseInt(limit),
      order: [['created_at', 'DESC']]
    };

    console.log('最终查询条件:', JSON.stringify(options, null, 2));

    const conversions = await Conversion.findAll(options);
    const total = await Conversion.count({ where: whereConditions });
    
    console.log(`搜索结果: 找到 ${conversions.length} 条记录，总数: ${total}`);
    
    res.json({
      success: true,
      data: conversions,
      total: total,
      searchParams: {
        keyword: keyword || '',
        start_date: start_date || '',
        end_date: end_date || '',
        model_used: model_used || '',
        file_type: file_type || ''
      }
    });
  } catch (error) {
    console.error('搜索思维导图失败:', error);
    res.status(500).json({ 
      success: false,
      error: '搜索思维导图失败',
      message: error.message 
    });
  }
});

// 获取单个思维导图详情
router.get('/:conversionId', async (req, res) => {
  try {
    const conversion = await Conversion.findById(req.params.conversionId);
    
    if (!conversion) {
      return res.status(404).json({ success: false, error: '思维导图不存在' });
    }

    if (conversion.status !== 'completed') {
      return res.status(400).json({ success: false, error: '思维导图尚未完成' });
    }

    res.json({
      success: true,
      data: conversion
    });
  } catch (error) {
    console.error('获取思维导图详情失败:', error);
    res.status(500).json({ 
      success: false,
      error: '获取思维导图详情失败',
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
      if (conv.file_type) {
        stats.byFileType[conv.file_type] = (stats.byFileType[conv.file_type] || 0) + 1;
      }
      
      // 模型统计
      if (conv.model_used) {
        stats.byModel[conv.model_used] = (stats.byModel[conv.model_used] || 0) + 1;
      }
      
      // 日期统计
      if (conv.created_at) {
        const date = conv.created_at.toISOString().split('T')[0];
        stats.byDate[date] = (stats.byDate[date] || 0) + 1;
      }
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
      success: false,
      error: '获取统计数据失败',
      message: error.message 
    });
  }
});

// 获取最近转换的思维导图
router.get('/recent/:limit?', async (req, res) => {
  try {
    const limit = parseInt(req.params.limit) || 10;
    
    const conversions = await Conversion.findAll({ 
      where: { status: 'completed' },
      limit,
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: conversions
    });
  } catch (error) {
    console.error('获取最近思维导图失败:', error);
    res.status(500).json({ 
      success: false,
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
      return res.status(404).json({ success: false, error: '思维导图不存在' });
    }

    // 删除相关文件
    const fs = require('fs-extra');
    const path = require('path');
    const outputDir = process.env.OUTPUT_DIR || './outputs';
    
    try {
      const files = await fs.readdir(outputDir);
      for (const file of files) {
        if (file.includes(conversion.id)) {
          await fs.remove(path.join(outputDir, file));
          console.log(`已删除文件: ${file}`);
        }
      }
    } catch (fileError) {
      console.warn('删除文件时出错:', fileError.message);
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
      success: false,
      error: '删除思维导图失败',
      message: error.message 
    });
  }
});

module.exports = router;
