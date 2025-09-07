const express = require('express');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs-extra');
const Conversion = require('../models/Conversion');

const router = express.Router();

// 导出Excel报告
router.get('/excel', async (req, res) => {
  try {
    const {
      start_date,
      end_date,
      model_used,
      status = 'completed'
    } = req.query;

    const options = {
      start_date,
      end_date,
      model_used,
      status
    };

    const conversions = await Conversion.findAll(options);
    
    // 准备Excel数据
    const excelData = conversions.map(conv => ({
      '文件名': conv.original_filename,
      '文件类型': conv.file_type,
      '文件大小(MB)': (conv.file_size / 1024 / 1024).toFixed(2),
      '使用模型': conv.model_used,
      '状态': conv.status,
      '处理时间(秒)': conv.processing_time || 0,
      '创建时间': conv.created_at.toLocaleString('zh-CN'),
      '摘要': conv.summary || '',
      '错误信息': conv.error_message || ''
    }));

    // 创建工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    // 设置列宽
    const colWidths = [
      { wch: 30 }, // 文件名
      { wch: 10 }, // 文件类型
      { wch: 12 }, // 文件大小
      { wch: 15 }, // 使用模型
      { wch: 10 }, // 状态
      { wch: 12 }, // 处理时间
      { wch: 20 }, // 创建时间
      { wch: 50 }, // 摘要
      { wch: 30 }  // 错误信息
    ];
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, '转换报告');

    // 生成Excel文件
    const filename = `转换报告_${new Date().toISOString().split('T')[0]}.xlsx`;
    const outputDir = process.env.OUTPUT_DIR || './outputs';
    await fs.ensureDir(outputDir);
    
    const filePath = path.join(outputDir, filename);
    XLSX.writeFile(wb, filePath);

    // 发送文件
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('下载Excel文件失败:', err);
      } else {
        // 下载完成后删除临时文件
        setTimeout(() => {
          fs.remove(filePath).catch(() => {});
        }, 5000);
      }
    });

  } catch (error) {
    console.error('导出Excel报告失败:', error);
    res.status(500).json({ 
      error: '导出Excel报告失败',
      message: error.message 
    });
  }
});

// 导出思维导图文件
router.get('/mindmap/:conversionId/:format', async (req, res) => {
  try {
    const { conversionId, format } = req.params;
    
    if (!['html', 'png', 'pdf'].includes(format)) {
      return res.status(400).json({ error: '不支持的文件格式' });
    }

    const conversion = await Conversion.findById(conversionId);
    
    if (!conversion) {
      return res.status(404).json({ error: '转换记录不存在' });
    }

    if (conversion.status !== 'completed') {
      return res.status(400).json({ error: '思维导图尚未完成' });
    }

    const outputDir = process.env.OUTPUT_DIR || './outputs';
    const subDir = format === 'html' ? 'html' : format === 'png' ? 'images' : 'pdfs';
    
    // 查找对应的文件
    const files = await fs.readdir(path.join(outputDir, subDir));
    const targetFile = files.find(file => file.includes(conversionId));
    
    if (!targetFile) {
      return res.status(404).json({ error: '思维导图文件不存在' });
    }

    const filePath = path.join(outputDir, subDir, targetFile);
    const downloadName = `${conversion.original_filename}_思维导图.${format}`;

    res.download(filePath, downloadName, (err) => {
      if (err) {
        console.error('下载思维导图文件失败:', err);
      }
    });

  } catch (error) {
    console.error('导出思维导图失败:', error);
    res.status(500).json({ 
      error: '导出思维导图失败',
      message: error.message 
    });
  }
});

// 批量导出思维导图
router.post('/mindmap/batch', async (req, res) => {
  try {
    const { conversionIds, format = 'pdf' } = req.body;
    
    if (!conversionIds || !Array.isArray(conversionIds)) {
      return res.status(400).json({ error: '请提供有效的转换ID列表' });
    }

    if (!['html', 'png', 'pdf'].includes(format)) {
      return res.status(400).json({ error: '不支持的文件格式' });
    }

    const outputDir = process.env.OUTPUT_DIR || './outputs';
    const subDir = format === 'html' ? 'html' : format === 'png' ? 'images' : 'pdfs';
    
    const results = [];
    
    for (const conversionId of conversionIds) {
      try {
        const conversion = await Conversion.findById(conversionId);
        
        if (conversion && conversion.status === 'completed') {
          const files = await fs.readdir(path.join(outputDir, subDir));
          const targetFile = files.find(file => file.includes(conversionId));
          
          if (targetFile) {
            results.push({
              conversionId: conversionId,
              filename: conversion.original_filename,
              filePath: path.join(outputDir, subDir, targetFile),
              status: 'found'
            });
          } else {
            results.push({
              conversionId: conversionId,
              filename: conversion.original_filename,
              status: 'not_found'
            });
          }
        } else {
          results.push({
            conversionId: conversionId,
            status: 'not_completed'
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
      message: `批量导出完成，共处理 ${results.length} 个文件`,
      results: results
    });

  } catch (error) {
    console.error('批量导出思维导图失败:', error);
    res.status(500).json({ 
      error: '批量导出思维导图失败',
      message: error.message 
    });
  }
});

// 导出统计数据
router.get('/stats', async (req, res) => {
  try {
    const allConversions = await Conversion.findAll();
    
    const stats = {
      overview: {
        total: allConversions.length,
        completed: allConversions.filter(c => c.status === 'completed').length,
        processing: allConversions.filter(c => c.status === 'processing').length,
        failed: allConversions.filter(c => c.status === 'failed').length,
        pending: allConversions.filter(c => c.status === 'pending').length,
        uploaded: allConversions.filter(c => c.status === 'uploaded').length
      },
      
      byFileType: {},
      byModel: {},
      byDate: {},
      
      processingTime: {
        total: 0,
        average: 0,
        min: Infinity,
        max: 0
      }
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
      
      // 处理时间统计
      if (conv.processing_time) {
        stats.processingTime.total += conv.processing_time;
        stats.processingTime.min = Math.min(stats.processingTime.min, conv.processing_time);
        stats.processingTime.max = Math.max(stats.processingTime.max, conv.processing_time);
      }
    });

    // 计算平均处理时间
    const completedWithTime = allConversions.filter(c => 
      c.status === 'completed' && c.processing_time
    );
    
    if (completedWithTime.length > 0) {
      stats.processingTime.average = Math.round(stats.processingTime.total / completedWithTime.length);
    }

    if (stats.processingTime.min === Infinity) {
      stats.processingTime.min = 0;
    }

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('导出统计数据失败:', error);
    res.status(500).json({ 
      error: '导出统计数据失败',
      message: error.message 
    });
  }
});

module.exports = router;
