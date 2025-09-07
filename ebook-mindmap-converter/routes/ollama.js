const express = require('express');
const OllamaClient = require('../utils/ollamaClient');

const router = express.Router();

// 获取可用的模型列表
router.get('/models', async (req, res) => {
  try {
    const ollamaClient = new OllamaClient(process.env.OLLAMA_BASE_URL);
    const models = await ollamaClient.getModels();
    
    res.json({
      success: true,
      data: models
    });
  } catch (error) {
    console.error('获取模型列表失败:', error);
    
    // 如果无法连接到Ollama，返回实际安装的模型列表
    const defaultModels = [
      {
        name: 'llama3.2:1b',
        model: 'llama3.2:1b',
        size: 1321098329,
        modified_at: new Date().toISOString()
      },
      {
        name: 'deepseek-r1:8b',
        model: 'deepseek-r1:8b',
        size: 5225376047,
        modified_at: new Date().toISOString()
      },
      {
        name: 'qwen3:8b-q4_K_M',
        model: 'qwen3:8b-q4_K_M',
        size: 5225388164,
        modified_at: new Date().toISOString()
      },
      {
        name: 'gpt-oss:20b',
        model: 'gpt-oss:20b',
        size: 13780173839,
        modified_at: new Date().toISOString()
      }
    ];
    
    res.json({
      success: true,
      data: defaultModels,
      warning: '无法连接到Ollama服务，显示默认模型列表'
    });
  }
});

// 检查模型是否存在
router.get('/models/:modelName/check', async (req, res) => {
  try {
    const { modelName } = req.params;
    const ollamaClient = new OllamaClient(process.env.OLLAMA_BASE_URL);
    const exists = await ollamaClient.checkModel(modelName);
    
    res.json({
      success: true,
      data: {
        modelName: modelName,
        exists: exists
      }
    });
  } catch (error) {
    console.error('检查模型失败:', error);
    res.status(500).json({ 
      error: '检查模型失败',
      message: error.message 
    });
  }
});

// 拉取模型
router.post('/models/:modelName/pull', async (req, res) => {
  try {
    const { modelName } = req.params;
    const ollamaClient = new OllamaClient(process.env.OLLAMA_BASE_URL);
    
    // 检查模型是否已存在
    const exists = await ollamaClient.checkModel(modelName);
    if (exists) {
      return res.json({
        success: true,
        message: '模型已存在',
        data: { modelName, exists: true }
      });
    }

    // 拉取模型
    const result = await ollamaClient.pullModel(modelName);
    
    res.json({
      success: true,
      message: '模型拉取成功',
      data: result
    });
  } catch (error) {
    console.error('拉取模型失败:', error);
    res.status(500).json({ 
      error: '拉取模型失败',
      message: error.message 
    });
  }
});

// 检查Ollama服务状态
router.get('/health', async (req, res) => {
  try {
    const ollamaClient = new OllamaClient(process.env.OLLAMA_BASE_URL);
    const isHealthy = await ollamaClient.checkHealth();
    
    res.json({
      success: true,
      data: {
        healthy: isHealthy,
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
      }
    });
  } catch (error) {
    console.error('检查Ollama服务状态失败:', error);
    
    // 即使检查失败，也返回一个状态，让前端知道可以继续工作
    res.json({
      success: true,
      data: {
        healthy: false,
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        error: error.message
      }
    });
  }
});

// 测试模型响应
router.post('/test', async (req, res) => {
  try {
    const { modelName, prompt } = req.body;
    
    if (!modelName || !prompt) {
      return res.status(400).json({ 
        error: '请提供模型名称和测试提示词' 
      });
    }

    const ollamaClient = new OllamaClient(process.env.OLLAMA_BASE_URL);
    
    // 检查模型是否存在
    const exists = await ollamaClient.checkModel(modelName);
    if (!exists) {
      return res.status(400).json({ 
        error: `模型 ${modelName} 不存在` 
      });
    }

    // 测试模型响应
    const requestData = {
      model: modelName,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.7,
        max_tokens: 500
      }
    };

    const response = await ollamaClient.client.post('/api/generate', requestData);
    
    res.json({
      success: true,
      data: {
        modelName: modelName,
        prompt: prompt,
        response: response.data.response,
        done: response.data.done
      }
    });
  } catch (error) {
    console.error('测试模型失败:', error);
    res.status(500).json({ 
      error: '测试模型失败',
      message: error.message 
    });
  }
});

// 获取推荐的模型列表
router.get('/recommended', (req, res) => {
  const recommendedModels = [
    {
      name: 'llama3.2:1b',
      displayName: 'llama3.2:1b',
      description: 'Meta开发的通用大语言模型，适合文本理解和生成',
      size: '1B',
      recommended: true
    },
    {
      name: 'llama2',
      displayName: 'Llama 2',
      description: 'Meta开发的通用大语言模型，适合文本理解和生成',
      size: '7B',
      recommended: true
    },
    {
      name: 'llama2:13b',
      displayName: 'Llama 2 13B',
      description: 'Llama 2的13B版本，性能更强但需要更多资源',
      size: '13B',
      recommended: false
    },
    {
      name: 'codellama',
      displayName: 'Code Llama',
      description: '专门用于代码理解和生成的模型',
      size: '7B',
      recommended: false
    },
    {
      name: 'mistral',
      displayName: 'Mistral',
      description: '高效的开源语言模型，性能优秀',
      size: '7B',
      recommended: true
    },
    {
      name: 'neural-chat',
      displayName: 'Neural Chat',
      description: '专门优化的对话模型',
      size: '7B',
      recommended: false
    }
  ];

  res.json({
    success: true,
    data: recommendedModels
  });
});

// 检查数据库连接状态
router.get('/db-health', async (req, res) => {
  try {
    const pool = require('../config/database');
    const client = await pool.connect();
    
    // 执行简单查询测试连接
    const result = await client.query('SELECT 1 as test');
    client.release();
    
    res.json({
      success: true,
      data: {
        healthy: true,
        message: '数据库连接正常'
      }
    });
  } catch (error) {
    console.error('数据库健康检查失败:', error);
    res.json({
      success: true,
      data: {
        healthy: false,
        message: `数据库连接失败: ${error.message}`
      }
    });
  }
});

module.exports = router;
