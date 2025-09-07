const axios = require('axios');

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
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      
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
          return this.parseMindmapResponse(response.data.response);
        }
      } catch (httpError) {
        console.log('HTTP API生成失败，尝试使用命令行...');
      }
      
      // 如果HTTP API失败，使用命令行
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      
      try {
        // 将提示词写入临时文件
        const fs = require('fs');
        const path = require('path');
        const tempFile = path.join(__dirname, '..', 'temp_prompt.txt');
        fs.writeFileSync(tempFile, prompt);
        
        // 使用ollama命令生成
        const { stdout } = await execAsync(`ollama run ${modelName} < "${tempFile}"`);
        
        // 清理临时文件
        fs.unlinkSync(tempFile);
        
        return this.parseMindmapResponse(stdout);
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

    return `请分析以下文本并生成思维导图。请严格按照以下JSON格式输出，只输出一个JSON对象，不要添加任何其他文字：

{
  "title": "文档标题",
  "summary": "简要摘要",
  "nodes": [
    {
      "id": "1",
      "label": "主要主题",
      "level": 1,
      "children": [
        {
          "id": "1-1",
          "label": "子主题",
          "level": 2,
          "children": []
        }
      ]
    }
  ],
  "keywords": ["关键词1", "关键词2"],
  "themes": ["主题1", "主题2"]
}

文本内容：
${truncatedText}

重要：只输出一个JSON对象，不要输出示例或模板。`;
  }

  // 解析思维导图响应
  parseMindmapResponse(response) {
    try {
      console.log('原始响应长度:', response.length);
      console.log('原始响应前500字符:', response.substring(0, 500));
      
      // 查找所有JSON对象
      const jsonMatches = response.match(/\{[\s\S]*?\}/g);
      if (!jsonMatches || jsonMatches.length === 0) {
        console.log('未找到JSON对象');
        return this.createFallbackMindmap(response);
      }
      
      console.log(`找到 ${jsonMatches.length} 个JSON对象`);
      
      // 尝试解析每个JSON对象，找到最合适的
      for (let i = 0; i < jsonMatches.length; i++) {
        const jsonStr = jsonMatches[i];
        try {
          const mindmapData = JSON.parse(jsonStr);
          console.log(`尝试解析第 ${i + 1} 个JSON对象...`);
          
          // 验证数据结构
          if (this.validateMindmapData(mindmapData)) {
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
          continue;
        }
      }
      
      // 如果所有JSON都解析失败，尝试最后一个（通常是最完整的）
      if (jsonMatches.length > 0) {
        const lastJson = jsonMatches[jsonMatches.length - 1];
        try {
          const mindmapData = JSON.parse(lastJson);
          console.log('使用最后一个JSON对象作为备用');
          return mindmapData;
        } catch (e) {
          console.log('最后一个JSON对象也解析失败');
        }
      }
      
      return this.createFallbackMindmap(response);
    } catch (error) {
      console.error('解析思维导图响应失败:', error.message);
      return this.createFallbackMindmap(response);
    }
  }

  // 验证思维导图数据
  validateMindmapData(data) {
    return data && 
           typeof data === 'object' &&
           data.title &&
           data.nodes &&
           Array.isArray(data.nodes);
  }

  // 检查是否有实际内容（不是模板）
  hasActualContent(data) {
    // 检查标题是否不是默认模板
    const templateTitles = ['文档标题', '思维导图', '文档思维导图'];
    if (templateTitles.includes(data.title)) {
      return false;
    }
    
    // 检查节点是否有实际标签
    if (data.nodes && data.nodes.length > 0) {
      for (const node of data.nodes) {
        const templateLabels = ['主要主题', '子主题', '文档概述', '主要内容'];
        if (!templateLabels.includes(node.label)) {
          return true; // 找到非模板标签
        }
      }
    }
    
    // 检查摘要是否有内容
    if (data.summary && data.summary.trim().length > 10) {
      return true;
    }
    
    // 检查关键词是否有内容
    if (data.keywords && data.keywords.length > 0) {
      return true;
    }
    
    return false;
  }

  // 创建备用思维导图结构
  createFallbackMindmap(response) {
    // 尝试从响应中提取一些有用信息
    const text = response.substring(0, 1000);
    const words = text.split(/\s+/).filter(word => word.length > 3);
    const keywords = [...new Set(words)].slice(0, 5);
    
    return {
      title: "文档思维导图",
      summary: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
      nodes: [
        {
          id: "1",
          label: "文档概述",
          level: 1,
          children: [
            {
              id: "1-1",
              label: "主要内容",
              level: 2,
              children: [
                {
                  id: "1-1-1",
                  label: "关键信息",
                  level: 3,
                  children: []
                }
              ]
            },
            {
              id: "1-2",
              label: "重要概念",
              level: 2,
              children: []
            }
          ]
        },
        {
          id: "2",
          label: "详细分析",
          level: 1,
          children: [
            {
              id: "2-1",
              label: "要点总结",
              level: 2,
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
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      
      try {
        // 将提示词写入临时文件
        const fs = require('fs');
        const path = require('path');
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
                    resolve(this.parseMindmapResponse(fullResponse));
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
              resolve(this.parseMindmapResponse(fullResponse));
            } else {
              reject(new Error('未收到有效响应'));
            }
          });
        });
      } catch (httpError) {
        console.log('HTTP API流式生成失败，尝试使用命令行...');
      }
      
      // 如果HTTP API失败，使用命令行（非流式）
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      
      try {
        // 将提示词写入临时文件
        const fs = require('fs');
        const path = require('path');
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
        
        return this.parseMindmapResponse(stdout);
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
}

module.exports = OllamaClient;
