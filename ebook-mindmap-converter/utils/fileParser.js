const fs = require('fs-extra');
const path = require('path');
const epubParser = require('epub-parser');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { parse } = require('node-html-parser');
const AdmZip = require('adm-zip');

class FileParser {
  constructor() {
    this.supportedFormats = {
      'epub': this.parseEpub.bind(this),
      'pdf': this.parsePdf.bind(this),
      'txt': this.parseTxt.bind(this),
      'rtf': this.parseRtf.bind(this),
      'docx': this.parseDocx.bind(this),
      'mobi': this.parseMobi.bind(this),
      'azw': this.parseAzw.bind(this),
      'azw3': this.parseAzw3.bind(this),
      'cbr': this.parseCbr.bind(this),
      'cbz': this.parseCbz.bind(this)
    };
  }

  // 获取文件扩展名
  getFileExtension(filename) {
    return path.extname(filename).toLowerCase().substring(1);
  }

  // 检查文件格式是否支持
  isSupportedFormat(filename) {
    const ext = this.getFileExtension(filename);
    return this.supportedFormats.hasOwnProperty(ext);
  }

  // 解析文件
  async parseFile(filePath, filename) {
    const ext = this.getFileExtension(filename);
    
    if (!this.isSupportedFormat(filename)) {
      throw new Error(`不支持的文件格式: ${ext}`);
    }

    try {
      const parser = this.supportedFormats[ext];
      return await parser(filePath);
    } catch (error) {
      throw new Error(`解析文件失败: ${error.message}`);
    }
  }

  // 解析EPUB文件
  async parseEpub(filePath) {
    try {
      const epub = await epubParser.parse(filePath);
      let text = '';
      
      for (const chapter of epub.chapters) {
        if (chapter.content) {
          // 解析HTML内容
          const html = parse(chapter.content);
          text += html.text + '\n\n';
        }
      }
      
      return {
        title: epub.metadata.title || '未知标题',
        author: epub.metadata.creator || '未知作者',
        text: text.trim(),
        metadata: epub.metadata
      };
    } catch (error) {
      throw new Error(`EPUB解析失败: ${error.message}`);
    }
  }

  // 解析PDF文件
  async parsePdf(filePath) {
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      
      return {
        title: data.info?.Title || '未知标题',
        author: data.info?.Author || '未知作者',
        text: data.text,
        metadata: data.info
      };
    } catch (error) {
      throw new Error(`PDF解析失败: ${error.message}`);
    }
  }

  // 解析TXT文件
  async parseTxt(filePath) {
    try {
      const text = await fs.readFile(filePath, 'utf-8');
      const filename = path.basename(filePath, '.txt');
      
      return {
        title: filename,
        author: '未知作者',
        text: text,
        metadata: {}
      };
    } catch (error) {
      throw new Error(`TXT解析失败: ${error.message}`);
    }
  }

  // 解析RTF文件
  async parseRtf(filePath) {
    try {
      // RTF解析比较复杂，这里使用简单的文本提取
      const data = await fs.readFile(filePath, 'utf-8');
      // 简单的RTF标签移除
      const text = data.replace(/\{[^}]*\}/g, '').replace(/\\[a-z]+\d*\s?/g, '');
      const filename = path.basename(filePath, '.rtf');
      
      return {
        title: filename,
        author: '未知作者',
        text: text.trim(),
        metadata: {}
      };
    } catch (error) {
      throw new Error(`RTF解析失败: ${error.message}`);
    }
  }

  // 解析DOCX文件
  async parseDocx(filePath) {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      const filename = path.basename(filePath, '.docx');
      
      return {
        title: filename,
        author: '未知作者',
        text: result.value,
        metadata: {}
      };
    } catch (error) {
      throw new Error(`DOCX解析失败: ${error.message}`);
    }
  }

  // 解析MOBI文件（简化处理）
  async parseMobi(filePath) {
    try {
      // MOBI文件解析比较复杂，这里提供基础框架
      // 实际项目中可能需要使用专门的MOBI解析库
      const data = await fs.readFile(filePath);
      const filename = path.basename(filePath, '.mobi');
      
      // 这里只是示例，实际需要专门的MOBI解析器
      return {
        title: filename,
        author: '未知作者',
        text: 'MOBI文件解析功能需要专门的解析库',
        metadata: {}
      };
    } catch (error) {
      throw new Error(`MOBI解析失败: ${error.message}`);
    }
  }

  // 解析AZW文件
  async parseAzw(filePath) {
    try {
      // AZW是亚马逊专有格式，解析比较复杂
      const filename = path.basename(filePath, '.azw');
      
      return {
        title: filename,
        author: '未知作者',
        text: 'AZW文件解析功能需要专门的解析库',
        metadata: {}
      };
    } catch (error) {
      throw new Error(`AZW解析失败: ${error.message}`);
    }
  }

  // 解析AZW3文件
  async parseAzw3(filePath) {
    try {
      // AZW3是AZW的升级版，解析更复杂
      const filename = path.basename(filePath, '.azw3');
      
      return {
        title: filename,
        author: '未知作者',
        text: 'AZW3文件解析功能需要专门的解析库',
        metadata: {}
      };
    } catch (error) {
      throw new Error(`AZW3解析失败: ${error.message}`);
    }
  }

  // 解析CBR文件（漫画）
  async parseCbr(filePath) {
    try {
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries();
      const filename = path.basename(filePath, '.cbr');
      
      let imageList = [];
      entries.forEach(entry => {
        if (entry.entryName.match(/\.(jpg|jpeg|png|gif)$/i)) {
          imageList.push(entry.entryName);
        }
      });
      
      return {
        title: filename,
        author: '未知作者',
        text: `漫画文件，包含 ${imageList.length} 张图片`,
        metadata: { images: imageList },
        isComic: true
      };
    } catch (error) {
      throw new Error(`CBR解析失败: ${error.message}`);
    }
  }

  // 解析CBZ文件（漫画）
  async parseCbz(filePath) {
    try {
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries();
      const filename = path.basename(filePath, '.cbz');
      
      let imageList = [];
      entries.forEach(entry => {
        if (entry.entryName.match(/\.(jpg|jpeg|png|gif)$/i)) {
          imageList.push(entry.entryName);
        }
      });
      
      return {
        title: filename,
        author: '未知作者',
        text: `漫画文件，包含 ${imageList.length} 张图片`,
        metadata: { images: imageList },
        isComic: true
      };
    } catch (error) {
      throw new Error(`CBZ解析失败: ${error.message}`);
    }
  }

  // 清理文本内容
  cleanText(text) {
    if (!text) return '';
    
    return text
      .replace(/\s+/g, ' ') // 合并多个空白字符
      .replace(/\n\s*\n/g, '\n\n') // 合并多个换行
      .trim();
  }

  // 获取文本摘要（前500字符）
  getTextSummary(text, maxLength = 500) {
    if (!text) return '';
    
    const cleaned = this.cleanText(text);
    return cleaned.length > maxLength 
      ? cleaned.substring(0, maxLength) + '...'
      : cleaned;
  }
}

module.exports = FileParser;
