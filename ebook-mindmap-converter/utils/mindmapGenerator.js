const fs = require('fs-extra');
const path = require('path');
const puppeteer = require('puppeteer');
const { createCanvas, loadImage } = require('canvas');

class MindmapGenerator {
  constructor(outputDir = './outputs') {
    this.outputDir = outputDir;
    this.ensureOutputDir();
  }

  // 确保输出目录存在
  async ensureOutputDir() {
    await fs.ensureDir(this.outputDir);
    await fs.ensureDir(path.join(this.outputDir, 'images'));
    await fs.ensureDir(path.join(this.outputDir, 'pdfs'));
    await fs.ensureDir(path.join(this.outputDir, 'html'));
  }

  // 生成HTML格式的思维导图
  async generateHTML(mindmapData, filename) {
    try {
      const htmlContent = this.createHTMLTemplate(mindmapData);
      const htmlPath = path.join(this.outputDir, 'html', `${filename}.html`);
      
      await fs.writeFile(htmlPath, htmlContent, 'utf-8');
      return htmlPath;
    } catch (error) {
      throw new Error(`生成HTML思维导图失败: ${error.message}`);
    }
  }

  // 创建HTML模板
  createHTMLTemplate(mindmapData) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${mindmapData.title || '思维导图'}</title>
    <style>
        body {
            font-family: 'Microsoft YaHei', Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 2.5em;
            font-weight: 300;
        }
        .summary {
            background: #f8f9fa;
            padding: 20px;
            border-left: 4px solid #4facfe;
            margin: 20px;
            border-radius: 5px;
        }
        .mindmap {
            padding: 30px;
            min-height: 600px;
        }
        .node {
            margin: 10px 0;
            padding: 15px;
            border-radius: 10px;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        .node:hover {
            transform: translateX(10px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        .node.level-1 {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            font-size: 1.2em;
            font-weight: bold;
            margin-left: 0;
        }
        .node.level-2 {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
            margin-left: 30px;
            font-size: 1.1em;
        }
        .node.level-3 {
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
            color: white;
            margin-left: 60px;
        }
        .node.level-4 {
            background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
            color: white;
            margin-left: 90px;
        }
        .keywords {
            background: #e3f2fd;
            padding: 20px;
            margin: 20px;
            border-radius: 10px;
        }
        .keywords h3 {
            color: #1976d2;
            margin-top: 0;
        }
        .keyword-tag {
            display: inline-block;
            background: #2196f3;
            color: white;
            padding: 5px 15px;
            margin: 5px;
            border-radius: 20px;
            font-size: 0.9em;
        }
        .themes {
            background: #f3e5f5;
            padding: 20px;
            margin: 20px;
            border-radius: 10px;
        }
        .themes h3 {
            color: #7b1fa2;
            margin-top: 0;
        }
        .theme-item {
            background: #9c27b0;
            color: white;
            padding: 8px 16px;
            margin: 5px;
            border-radius: 15px;
            display: inline-block;
        }
        .footer {
            background: #333;
            color: white;
            text-align: center;
            padding: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${mindmapData.title || '思维导图'}</h1>
        </div>
        
        ${mindmapData.summary ? `
        <div class="summary">
            <h3>内容摘要</h3>
            <p>${mindmapData.summary}</p>
        </div>
        ` : ''}
        
        <div class="mindmap">
            <h2>思维导图结构</h2>
            ${this.generateNodeHTML(mindmapData.nodes || [])}
        </div>
        
        ${mindmapData.keywords && mindmapData.keywords.length > 0 ? `
        <div class="keywords">
            <h3>关键词</h3>
            ${mindmapData.keywords.map(keyword => 
                `<span class="keyword-tag">${keyword}</span>`
            ).join('')}
        </div>
        ` : ''}
        
        ${mindmapData.themes && mindmapData.themes.length > 0 ? `
        <div class="themes">
            <h3>主要主题</h3>
            ${mindmapData.themes.map(theme => 
                `<span class="theme-item">${theme}</span>`
            ).join('')}
        </div>
        ` : ''}
        
        <div class="footer">
            <p>生成时间: ${new Date().toLocaleString('zh-CN')}</p>
        </div>
    </div>
</body>
</html>`;
  }

  // 生成节点HTML
  generateNodeHTML(nodes) {
    if (!nodes || nodes.length === 0) {
      return '<p>暂无思维导图数据</p>';
    }

    return nodes.map(node => `
      <div class="node level-${node.level || 1}">
        <strong>${node.label}</strong>
        ${node.children && node.children.length > 0 ? this.generateNodeHTML(node.children) : ''}
      </div>
    `).join('');
  }

  // 生成PNG图片
  async generatePNG(mindmapData, filename) {
    try {
      const htmlPath = await this.generateHTML(mindmapData, filename);
      const imagePath = path.join(this.outputDir, 'images', `${filename}.png`);
      
      const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
      });
      
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 800 });
      
      // 使用绝对路径
      const absoluteHtmlPath = path.resolve(htmlPath);
      const fileUrl = `file://${absoluteHtmlPath}`;
      
      console.log('正在访问HTML文件:', fileUrl);
      await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      
      await page.screenshot({
        path: imagePath,
        fullPage: true,
        type: 'png'
      });
      
      await browser.close();
      return imagePath;
    } catch (error) {
      console.error('生成PNG图片详细错误:', error);
      throw new Error(`生成PNG图片失败: ${error.message}`);
    }
  }

  // 生成PDF文件
  async generatePDF(mindmapData, filename) {
    try {
      const htmlPath = await this.generateHTML(mindmapData, filename);
      const pdfPath = path.join(this.outputDir, 'pdfs', `${filename}.pdf`);
      
      const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
      });
      
      const page = await browser.newPage();
      
      // 使用绝对路径
      const absoluteHtmlPath = path.resolve(htmlPath);
      const fileUrl = `file://${absoluteHtmlPath}`;
      
      console.log('正在访问HTML文件生成PDF:', fileUrl);
      await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20px',
          right: '20px',
          bottom: '20px',
          left: '20px'
        }
      });
      
      await browser.close();
      return pdfPath;
    } catch (error) {
      console.error('生成PDF文件详细错误:', error);
      throw new Error(`生成PDF文件失败: ${error.message}`);
    }
  }

  // 生成所有格式的思维导图
  async generateAllFormats(mindmapData, filename) {
    try {
      const results = {};
      
      // 生成HTML（必需）
      results.html = await this.generateHTML(mindmapData, filename);
      
      // 尝试生成PNG（可选）
      try {
        results.png = await this.generatePNG(mindmapData, filename);
        console.log('PNG生成成功');
      } catch (pngError) {
        console.warn('PNG生成失败，跳过:', pngError.message);
        results.png = null;
      }
      
      // 尝试生成PDF（可选）
      try {
        results.pdf = await this.generatePDF(mindmapData, filename);
        console.log('PDF生成成功');
      } catch (pdfError) {
        console.warn('PDF生成失败，跳过:', pdfError.message);
        results.pdf = null;
      }
      
      return results;
    } catch (error) {
      throw new Error(`生成思维导图失败: ${error.message}`);
    }
  }

  // 清理旧文件
  async cleanupOldFiles(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7天
    try {
      const now = Date.now();
      const dirs = ['images', 'pdfs', 'html'];
      
      for (const dir of dirs) {
        const dirPath = path.join(this.outputDir, dir);
        if (await fs.pathExists(dirPath)) {
          const files = await fs.readdir(dirPath);
          
          for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stats = await fs.stat(filePath);
            
            if (now - stats.mtime.getTime() > maxAge) {
              await fs.remove(filePath);
              console.log(`删除旧文件: ${filePath}`);
            }
          }
        }
      }
    } catch (error) {
      console.error('清理旧文件失败:', error.message);
    }
  }

  // 获取文件大小
  async getFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (error) {
      return 0;
    }
  }

  // 验证思维导图数据
  validateMindmapData(data) {
    return data && 
           typeof data === 'object' &&
           (data.title || data.nodes) &&
           Array.isArray(data.nodes);
  }
}

module.exports = MindmapGenerator;
