const fs = require('fs-extra');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { parse } = require('node-html-parser');
const AdmZip = require('adm-zip');
const StreamZip = require('node-stream-zip');
const iconv = require('iconv-lite'); // Add iconv-lite

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
      'cbz': this.parseCbz.bind(this),
      'html': this.parseHtml.bind(this),
      'htm': this.parseHtml.bind(this)
    };
  }

  // Get file extension
  getFileExtension(filename) {
    return path.extname(filename).toLowerCase().substring(1);
  }

  // Check if file format is supported
  isSupportedFormat(filename) {
    const ext = this.getFileExtension(filename);
    return this.supportedFormats.hasOwnProperty(ext);
  }

  // Parse file
  async parseFile(filePath, filename) {
    const ext = this.getFileExtension(filename);
    
    // Debug: Log received filename
    console.log(`Received filename in parseFile: ${filename}, extension: ${ext}`);

    if (!this.isSupportedFormat(filename)) {
      throw new Error(`不支持的文件格式: ${ext}`);
    }

    try {
      console.log(`开始解析文件: ${filename}, 格式: ${ext}`);
      const parser = this.supportedFormats[ext];
      const result = await parser(filePath);
      console.log(`文件解析成功: ${filename}`);
      return result;
    } catch (error) {
      console.error(`解析文件失败 (${filename}):`, error);
      throw new Error(`解析文件失败: ${error.message}`);
    }
  }

  // Parse EPUB file
  async parseEpub(filePath) {
    try {
      console.log('开始解析EPUB文件...');
      
      const zip = new StreamZip.async({ file: filePath });
      
      let opfPath = '';
      try {
        const containerData = await zip.entryData('META-INF/container.xml');
        const containerXml = containerData.toString();
        const opfMatch = containerXml.match(/full-path="([^"]+)"/);
        if (opfMatch) {
          opfPath = opfMatch[1];
        }
      } catch (e) {
        console.warn('无法读取container.xml，尝试查找OPF文件');
        const entries = await zip.entries();
        for (const entry of Object.values(entries)) {
          if (entry.name.endsWith('.opf')) {
            opfPath = entry.name;
            break;
          }
        }
      }
      
      let title = '未知标题';
      let author = '未知作者';
      let text = '';
      
      if (opfPath) {
        try {
          const opfData = await zip.entryData(opfPath);
          const opfXml = opfData.toString();
          
          const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
          if (titleMatch) {
            title = titleMatch[1].trim();
          }
          
          const authorMatch = opfXml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
          if (authorMatch) {
            author = authorMatch[1].trim();
          }
          
          const spineMatches = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
          if (spineMatches) {
            const itemrefMatches = spineMatches[1].match(/<itemref[^>]*idref="([^"]+)"/g);
            if (itemrefMatches) {
              const baseDir = path.dirname(opfPath);
              
              for (const itemref of itemrefMatches) {
                const idMatch = itemref.match(/idref="([^"]+)"/);
                if (idMatch) {
                  const id = idMatch[1];
                  const hrefMatch = opfXml.match(new RegExp(`<item[^>]*id="${id}"[^>]*href="([^"]+)"`));
                  if (hrefMatch) {
                    const chapterPath = baseDir ? `${baseDir}/${hrefMatch[1]}` : hrefMatch[1];
                    try {
                      const chapterData = await zip.entryData(chapterPath);
                      const chapterHtml = chapterData.toString();
                      const chapterText = this.extractTextFromHtml(chapterHtml);
                      text += chapterText + '\n\n';
                    } catch (chapterError) {
                      console.warn(`无法读取章节: ${chapterPath}`);
                    }
                  }
                }
              }
            }
          }
        } catch (opfError) {
          console.warn('解析OPF文件失败，尝试读取所有HTML/XHTML文件');
        }
      }
      
      if (!text.trim()) {
        const entries = await zip.entries();
        for (const entry of Object.values(entries)) {
          if (entry.name.match(/\.(html|xhtml)$/i) && !entry.isDirectory) {
            try {
              const data = await zip.entryData(entry.name);
              const html = data.toString();
              text += this.extractTextFromHtml(html) + '\n\n';
            } catch (e) {
              console.warn(`无法读取文件: ${entry.name}`);
            }
          }
        }
      }
      
      await zip.close();
      
      return {
        title: title,
        author: author,
        text: text.trim(),
        metadata: { format: 'EPUB' }
      };
    } catch (error) {
      console.error('EPUB解析详细错误:', error);
      throw new Error(`EPUB解析失败: ${error.message}`);
    }
  }

  // Extract text from HTML
  extractTextFromHtml(html) {
    try {
      const root = parse(html);
      return root.text.replace(/\s+/g, ' ').trim();
    } catch (e) {
      return html
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }

  // Parse PDF file
  async parsePdf(filePath) {
    try {
      console.log('开始解析PDF文件...');
      const dataBuffer = await fs.readFile(filePath);
      const data = await pdfParse(dataBuffer);
      
      return {
        title: data.info?.Title || path.basename(filePath, '.pdf'),
        author: data.info?.Author || '未知作者',
        text: data.text,
        metadata: {
          ...data.info,
          pages: data.numpages,
          format: 'PDF'
        }
      };
    } catch (error) {
      throw new Error(`PDF解析失败: ${error.message}`);
    }
  }

  // Parse TXT file
  async parseTxt(filePath) {
    try {
      console.log('开始解析TXT文件...');
      const buffer = await fs.readFile(filePath);
      let text;

      // Try decoding with different encodings
      try {
        text = buffer.toString('utf8');
        if (/�/.test(text)) {
          throw new Error('UTF-8 decoding failed');
        }
      } catch (e) {
        try {
          text = iconv.decode(buffer, 'gbk');
          if (/�/.test(text)) {
            throw new Error('GBK decoding failed');
          }
        } catch (e2) {
          text = iconv.decode(buffer, 'gb2312');
          if (/�/.test(text)) {
            console.warn(`All decoding attempts failed for ${filePath}, using latin1 as fallback`);
            text = buffer.toString('latin1');
          }
        }
      }

      const filename = path.basename(filePath, '.txt');
      
      return {
        title: filename,
        author: '未知作者',
        text: text,
        metadata: { format: 'TXT' }
      };
    } catch (error) {
      throw new Error(`TXT解析失败: ${error.message}`);
    }
  }

  // Parse RTF file
  async parseRtf(filePath) {
    try {
      console.log('开始解析RTF文件...');
      const buffer = await fs.readFile(filePath);
      let text;

      try {
        text = iconv.decode(buffer, 'utf8');
        if (/�/.test(text)) {
          throw new Error('UTF-8 decoding failed');
        }
      } catch (e) {
        text = iconv.decode(buffer, 'gbk');
        if (/�/.test(text)) {
          text = iconv.decode(buffer, 'gb2312');
          if (/�/.test(text)) {
            console.warn(`All decoding attempts failed for ${filePath}, using latin1 as fallback`);
            text = buffer.toString('latin1');
          }
        }
      }

      // Simple RTF tag removal
      text = text
        .replace(/\\[a-z]+\d*\s?/g, '')
        .replace(/\{[^}]*\}/g, '')
        .replace(/\\[^a-z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      const filename = path.basename(filePath, '.rtf');
      
      return {
        title: filename,
        author: '未知作者',
        text: text,
        metadata: { format: 'RTF' }
      };
    } catch (error) {
      throw new Error(`RTF解析失败: ${error.message}`);
    }
  }

  // Parse DOCX file
  async parseDocx(filePath) {
    try {
      console.log('开始解析DOCX文件...');
      const result = await mammoth.extractRawText({ path: filePath });
      const filename = path.basename(filePath, '.docx');
      
      return {
        title: filename,
        author: '未知作者',
        text: result.value,
        metadata: { 
          format: 'DOCX',
          messages: result.messages
        }
      };
    } catch (error) {
      throw new Error(`DOCX解析失败: ${error.message}`);
    }
  }

  // Parse HTML file
  async parseHtml(filePath) {
    try {
      console.log('开始解析HTML文件...');
      const buffer = await fs.readFile(filePath);
      let html;

      try {
        html = buffer.toString('utf8');
        if (/�/.test(html)) {
          throw new Error('UTF-8 decoding failed');
        }
      } catch (e) {
        html = iconv.decode(buffer, 'gbk');
        if (/�/.test(html)) {
          html = iconv.decode(buffer, 'gb2312');
          if (/�/.test(html)) {
            console.warn(`All decoding attempts failed for ${filePath}, using latin1 as fallback`);
            html = buffer.toString('latin1');
          }
        }
      }

      const root = parse(html);
      let title = path.basename(filePath, path.extname(filePath));
      const titleElement = root.querySelector('title');
      if (titleElement) {
        title = titleElement.text.trim() || title;
      }
      
      let author = '未知作者';
      const authorMeta = root.querySelector('meta[name="author"]');
      if (authorMeta) {
        author = authorMeta.getAttribute('content') || author;
      }
      
      return {
        title: title,
        author: author,
        text: this.extractTextFromHtml(html),
        metadata: { format: 'HTML' }
      };
    } catch (error) {
      throw new Error(`HTML解析失败: ${error.message}`);
    }
  }

  // Parse MOBI file
  async parseMobi(filePath) {
    try {
      console.log('开始解析MOBI文件...');
      const data = await fs.readFile(filePath);
      const filename = path.basename(filePath, '.mobi');
      
      let title = filename;
      let text = 'MOBI文件解析功能需要专门的解析库';
      
      const dataStr = data.toString('latin1');
      const textMatch = dataStr.match(/[\x20-\x7E\s]{100,}/g);
      if (textMatch && textMatch.length > 0) {
        text = textMatch.join(' ').trim();
      }
      
      return {
        title: title,
        author: '未知作者',
        text: text,
        metadata: { format: 'MOBI' }
      };
    } catch (error) {
      throw new Error(`MOBI解析失败: ${error.message}`);
    }
  }

  // Parse AZW file
  async parseAzw(filePath) {
    try {
      console.log('开始解析AZW文件...');
      const filename = path.basename(filePath, '.azw');
      
      return {
        title: filename,
        author: '未知作者',
        text: 'AZW文件解析功能需要专门的解析库。AZW是亚马逊专有的电子书格式，通常需要特殊的解密和解析工具。',
        metadata: { format: 'AZW' }
      };
    } catch (error) {
      throw new Error(`AZW解析失败: ${error.message}`);
    }
  }

  // Parse AZW3 file
  async parseAzw3(filePath) {
    try {
      console.log('开始解析AZW3文件...');
      const filename = path.basename(filePath, '.azw3');
      
      return {
        title: filename,
        author: '未知作者',
        text: 'AZW3文件解析功能需要专门的解析库。AZW3是AZW的升级版，是亚马逊Kindle专用格式，需要特殊的解析工具。',
        metadata: { format: 'AZW3' }
      };
    } catch (error) {
      throw new Error(`AZW3解析失败: ${error.message}`);
    }
  }

  // Parse CBR file
  async parseCbr(filePath) {
    try {
      console.log('开始解析CBR文件...');
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries();
      const filename = path.basename(filePath, '.cbr');
      
      let imageList = [];
      entries.forEach(entry => {
        if (entry.entryName.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)) {
          imageList.push(entry.entryName);
        }
      });
      
      imageList.sort();
      
      return {
        title: filename,
        author: '未知作者',
        text: `漫画文件，包含 ${imageList.length} 张图片。这是一个压缩的图片集合，主要用于阅读漫画。由于主要内容是图像，无法提取大量文本内容。`,
        metadata: { 
          format: 'CBR',
          images: imageList,
          imageCount: imageList.length
        },
        isComic: true
      };
    } catch (error) {
      throw new Error(`CBR解析失败: ${error.message}`);
    }
  }

  // Parse CBZ file
  async parseCbz(filePath) {
    try {
      console.log('开始解析CBZ文件...');
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries();
      const filename = path.basename(filePath, '.cbz');
      
      let imageList = [];
      entries.forEach(entry => {
        if (entry.entryName.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)) {
          imageList.push(entry.entryName);
        }
      });
      
      imageList.sort();
      
      return {
        title: filename,
        author: '未知作者',
        text: `漫画文件，包含 ${imageList.length} 张图片。这是一个压缩的图片集合，主要用于阅读漫画。由于主要内容是图像，无法提取大量文本内容。`,
        metadata: { 
          format: 'CBZ',
          images: imageList,
          imageCount: imageList.length
        },
        isComic: true
      };
    } catch (error) {
      throw new Error(`CBZ解析失败: ${error.message}`);
    }
  }

  // Clean text content
  cleanText(text) {
    if (!text) return '';
    
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim();
  }

  // Get text summary
  getTextSummary(text, maxLength = 500) {
    if (!text) return '';
    
    const cleaned = this.cleanText(text);
    return cleaned.length > maxLength 
      ? cleaned.substring(0, maxLength) + '...'
      : cleaned;
  }

  // Validate file existence and readability
  async validateFile(filePath) {
    try {
      await fs.access(filePath, fs.constants.R_OK);
      const stats = await fs.stat(filePath);
      return {
        exists: true,
        size: stats.size,
        isFile: stats.isFile()
      };
    } catch (error) {
      return {
        exists: false,
        error: error.message
      };
    }
  }

  // Get supported file formats
  getSupportedFormats() {
    return Object.keys(this.supportedFormats);
  }

  // Get file info
  async getFileInfo(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const ext = this.getFileExtension(path.basename(filePath));
      
      return {
        name: path.basename(filePath),
        size: stats.size,
        extension: ext,
        supported: this.isSupportedFormat(path.basename(filePath)),
        created: stats.birthtime,
        modified: stats.mtime
      };
    } catch (error) {
      throw new Error(`获取文件信息失败: ${error.message}`);
    }
  }
}

module.exports = FileParser;
