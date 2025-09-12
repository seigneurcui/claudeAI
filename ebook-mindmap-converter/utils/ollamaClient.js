const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = util.promisify(exec);

class OllamaClient {
  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 10000, // 10秒超时
      headers: {
        'Content-Type': 'application/json'
      },
      // 添加更多配置选项
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 300; // 默认
      }
    });
  }

  // 获取可用的模型列表
  async getModels() {
    try {
      console.log('正在获取Ollama模型列表...');
      
      // 首先尝试使用HTTP API
      try {
        const response = await this.client.get('/api/tags');
        if (response.data && response.data.models) {
          console.log('通过HTTP API获取模型成功:', response.data.models.length, '个模型');
          return response.data.models;
        }
      } catch (httpError) {
        console.log('HTTP API失败，尝试使用命令行...');
      }
      
      // 如果HTTP API失败，使用命令行
      try {
        const { stdout } = await execAsync('ollama list');
        // 解析ollama list的输出格式
        const lines = stdout.trim().split('\n');
        const models = [];
        
        // 跳过标题行
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line) {
            const parts = line.split(/\s+/);
            if (parts.length >= 3) {
              models.push({
                name: parts[0],
                model: parts[0],
                size: parseInt(parts[2]) || 0,
                modified_at: new Date().toISOString()
              });
            }
          }
        }
        
        console.log('通过命令行获取模型成功:', models.length, '个模型');
        return models;
      } catch (cmdError) {
        console.error('命令行获取模型失败:', cmdError.message);
        throw new Error('无法获取Ollama模型列表');
      }
      
    } catch (error) {
      console.error('获取模型列表失败:', error.message);
      throw new Error(`获取模型列表失败: ${error.message}`);
    }
  }

  // 检查模型是否存在
  async checkModel(modelName) {
    try {
      const models = await this.getModels();
      const exists = models.some(model => model.name === modelName);
      console.log(`检查模型 ${modelName}: ${exists ? '存在' : '不存在'}`);
      return exists;
    } catch (error) {
      console.error('检查模型失败:', error.message);
      // 如果无法获取模型列表，假设模型存在（因为前端会显示默认模型）
      console.log(`无法检查模型 ${modelName}，假设存在`);
      return true;
    }
  }

  // 拉取模型
  async pullModel(modelName) {
    try {
      const response = await this.client.post('/api/pull', {
        name: modelName,
        stream: false
      });
      return response.data;
    } catch (error) {
      console.error('拉取模型失败:', error.message);
      throw new Error(`拉取模型失败: ${error.message}`);
    }
  }
  
  /**
   * 命令行调用
   */
  async generateViaCommand(model, prompt) {
    return new Promise((resolve, reject) => {
      // 转义提示词中的特殊字符
      const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      
      const command = `ollama generate ${model} "${escapedPrompt}"`;
      
      exec(command, {
        timeout: this.timeout || 10000,
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`命令执行失败: ${error.message}`));
          return;
        }
        
        if (stderr && stderr.trim()) {
          console.log('⚠️ 命令行警告:', stderr);
        }
        
        resolve(stdout.trim());
      });
    });
  }

  // 生成思维导图
  async generateMindmap(text, modelName = 'llama3.2:1b', options = {}) {
    try {
      // 构建思维导图生成的提示词
      const prompt = this.buildMindmapPrompt(text, options);
      
      // 首先尝试使用HTTP API
      try {
        const requestData = {
          model: modelName,
          prompt: prompt,
          stream: false,
          options: {
            temperature: options.temperature || 0.7,
            top_p: options.top_p || 0.9,
            max_tokens: options.max_tokens || 2000
          }
        };

        const response = await this.client.post('/api/generate', requestData);
        
        if (response.data && response.data.response) {
          return this.parseMindmapResponse(response.data.response, text);
        }
      } catch (httpError) {
        console.log('HTTP API生成失败，尝试使用命令行...');
      }
      
      try {
        // 回退到命令行
        console.log('💻 回退到命令行...');
        const result = await this.generateViaCommand(modelName, prompt);
        if (result) {
          console.log('✅ 命令行成功');
          return this.parseMindmapResponse(result, text);
        }
      } catch (error) {
        console.log('❌ 命令行也失败:', error.message);
      }
      
      // 如果HTTP API失败，使用命令行
      try {
        // 将提示词写入临时文件
        const tempFile = path.join(__dirname, '..', 'temp_prompt.txt');
        fs.writeFileSync(tempFile, prompt);
        
        // 使用ollama命令生成
        const { stdout } = await execAsync(`ollama run ${modelName} < "${tempFile}"`);
        
        // 清理临时文件
        fs.unlinkSync(tempFile);
        
        return this.parseMindmapResponse(stdout, text);
      } catch (cmdError) {
        console.error('命令行生成失败:', cmdError.message);
        throw new Error(`生成思维导图失败: ${cmdError.message}`);
      }
    } catch (error) {
      console.error('生成思维导图失败:', error.message);
      throw new Error(`生成思维导图失败: ${error.message}`);
    }
  }

  // 构建思维导图提示词
  buildMindmapPrompt(text, options = {}) {
    const maxLength = options.maxTextLength || 2000;
    const truncatedText = text.length > maxLength 
      ? text.substring(0, maxLength) + '...' 
      : text;

    return `你是一个专业的思维导图生成助手。请严格按照以下要求生成JSON格式的思维导图：

【重要规则】
1. 只输出纯JSON，不要任何其他文字
2. 确保JSON语法完全正确
3. 所有字符串必须用双引号包围
4. 数组最后一个元素后不要加逗号
5. 对象最后一个属性后不要加逗号
6. 所有节点的label字段必须非空
7. 所有节点的label字段若少于10字，自动用该节点下一级节点的label字段来填充
8. title和summary字段必须有实际内容，不能为空

【必需的JSON结构】
{
  "title": "基于内容的具体标题",
  "summary": "内容的简要概述，不少于20字",
  "nodes": [
    {
      "id": "1",
      "label": "主要主题",
      "level": 0,
      "children": [
        {
          "id": "1-1",
          "label": "子主题1",
          "level": 1,
          "children": []
        }
      ]
    }
  ]
}

【字段说明】
- title: 思维导图主标题，必须基于实际内容生成
- summary: 内容摘要，不少于20字
- nodes: 节点数组，每个节点包含id、label、level、children
- id: 唯一标识符，必须是字符串
- label: 节点显示文字，不能为空，不能有多余引号
- level: 层级，根节点为0，子节点为1，以此类推
- children: 子节点数组，可以包含实际的子节点

【生成要求】
1. 根据内容生成6-10个节点
2. 确保有一个level为0的根节点
3. 其他节点level为1或2
4. label要简洁明确，且不能为空
5. id按顺序编号："1", "1-1", "1-2", "2", "2-1"...
6. 可以在合适的节点下添加实际的子节点
7. title必须反映实际内容，不能是通用标题
8. summary必须是对内容的真实概括

现在请基于以下内容生成符合上述要求的JSON：

${truncatedText}`;
  }

  // 解析思维导图响应 - 修复版本
  async parseMindmapResponse(response, originalText = '') {
    try {
      console.log('原始响应长度:', response.length);
      console.log('原始响应前500字符:', response.substring(0, 500));
      
      // 清理响应，移除可能的非JSON内容
      let cleanedResponse = response;
      
      // 移除可能的代码块标记
      cleanedResponse = cleanedResponse.replace(/```json\n|```/g, '');
      
      // 移除指令文字和额外说明
      cleanedResponse = cleanedResponse.replace(/记住：.*?$/gm, '');
      cleanedResponse = cleanedResponse.replace(/请注意：.*?$/gm, '');
      cleanedResponse = cleanedResponse.replace(/注意：.*?$/gm, '');
      cleanedResponse = cleanedResponse.replace(/提示：.*?$/gm, '');
      
      // 尝试提取最完整的JSON对象
      const jsonMatches = cleanedResponse.match(/\{[\s\S]*?\}(?=\s*(?:$|\n{2,}|\}|记住|请注意|注意|提示))/g);
      if (!jsonMatches || jsonMatches.length === 0) {
        console.log('未找到JSON对象');
        return this.createFallbackMindmap(originalText || response);
      }
      
      console.log(`找到 ${jsonMatches.length} 个JSON对象或片段`);
      
      // 尝试解析每个JSON对象，找到最合适的
      for (let i = 0; i < jsonMatches.length; i++) {
        let jsonStr = jsonMatches[i];
        
        // 核心修改：修复不规范的JSON
        jsonStr = this.fixInvalidJson(jsonStr);

        try {
          const mindmapData = JSON.parse(jsonStr);
          console.log(`尝试解析第 ${i + 1} 个JSON对象...`);
          
          // 验证数据结构
          if (this.validateMindmapData(mindmapData)) {
            // 修复空label字段并将level转换为数字
            mindmapData.nodes = this.cleanAndStructureNodes(mindmapData.nodes);
            
            // 确保title和summary不为空，并清理多余引号
            if (!mindmapData.title || mindmapData.title.trim() === '') {
              mindmapData.title = this.generateTitleFromContent(originalText || response);
            } else {
              mindmapData.title = this.cleanQuotes(mindmapData.title);
            }

 
            
            
            
            if (!mindmapData.summary || mindmapData.summary.trim() === '') {
              mindmapData.summary = this.generateSummaryFromContent(originalText || response);
            } else {
              mindmapData.summary = this.cleanQuotes(mindmapData.summary);
            }
            

            // ==================== [ 新增代码 ] ====================
            // 额外清理，强制移除提示词中的占位符文本
            const placeholders = [
              "基于内容的具体标题：", 
              "基于内容的具体标题",
              "基于内容的思维导图",
              "[此处应填入基于文本内容生成的标题]",
              "：", // 有时会留下一个冒号
            ];
            placeholders.forEach(ph => {
                mindmapData.title = mindmapData.title.replace(ph, '');
                mindmapData.summary = mindmapData.summary.replace(ph, '');
            });
            mindmapData.title = mindmapData.title.trim();
            mindmapData.summary = mindmapData.summary.trim();
            // ======================================================
            
                       
                       
                       

            // ==================== [ 新增代码 ] ====================
            // 额外清理，强制移除提示词中的占位符文本
            //~ const placeholders = [
              //~ "基于内容的具体标题：", 
              //~ "基于内容的具体标题",
              //~ "[此处应填入基于文本内容生成的标题]",
              //~ "：", // 有时会留下一个冒号
            //~ ];
            //~ placeholders.forEach(ph => {
                //~ mindmapData.summary = mindmapData.summary.replace(ph, '');
            //~ });
            //~ mindmapData.summary = mindmapData.summary.trim();
            // ======================================================
            
                             
            
            
            // 检查是否有实际内容（不是模板）
            if (this.hasActualContent(mindmapData)) {
              console.log(`成功解析第 ${i + 1} 个JSON对象，包含实际内容`);
              return mindmapData;
            } else {
              console.log(`第 ${i + 1} 个JSON对象是模板，继续尝试下一个`);
            }
          }
        } catch (parseError) {
          console.log(`第 ${i + 1} 个JSON对象解析失败:`, parseError.message);
          console.log('失败的JSON片段:', jsonStr.substring(0, 200) + '...');
          continue;
        }
      }
      
      // 如果所有JSON都解析失败，尝试最后一个（通常是最完整的）
      if (jsonMatches.length > 0) {
        let lastJson = jsonMatches[jsonMatches.length - 1];
        lastJson = this.fixInvalidJson(lastJson);
        
        try {
          const mindmapData = JSON.parse(lastJson);
          console.log('使用最后一个JSON对象作为备用');
          mindmapData.nodes = this.cleanAndStructureNodes(mindmapData.nodes);
          
          // 确保title和summary不为空，并清理多余引号
          if (!mindmapData.title || mindmapData.title.trim() === '') {
            mindmapData.title = this.generateTitleFromContent(originalText || response);
          } else {
            mindmapData.title = this.cleanQuotes(mindmapData.title);
          }
          
          if (!mindmapData.summary || mindmapData.summary.trim() === '') {
            mindmapData.summary = this.generateSummaryFromContent(originalText || response);
          } else {
            mindmapData.summary = this.cleanQuotes(mindmapData.summary);
          }
          
          return mindmapData;
        } catch (e) {
          console.log('最后一个JSON对象也解析失败');
        }
      }
      
      return this.createFallbackMindmap(originalText || response);
    } catch (error) {
      console.error('解析思维导图响应失败:', error.message);
      return this.createFallbackMindmap(originalText || response);
    }
  }
  
  // 修正函数：修复不规范的JSON - 增强版
  fixInvalidJson(jsonStr) {
    console.log('开始修复不规范的JSON...');
    let repairedJson = jsonStr;

    // 1. 修复 "key": "\"" + "value" + "\"" 这种不规范格式
    // 匹配并移除字符串值中的`"`和`+`以及空格
    repairedJson = repairedJson.replace(/:\s*"\s*\+\s*"\s*([^"]*?)\s*"\s*\+\s*"\s*"/g, ':"$1"');
    repairedJson = repairedJson.replace(/:\s*"([^"]*?)"\s*\+\s*"\s*"/g, ':"$1"');
    repairedJson = repairedJson.replace(/:\s*"\s*\+\s*"([^"]*?)"/g, ':"$1"');
    
    // 2. 修复 "key":\"value" 或 "key":"\"value\"" 这种不规范格式
    repairedJson = repairedJson.replace(/:\s*\\?"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, p1) => {
      let cleanedValue = p1.replace(/\\?"/g, '');
      cleanedValue = cleanedValue.replace(/"/g, '\\"');
      return `: "${cleanedValue}"`;
    });
    
    // 3. 替换非标准引号 " 和 " 为标准双引号 "
    repairedJson = repairedJson.replace(/[""'']/g, '"');
  
    // 4. 修复 "key": ""value"" 的格式为 "key": "value"
    repairedJson = repairedJson.replace(/"(\w+)":\s*""([^""]+)""/g, '"$1": "$2"');
  
    // 5. 移除数组或对象末尾的多余逗号
    repairedJson = repairedJson.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  
    // 6. 修复被截断的JSON，确保最后有}
    if (!repairedJson.trim().endsWith('}')) {
        console.log('检测到JSON截断，尝试修复...');
        // 匹配最后一个属性值后可能被截断的位置
        const lastValueMatch = repairedJson.match(/:\s*"(.*)/);
        if (lastValueMatch) {
            // 尝试闭合引号和括号
            repairedJson = repairedJson.substring(0, lastValueMatch.index) + '"}';
        }
    }
  
    // 7. 移除多余的换行符和回车符
    repairedJson = repairedJson.replace(/[\r\n]/g, '');

    // 8. 移除末尾的指令文字
    repairedJson = repairedJson.replace(/记住：.*$/, '');
    repairedJson = repairedJson.replace(/请注意：.*$/, '');
    repairedJson = repairedJson.replace(/注意：.*$/, '');
    repairedJson = repairedJson.replace(/提示：.*$/, '');
  
    console.log('JSON修复完成。');
    return repairedJson;
  }

  // 清理字符串中的多余引号
  cleanQuotes(str) {
    if (!str || typeof str !== 'string') return str;
    
    // 移除开头和结尾的多余引号
    return str.replace(/^["']+|["']+$/g, '').trim();
  }
  
  // 清理和结构化节点数据
  cleanAndStructureNodes(nodes) {
    return nodes.map(node => {
      // 清理label中的多余引号
      let cleanLabel = node.label || '未命名节点';
      
      // 移除开头和结尾的引号
      cleanLabel = cleanLabel.replace(/^["']+|["']+$/g, '');
      
      // 移除特殊字符
      cleanLabel = cleanLabel.replace(/[_"']/g, '').trim();
      
      // 如果清理后为空，提供默认值
      if (!cleanLabel) {
        cleanLabel = '未命名节点';
      }
      
      const cleanedNode = {
        ...node,
        label: cleanLabel,
        level: Number(node.level), // 强制转换为数字
        children: node.children || []
      };
      
      // 递归清理子节点
      if (cleanedNode.children && cleanedNode.children.length > 0) {
        cleanedNode.children = this.cleanAndStructureNodes(cleanedNode.children);
      }
      
      return cleanedNode;
    });
  }
  
  // 从内容生成标题
  generateTitleFromContent(content) {
    if (!content) return '文档思维导图';
    
    // 尝试提取第一行或前几个词作为标题
    const lines = content.split('\n');
    const firstLine = lines[0] ? lines[0].trim() : '';
    
    if (firstLine && firstLine.length < 50) {
      return firstLine;
    }
    
    // 提取前几个关键词
    const words = content.split(/\s+/).filter(word => word.length > 2);
    const keywords = words.slice(0, 3).join(' ');
    
    return keywords || '文档思维导图';
  }
  
  // 从内容生成摘要
  generateSummaryFromContent(content) {
    if (!content) return '这是一个基于文档内容生成的思维导图';
    
    // 取前200个字符作为摘要
    let summary = content.substring(0, 200).trim();
    
    // 确保摘要至少20字符
    if (summary.length < 20) {
      summary = '这是一个基于文档内容生成的思维导图，包含了文档的主要结构和关键信息点';
    }
    
    return summary + (content.length > 200 ? '...' : '');
  }

  // 验证思维导图数据
  validateMindmapData(data) {
    return data && 
           typeof data === 'object' &&
           data.nodes &&
           Array.isArray(data.nodes) &&
           data.nodes.length > 0 &&
           data.nodes.every(node => 
             node.id && 
             typeof node.label === 'string' && 
             node.label.trim() !== '' && 
             typeof node.level !== 'undefined' && 
             Array.isArray(node.children)
           );
  }

  // 检查是否有实际内容（不是模板） - 增强版
  hasActualContent(data) {
    // 检查标题是否不是默认模板
    const templateTitles = [
      '文档标题', '思维导图', '文档思维导图', '基于内容的具体标题', 
      '具体标题', '文档分析', '内容分析图'
    ];
    
    // 如果标题包含具体内容（如书名、专业术语等），认为是真实内容
    if (data.title && data.title.length > 5) {
      const hasSpecificContent = data.title.match(/[《》""''()（）]/g) || // 包含书名号或引号
                                data.title.includes('Entrepreneur') ||
                                data.title.includes('Business') ||
                                data.title.includes('Management') ||
                                data.title.length > 15; // 较长的标题通常是真实内容
      
      if (hasSpecificContent && !templateTitles.includes(data.title)) {
        console.log('标题包含具体内容，认为是真实数据');
        return true;
      }
    }
    
    // 检查节点是否有实际标签
    if (data.nodes && data.nodes.length > 0) {
      for (const node of data.nodes) {
        const templateLabels = [
          '主要主题', '子主题', '文档概述', '主要内容', '未命名节点',
          '核心概念', '重要细节', '详细分析', '要点总结', '关键信息'
        ];
        
        if (node.label && node.label.length > 3) {
          // 检查是否包含具体内容
          const hasSpecificContent = node.label.match(/[《》""''()（）]/g) || // 包含书名号或引号
                                    //~ node.label.includes('Introduction') ||
                                    //~ node.label.includes('Building') ||
                                    //~ node.label.includes('Financial') ||
                                    //~ node.label.includes('创业') ||
                                    //~ node.label.includes('管理') ||
                                    //~ node.label.includes('业务') ||
                                    node.label.length > 10; // 较长的标签
          
          if (hasSpecificContent && !templateLabels.includes(node.label)) {
            console.log(`节点包含具体内容: ${node.label}`);
            return true;
          }
        }
      }
    }
    
    // 检查摘要是否有实际内容
    if (data.summary && data.summary.trim().length > 30) {
      const templateSummaries = [
        '内容的简要概述', '这是一个基于文档内容生成的思维导图',
        '文档内容生成的详细思维导图'
      ];
      
      //~ const hasSpecificSummary = data.summary.includes('创业') ||
                                //~ data.summary.includes('企业') ||
                                //~ data.summary.includes('管理') ||
                                //~ data.summary.includes('business') ||
                                //~ data.summary.includes('entrepreneur') ||
                                //~ data.summary.length > 50;
      
      const hasSpecificSummary = data.summary.length > 50;
      
      if (hasSpecificSummary && !templateSummaries.some(template => data.summary.includes(template))) {
        console.log('摘要包含具体内容');
        return true;
      }
    }
    
    // 检查关键词是否有内容
    if (data.keywords && data.keywords.length > 0) {
      return true;
    }
    
    console.log('未检测到具体内容，可能是模板');
    return false;
  }

  // 创建备用思维导图结构
  createFallbackMindmap(response) {
    // 尝试从响应中提取一些有用信息
    const text = response.substring(0, 1000);
    const words = text.split(/\s+/).filter(word => word.length > 3);
    const keywords = [...new Set(words)].slice(0, 5);
    
    // 生成更有意义的标题
    const title = keywords.length > 0 ? keywords.slice(0, 2).join(' ') + ' 分析' : '文档思维导图';
    
    return {
      title: title,
      summary: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
      nodes: [
        {
          id: "1",
          label: "主要内容",
          level: 0,
          children: [
            {
              id: "1-1",
              label: "核心概念",
              level: 1,
              children: [
                {
                  id: "1-1-1",
                  label: "关键信息",
                  level: 2,
                  children: []
                }
              ]
            },
            {
              id: "1-2",
              label: "重要细节",
              level: 1,
              children: []
            }
          ]
        },
        {
          id: "2",
          label: "详细分析",
          level: 0,
          children: [
            {
              id: "2-1",
              label: "要点总结",
              level: 1,
              children: []
            }
          ]
        }
      ],
      keywords: keywords,
      themes: ["文档分析", "内容总结"]
    };
  }

  // 生成文本摘要
  async generateSummary(text, modelName = 'llama3.2:1b', maxLength = 500) {
    try {
      const prompt = `请为以下文本生成一个简洁的摘要，控制在${maxLength}字以内：

${text}

摘要要求：
1. 突出主要内容
2. 保持逻辑清晰
3. 语言简洁明了

摘要：`;

      // 首先尝试使用HTTP API
      try {
        const requestData = {
          model: modelName,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.5,
            max_tokens: 800
          }
        };

        const response = await this.client.post('/api/generate', requestData);
        
        if (response.data && response.data.response) {
          return response.data.response.trim();
        }
      } catch (httpError) {
        console.log('HTTP API摘要生成失败，尝试使用命令行...');
      }
      
      // 如果HTTP API失败，使用命令行
      try {
        // 将提示词写入临时文件
        const tempFile = path.join(__dirname, '..', 'temp_summary.txt');
        fs.writeFileSync(tempFile, prompt);
        
        // 使用ollama命令生成摘要
        const { stdout } = await execAsync(`ollama run ${modelName} < "${tempFile}"`);
        
        // 清理临时文件
        fs.unlinkSync(tempFile);
        
        return stdout.trim();
      } catch (cmdError) {
        console.error('命令行摘要生成失败:', cmdError.message);
        // 如果摘要生成失败，返回文本的前200个字符作为摘要
        return text.substring(0, 200) + (text.length > 200 ? '...' : '');
      }
    } catch (error) {
      console.error('生成摘要失败:', error.message);
      // 如果摘要生成失败，返回文本的前200个字符作为摘要
      return text.substring(0, 200) + (text.length > 200 ? '...' : '');
    }
  }

  // 流式生成（用于实时显示进度）
  async generateStream(text, modelName = 'llama3.2:1b', onProgress = null) {
    try {
      const prompt = this.buildMindmapPrompt(text);
      
      // 首先尝试使用HTTP API
      try {
        const requestData = {
          model: modelName,
          prompt: prompt,
          stream: true,
          options: {
            temperature: 0.7,
            top_p: 0.9,
            max_tokens: 2000
          }
        };

        const response = await this.client.post('/api/generate', requestData, {
          responseType: 'stream'
        });

        let fullResponse = '';
        
        return new Promise((resolve, reject) => {
          response.data.on('data', (chunk) => {
            try {
              const lines = chunk.toString().split('\n');
              for (const line of lines) {
                if (line.trim()) {
                  const data = JSON.parse(line);
                  if (data.response) {
                    fullResponse += data.response;
                    if (onProgress) {
                      onProgress({
                        progress: Math.min(100, (fullResponse.length / 2000) * 100),
                        partial: fullResponse
                      });
                    }
                  }
                  if (data.done) {
                    resolve(this.parseMindmapResponse(fullResponse, text));
                  }
                }
              }
            } catch (error) {
              console.error('解析流数据失败:', error.message);
            }
          });

          response.data.on('error', (error) => {
            reject(new Error(`流式生成失败: ${error.message}`));
          });

          response.data.on('end', () => {
            if (fullResponse) {
              resolve(this.parseMindmapResponse(fullResponse, text));
            } else {
              reject(new Error('未收到有效响应'));
            }
          });
        });
      } catch (httpError) {
        console.log('HTTP API流式生成失败，尝试使用命令行...');
      }
      
      // 如果HTTP API失败，使用命令行（非流式）
      try {
        // 将提示词写入临时文件
        const tempFile = path.join(__dirname, '..', 'temp_prompt.txt');
        fs.writeFileSync(tempFile, prompt);
        
        // 模拟进度更新
        if (onProgress) {
          onProgress({ progress: 20, partial: '正在调用模型...' });
        }
        
        // 使用ollama命令生成
        const { stdout } = await execAsync(`ollama run ${modelName} < "${tempFile}"`);
        
        // 模拟进度更新
        if (onProgress) {
          onProgress({ progress: 80, partial: '正在解析响应...' });
        }
        
        // 清理临时文件
        fs.unlinkSync(tempFile);
        
        if (onProgress) {
          onProgress({ progress: 100, partial: '生成完成' });
        }
        
        return this.parseMindmapResponse(stdout, text);
      } catch (cmdError) {
        console.error('命令行生成失败:', cmdError.message);
        throw new Error(`生成思维导图失败: ${cmdError.message}`);
      }
    } catch (error) {
      console.error('流式生成失败:', error.message);
      throw new Error(`流式生成失败: ${error.message}`);
    }
  }

  // 检查Ollama服务状态
  async checkHealth() {
    try {
      const models = await this.getModels();
      return Array.isArray(models);
    } catch (error) {
      console.error('Ollama健康检查失败:', error.message);
      return false;
    }
  }

  // 批量生成多个思维导图节点
  async generateDetailedNodes(text, modelName = 'llama3.2:1b', options = {}) {
    try {
      const prompt = `基于以下内容，生成一个详细的思维导图结构，包含多层级节点：

${text.substring(0, 1500)}

要求：
1. 生成JSON格式
2. 包含3-4层节点结构
3. 每个父节点至少包含2-3个子节点
4. label必须具体且有意义
5. 总节点数量15-25个

JSON结构：
{
  "title": "具体标题",
  "summary": "详细摘要",
  "nodes": [
    {
      "id": "1",
      "label": "主要概念",
      "level": 0,
      "children": [
        {
          "id": "1-1",
          "label": "具体子概念",
          "level": 1,
          "children": [
            {
              "id": "1-1-1",
              "label": "详细要点",
              "level": 2,
              "children": []
            }
          ]
        }
      ]
    }
  ]
}`;

      // 尝试HTTP API
      try {
        const response = await this.client.post('/api/generate', {
          model: modelName,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.6,
            max_tokens: 3000
          }
        });
        
        if (response.data && response.data.response) {
          return this.parseMindmapResponse(response.data.response, text);
        }
      } catch (httpError) {
        console.log('HTTP API详细节点生成失败，使用命令行...');
      }
      
      // 回退到命令行
      const result = await this.generateViaCommand(modelName, prompt);
      return this.parseMindmapResponse(result, text);
      
    } catch (error) {
      console.error('生成详细节点失败:', error.message);
      return this.createEnhancedFallbackMindmap(text);
    }
  }

  // 创建增强版备用思维导图
  createEnhancedFallbackMindmap(text) {
    const words = text.split(/\s+/).filter(word => word.length > 2);
    const keywords = [...new Set(words)].slice(0, 10);
    
    // 按长度和重要性分组关键词
    const importantWords = keywords.filter(word => word.length > 4);
    const concepts = importantWords.slice(0, 6);
    
    const title = concepts.length > 0 ? concepts.slice(0, 2).join(' ') + ' 详细分析' : '内容分析图';
    
    return {
      title: title,
      summary: `这是基于文档内容生成的详细思维导图，涵盖了${concepts.length}个主要概念和相关要点`,
      nodes: [
        {
          id: "1",
          label: "核心内容",
          level: 0,
          children: [
            {
              id: "1-1",
              label: concepts[0] || "主要概念",
              level: 1,
              children: [
                {
                  id: "1-1-1",
                  label: "定义和特征",
                  level: 2,
                  children: []
                },
                {
                  id: "1-1-2",
                  label: "关键要素",
                  level: 2,
                  children: []
                }
              ]
            },
            {
              id: "1-2",
              label: concepts[1] || "重要主题",
              level: 1,
              children: [
                {
                  id: "1-2-1",
                  label: "基本原理",
                  level: 2,
                  children: []
                }
              ]
            }
          ]
        },
        {
          id: "2",
          label: "详细展开",
          level: 0,
          children: [
            {
              id: "2-1",
              label: concepts[2] || "关键方面",
              level: 1,
              children: [
                {
                  id: "2-1-1",
                  label: "具体表现",
                  level: 2,
                  children: []
                },
                {
                  id: "2-1-2",
                  label: "实际应用",
                  level: 2,
                  children: []
                }
              ]
            },
            {
              id: "2-2",
              label: concepts[3] || "相关要点",
              level: 1,
              children: []
            }
          ]
        },
        {
          id: "3",
          label: "总结分析",
          level: 0,
          children: [
            {
              id: "3-1",
              label: "主要发现",
              level: 1,
              children: []
            },
            {
              id: "3-2",
              label: "重要结论",
              level: 1,
              children: []
            }
          ]
        }
      ],
      keywords: keywords.slice(0, 8),
      themes: concepts.slice(0, 4),
      metadata: {
        generated_at: new Date().toISOString(),
        word_count: words.length,
        concept_count: concepts.length
      }
    };
  }

  // 优化节点结构
  optimizeNodeStructure(nodes) {
    return nodes.map(node => {
      // 确保节点有合适的子节点数量
      if (node.level === 0 && (!node.children || node.children.length === 0)) {
        // 为根节点添加默认子节点
        node.children = [
          {
            id: `${node.id}-1`,
            label: `${node.label} - 详细说明`,
            level: node.level + 1,
            children: []
          },
          {
            id: `${node.id}-2`,
            label: `${node.label} - 相关要点`,
            level: node.level + 1,
            children: []
          }
        ];
      }
      
      // 递归优化子节点
      if (node.children && node.children.length > 0) {
        node.children = this.optimizeNodeStructure(node.children);
      }
      
      return node;
    });
  }

  // 验证和修复思维导图完整性
  validateAndRepairMindmap(mindmapData) {
    // 确保基本字段存在
    if (!mindmapData.title) {
      mindmapData.title = '文档思维导图';
    }
    
    if (!mindmapData.summary) {
      mindmapData.summary = '这是一个基于文档内容生成的思维导图';
    }
    
    if (!mindmapData.nodes || !Array.isArray(mindmapData.nodes)) {
      mindmapData.nodes = [];
    }
    
    // 确保至少有一个根节点
    const rootNodes = mindmapData.nodes.filter(node => node.level === 0);
    if (rootNodes.length === 0 && mindmapData.nodes.length > 0) {
      mindmapData.nodes[0].level = 0;
    }
    
    // 修复节点ID
    mindmapData.nodes = this.repairNodeIds(mindmapData.nodes);
    
    // 添加元数据
    mindmapData.metadata = {
      ...mindmapData.metadata,
      validated_at: new Date().toISOString(),
      node_count: this.countTotalNodes(mindmapData.nodes),
      max_depth: this.calculateMaxDepth(mindmapData.nodes)
    };
    
    return mindmapData;
  }

  // 修复节点ID
  repairNodeIds(nodes, parentId = '') {
    return nodes.map((node, index) => {
      const newId = parentId ? `${parentId}-${index + 1}` : `${index + 1}`;
      
      const repairedNode = {
        ...node,
        id: newId,
        children: node.children && node.children.length > 0 
          ? this.repairNodeIds(node.children, newId)
          : []
      };
      
      return repairedNode;
    });
  }

  // 计算节点总数
  countTotalNodes(nodes) {
    let count = nodes.length;
    nodes.forEach(node => {
      if (node.children && node.children.length > 0) {
        count += this.countTotalNodes(node.children);
      }
    });
    return count;
  }

  // 计算最大深度
  calculateMaxDepth(nodes) {
    if (!nodes || nodes.length === 0) return 0;
    
    let maxDepth = 1;
    nodes.forEach(node => {
      if (node.children && node.children.length > 0) {
        const childDepth = 1 + this.calculateMaxDepth(node.children);
        maxDepth = Math.max(maxDepth, childDepth);
      }
    });
    
    return maxDepth;
  }

  // 导出思维导图为不同格式
  exportMindmap(mindmapData, format = 'json') {
    switch (format.toLowerCase()) {
      case 'json':
        return JSON.stringify(mindmapData, null, 2);
        
      case 'outline':
        return this.convertToOutline(mindmapData.nodes);
        
      case 'markdown':
        return this.convertToMarkdown(mindmapData);
        
      default:
        return JSON.stringify(mindmapData, null, 2);
    }
  }

  // 转换为大纲格式
  convertToOutline(nodes, depth = 0) {
    let outline = '';
    const indent = '  '.repeat(depth);
    
    nodes.forEach(node => {
      outline += `${indent}- ${node.label}\n`;
      if (node.children && node.children.length > 0) {
        outline += this.convertToOutline(node.children, depth + 1);
      }
    });
    
    return outline;
  }

  // 转换为Markdown格式
  convertToMarkdown(mindmapData) {
    let markdown = `# ${mindmapData.title}\n\n`;
    
    if (mindmapData.summary) {
      markdown += `## 概述\n${mindmapData.summary}\n\n`;
    }
    
    markdown += '## 思维导图结构\n\n';
    markdown += this.convertNodesToMarkdown(mindmapData.nodes, 1);
    
    if (mindmapData.keywords && mindmapData.keywords.length > 0) {
      markdown += `\n## 关键词\n${mindmapData.keywords.join(', ')}\n`;
    }
    
    return markdown;
  }

  // 将节点转换为Markdown
  convertNodesToMarkdown(nodes, level = 1) {
    let markdown = '';
    const headerPrefix = '#'.repeat(level + 1);
    
    nodes.forEach(node => {
      markdown += `${headerPrefix} ${node.label}\n\n`;
      if (node.children && node.children.length > 0) {
        markdown += this.convertNodesToMarkdown(node.children, level + 1);
      }
    });
    
    return markdown;
  }
}

module.exports = OllamaClient;
