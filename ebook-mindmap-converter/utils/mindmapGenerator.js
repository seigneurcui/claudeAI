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

  // 创建HTML模板，使用Mermaid渲染
  createHTMLTemplate(mindmapData) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${mindmapData.title || '思维导图'}</title>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
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
        .mermaid {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 400px;
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
        .error-message {
            background: #ffebee;
            color: #c62828;
            padding: 20px;
            margin: 20px;
            border-radius: 5px;
            border-left: 4px solid #c62828;
        }
        .outline-view {
            background: #f5f5f5;
            padding: 20px;
            margin: 20px;
            border-radius: 10px;
        }
        .outline-view ul {
            list-style-type: none;
            padding-left: 0;
        }
        .outline-view li {
            margin: 8px 0;
            padding: 5px;
        }
        .outline-view .level-0 {
            font-weight: bold;
            font-size: 1.2em;
            color: #1976d2;
            padding-left: 0;
        }
        .outline-view .level-1 {
            font-size: 1.1em;
            color: #388e3c;
            padding-left: 20px;
        }
        .outline-view .level-2 {
            color: #f57c00;
            padding-left: 40px;
        }
        .outline-view .level-3 {
            color: #7b1fa2;
            padding-left: 60px;
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
            <div class="mermaid">
                ${this.generateMermaidSyntax(mindmapData.nodes || [])}
            </div>
        </div>
        
        <div class="outline-view">
            <h3>大纲视图</h3>
            ${this.generateOutlineView(mindmapData.nodes || [])}
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
    <script>
        mermaid.initialize({ 
            startOnLoad: true, 
            theme: 'default',
            mindmap: {
                padding: 20,
                useMaxWidth: true,
                htmlLabels: false
            },
            securityLevel: 'loose'
        });
    </script>
</body>
</html>`;
  }

  // 生成Mermaid语法 - 修复版本
  generateMermaidSyntax(nodes) {
    if (!nodes || nodes.length === 0) {
      return 'mindmap\n  root((暂无思维导图数据))';
    }

    try {
      // 清理和验证节点数据
      const cleanedNodes = this.cleanNodesForMermaid(nodes);
      
      // 查找根节点
      const rootNodes = cleanedNodes.filter(node => node.level === 0);
      const rootNode = rootNodes.length > 0 ? rootNodes[0] : cleanedNodes[0];
      
      // 生成Mermaid语法
      let mermaidSyntax = 'mindmap\n';
      mermaidSyntax += `  root((${this.sanitizeLabel(rootNode.label)}))\n`;
      
      // 处理所有节点（排除根节点）
      const allNodes = this.flattenNodes(cleanedNodes);
      const nonRootNodes = allNodes.filter(node => node.id !== rootNode.id);
      
      // 按层级分组节点
      const nodesByLevel = {};
      nonRootNodes.forEach(node => {
        const level = node.level || 1;
        if (!nodesByLevel[level]) nodesByLevel[level] = [];
        nodesByLevel[level].push(node);
      });
      
      // 按层级顺序生成
      const levels = Object.keys(nodesByLevel).map(Number).sort();
      levels.forEach(level => {
        nodesByLevel[level].forEach(node => {
          const indent = '  '.repeat(level + 1);
          mermaidSyntax += `${indent}${this.sanitizeLabel(node.label)}\n`;
        });
      });
      
      console.log('生成的Mermaid语法:', mermaidSyntax);
      return mermaidSyntax;
    } catch (error) {
      console.error('生成Mermaid语法错误:', error);
      // 返回简化的备用版本
      return this.generateSimpleMermaidSyntax(nodes);
    }
  }

  // 扁平化节点结构
  flattenNodes(nodes) {
    let flatNodes = [];
    
    const flatten = (nodeList) => {
      nodeList.forEach(node => {
        flatNodes.push(node);
        if (node.children && node.children.length > 0) {
          flatten(node.children);
        }
      });
    };
    
    flatten(nodes);
    return flatNodes;
  }

  // 清理节点数据用于Mermaid
  cleanNodesForMermaid(nodes) {
    return nodes.map(node => ({
      ...node,
      label: this.sanitizeLabel(node.label || '未命名'),
      level: typeof node.level === 'number' ? node.level : 0,
      children: Array.isArray(node.children) ? this.cleanNodesForMermaid(node.children) : []
    }));
  }

  // 清理标签文本 - 修复版本
  sanitizeLabel(label) {
    if (!label) return '未命名';
    
    // 移除特殊字符和多余空格
    return String(label)
      .replace(/[()[\]{}]/g, '') // 移除括号
      .replace(/["\n\r\t]/g, ' ') // 替换引号和换行
      .replace(/\s+/g, ' ') // 合并多个空格
      .replace(/[""]/g, '') // 移除中文引号
      .replace(/记住：.*$/, '') // 移除指令文字
      .replace(/请注意：.*$/, '') // 移除指令文字
      .replace(/注意：.*$/, '') // 移除指令文字
      .replace(/提示：.*$/, '') // 移除指令文字
      .trim()
      .substring(0, 30) || '未命名'; // 限制长度
  }

  // 生成简化的Mermaid语法（备用方案）
  generateSimpleMermaidSyntax(nodes) {
    if (!nodes || nodes.length === 0) {
      return 'mindmap\n  root((暂无数据))';
    }
    
    const rootLabel = nodes[0]?.label || '中心主题';
    let syntax = `mindmap\n  root((${this.sanitizeLabel(rootLabel)}))\n`;
    
    // 只处理第一层节点，避免复杂的嵌套
    const firstLevelNodes = nodes.filter(node => node.level === 1);
    firstLevelNodes.forEach(node => {
      syntax += `    ${this.sanitizeLabel(node.label)}\n`;
    });
    
    // 如果没有第一层节点，使用所有节点
    if (firstLevelNodes.length === 0) {
      nodes.slice(1, 6).forEach(node => { // 最多显示5个节点
        syntax += `    ${this.sanitizeLabel(node.label)}\n`;
      });
    }
    
    return syntax;
  }

  // 生成大纲视图
  generateOutlineView(nodes) {
    if (!nodes || nodes.length === 0) {
      return '<p>暂无思维导图数据</p>';
    }

    const generateOutlineNodes = (nodeList, parentLevel = -1) => {
      return nodeList
        .filter(node => (node.level || 0) === parentLevel + 1)
        .map(node => {
          const level = node.level || 0;
          let html = `<li class="level-${level}">${this.sanitizeLabel(node.label) || '未命名'}</li>`;
          
          // 处理子节点
          const childNodes = nodeList.filter(child => 
            child.level === level + 1 && 
            (child.parentId === node.id || (node.children && node.children.some(c => c.id === child.id)))
          );
          
          if (node.children && node.children.length > 0) {
            html += '<ul>' + this.generateOutlineFromChildren(node.children) + '</ul>';
          } else if (childNodes.length > 0) {
            html += '<ul>' + generateOutlineNodes(nodeList, level) + '</ul>';
          }
          
          return html;
        }).join('');
    };

    return `<ul>${generateOutlineNodes(nodes)}</ul>`;
  }

  // 从子节点生成大纲
  generateOutlineFromChildren(children) {
    return children.map(child => {
      const level = child.level || 0;
      let html = `<li class="level-${level}">${this.sanitizeLabel(child.label) || '未命名'}</li>`;
      
      if (child.children && child.children.length > 0) {
        html += '<ul>' + this.generateOutlineFromChildren(child.children) + '</ul>';
      }
      
      return html;
    }).join('');
  }

  // 生成PNG图片
  async generatePNG(mindmapData, filename) {
    try {
      const htmlPath = await this.generateHTML(mindmapData, filename);
      const imagePath = path.join(this.outputDir, 'images', `${filename}.png`);
      
      const browser = await puppeteer.launch({
        headless: "new",
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox', 
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ]
      });
      
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 800 });
      
      // 使用绝对路径
      const absoluteHtmlPath = path.resolve(htmlPath);
      const fileUrl = `file://${absoluteHtmlPath}`;
      
      console.log('正在访问HTML文件:', fileUrl);
      await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      
      // 等待Mermaid渲染完成，有超时保护
      try {
        await page.waitForFunction(
          'document.querySelector(".mermaid svg") || document.querySelector(".mermaid .error")', 
          { timeout: 15000 }
        );
      } catch (waitError) {
        console.warn('Mermaid渲染超时，继续截图');
      }
      
      // 添加短暂延迟确保渲染完成
      await page.waitForTimeout(2000);
      
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
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox', 
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ]
      });
      
      const page = await browser.newPage();
      
      // 使用绝对路径
      const absoluteHtmlPath = path.resolve(htmlPath);
      const fileUrl = `file://${absoluteHtmlPath}`;
      
      console.log('正在访问HTML文件生成PDF:', fileUrl);
      await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      
      // 等待Mermaid渲染完成
      try {
        await page.waitForFunction(
          'document.querySelector(".mermaid svg") || document.querySelector(".mermaid .error")', 
          { timeout: 15000 }
        );
      } catch (waitError) {
        console.warn('Mermaid渲染超时，继续生成PDF');
      }
      
      // 添加短暂延迟
      await page.waitForTimeout(2000);
      
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
      
      // 验证数据
      if (!this.validateMindmapData(mindmapData)) {
        throw new Error('思维导图数据格式无效');
      }
      
      // 生成HTML（必需）
      results.html = await this.generateHTML(mindmapData, filename);
      console.log('HTML生成成功');
      
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

  // 生成Canvas版本的思维导图（备用方案）
  async generateCanvasMindmap(mindmapData, filename) {
    try {
      const canvas = createCanvas(1200, 800);
      const ctx = canvas.getContext('2d');
      
      // 设置背景
      const gradient = ctx.createLinearGradient(0, 0, 1200, 800);
      gradient.addColorStop(0, '#667eea');
      gradient.addColorStop(1, '#764ba2');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1200, 800);
      
      // 设置字体
      ctx.font = '24px Microsoft YaHei, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'white';
      
      // 绘制标题
      ctx.fillText(mindmapData.title || '思维导图', 600, 50);
      
      // 绘制节点
      if (mindmapData.nodes && mindmapData.nodes.length > 0) {
        this.drawCanvasNodes(ctx, mindmapData.nodes);
      }
      
      // 保存图片
      const imagePath = path.join(this.outputDir, 'images', `${filename}_canvas.png`);
      const buffer = canvas.toBuffer('image/png');
      await fs.writeFile(imagePath, buffer);
      
      return imagePath;
    } catch (error) {
      console.error('生成Canvas思维导图失败:', error);
      return null;
    }
  }

  // 在Canvas上绘制节点
  drawCanvasNodes(ctx, nodes) {
    const centerX = 600;
    const centerY = 400;
    const radius = 200;
    
    // 绘制中心节点
    const rootNode = nodes.find(node => node.level === 0) || nodes[0];
    if (rootNode) {
      ctx.fillStyle = '#4facfe';
      ctx.beginPath();
      ctx.arc(centerX, centerY, 50, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.fillStyle = 'white';
      ctx.font = '16px Microsoft YaHei';
      ctx.fillText(rootNode.label || '中心', centerX, centerY + 5);
    }
    
    // 绘制其他节点
    const otherNodes = nodes.filter(node => node !== rootNode);
    otherNodes.forEach((node, index) => {
      const angle = (2 * Math.PI * index) / otherNodes.length;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      
      // 绘制连接线
      ctx.strokeStyle = '#ffffff80';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x, y);
      ctx.stroke();
      
      // 绘制节点
      ctx.fillStyle = '#00f2fe';
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, 2 * Math.PI);
      ctx.fill();
      
      // 绘制文本
      ctx.fillStyle = 'white';
      ctx.font = '12px Microsoft YaHei';
      const label = (node.label || '').substring(0, 10);
      ctx.fillText(label, x, y + 3);
    });
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
    if (!data || typeof data !== 'object') return false;
    
    // 至少需要标题或节点
    if (!data.title && (!data.nodes || !Array.isArray(data.nodes))) return false;
    
    // 如果有节点，验证节点结构
    if (data.nodes && Array.isArray(data.nodes)) {
      return data.nodes.every(node => 
        node && typeof node === 'object' && 
        (node.label || node.id) &&
        typeof node.level !== 'undefined'
      );
    }
    
    return true;
  }

  // 获取生成统计信息
  getGenerationStats(mindmapData) {
    const totalNodes = this.countAllNodes(mindmapData.nodes || []);
    const maxDepth = this.getMaxDepth(mindmapData.nodes || []);
    
    return {
      title: mindmapData.title || '未命名',
      totalNodes: totalNodes,
      maxDepth: maxDepth,
      hasKeywords: !!(mindmapData.keywords && mindmapData.keywords.length > 0),
      hasThemes: !!(mindmapData.themes && mindmapData.themes.length > 0),
      hasSummary: !!(mindmapData.summary && mindmapData.summary.length > 0)
    };
  }

  // 计算所有节点数量
  countAllNodes(nodes) {
    let count = nodes.length;
    nodes.forEach(node => {
      if (node.children && node.children.length > 0) {
        count += this.countAllNodes(node.children);
      }
    });
    return count;
  }

  // 获取最大深度
  getMaxDepth(nodes) {
    if (nodes.length === 0) return 0;
    
    let maxDepth = 1;
    nodes.forEach(node => {
      if (node.children && node.children.length > 0) {
        const childDepth = 1 + this.getMaxDepth(node.children);
        maxDepth = Math.max(maxDepth, childDepth);
      }
    });
    
    return maxDepth;
  }
}

module.exports = MindmapGenerator;
