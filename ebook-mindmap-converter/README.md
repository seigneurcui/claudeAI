# 电子书思维导图转换工具

一个基于Node.js的电子书思维导图转换工具，使用本地Ollama模型将电子书转换为结构化思维导图。

## 功能特性

### 📚 支持的文件格式
- **EPUB** - 电子出版物格式
- **PDF** - 便携式文档格式
- **TXT** - 纯文本格式
- **RTF** - 富文本格式
- **DOCX** - Microsoft Word文档
- **MOBI** - Mobipocket电子书格式
- **AZW/AZW3** - Amazon Kindle格式
- **CBR/CBZ** - 漫画书格式

### 🤖 AI模型集成
- 支持本地Ollama模型
- 自动模型检测和选择
- 实时模型状态监控
- 支持多种大语言模型（Llama2、Mistral等）

### 🧠 思维导图生成
- 智能文本分析和结构化
- 层次化思维导图生成
- 关键词提取和主题识别
- 多种导出格式（HTML、PNG、PDF）

### 📊 数据管理
- PostgreSQL数据库存储
- 转换历史记录
- 搜索和筛选功能
- Excel报告导出

### 🎨 用户界面
- 现代化响应式设计
- 实时进度显示
- WebSocket实时通信
- 拖拽文件上传

## 系统要求

### 基础环境
- Node.js 16.0 或更高版本
- PostgreSQL 12.0 或更高版本
- Ollama 0.1.0 或更高版本

### 推荐配置
- 内存: 8GB 或更多
- 存储: 50GB 可用空间
- CPU: 4核心或更多

## 安装步骤

### 1. 克隆项目
```bash
git clone <repository-url>
cd ebook-mindmap-converter
```

### 2. 安装依赖
```bash
npm install
```

### 3. 配置环境变量
复制环境变量模板文件：
```bash
cp env.example .env
```

编辑 `.env` 文件，配置以下参数：
```env
# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ebook_mindmap
DB_USER=postgres
DB_PASSWORD=your_password

# Ollama配置
OLLAMA_BASE_URL=http://localhost:11434
DEFAULT_MODEL=llama2

# 服务器配置
PORT=3000
UPLOAD_DIR=./uploads
OUTPUT_DIR=./outputs

# 文件大小限制 (MB)
MAX_FILE_SIZE=50
```

### 4. 设置数据库
创建PostgreSQL数据库：
```sql
CREATE DATABASE ebook_mindmap;
```

运行数据库初始化脚本：
```bash
psql -U postgres -d ebook_mindmap -f database/init.sql
```

### 5. 安装和配置Ollama

#### 安装Ollama
```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Windows
# 下载并安装 Ollama for Windows
```

#### 启动Ollama服务
```bash
ollama serve
```

#### 下载推荐模型
```bash
# 下载Llama2模型（推荐）
ollama pull llama2

# 或下载其他模型
ollama pull mistral
ollama pull codellama
```

### 6. 启动应用
```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

访问 http://localhost:3000 使用应用。

## 使用指南

### 1. 文件上传
1. 在"文件上传"页面选择或拖拽电子书文件
2. 选择要使用的Ollama模型
3. 点击"开始上传"按钮

### 2. 转换管理
1. 切换到"转换管理"页面
2. 查看所有上传的文件和转换状态
3. 点击"开始转换"开始处理单个文件
4. 或使用"开始全部转换"批量处理

### 3. 思维导图库
1. 在"思维导图库"页面查看已完成的思维导图
2. 使用搜索和筛选功能查找特定内容
3. 下载思维导图（HTML、PNG、PDF格式）

### 4. 设置
1. 在"设置"页面配置Ollama连接
2. 查看系统统计信息
3. 测试服务连接状态

## API接口

### 文件上传
- `POST /api/upload/single` - 上传单个文件
- `POST /api/upload/multiple` - 上传多个文件
- `GET /api/upload/formats` - 获取支持的文件格式

### 转换管理
- `POST /api/conversion/start/:id` - 开始转换
- `POST /api/conversion/cancel/:id` - 取消转换
- `GET /api/conversion/status/:id` - 获取转换状态

### 思维导图
- `GET /api/mindmap` - 获取思维导图列表
- `GET /api/mindmap/:id` - 获取思维导图详情
- `GET /api/mindmap/search` - 搜索思维导图

### 导出功能
- `GET /api/export/excel` - 导出Excel报告
- `GET /api/export/mindmap/:id/:format` - 导出思维导图

### Ollama集成
- `GET /api/ollama/models` - 获取可用模型
- `GET /api/ollama/health` - 检查服务状态
- `POST /api/ollama/test` - 测试模型响应

## 项目结构

```
ebook-mindmap-converter/
├── config/                 # 配置文件
│   └── database.js        # 数据库配置
├── database/              # 数据库相关
│   └── init.sql          # 数据库初始化脚本
├── models/                # 数据模型
│   └── Conversion.js     # 转换记录模型
├── public/                # 前端静态文件
│   ├── index.html        # 主页面
│   ├── styles.css        # 样式文件
│   └── app.js           # 前端JavaScript
├── routes/                # API路由
│   ├── upload.js         # 文件上传路由
│   ├── conversion.js     # 转换管理路由
│   ├── mindmap.js        # 思维导图路由
│   ├── export.js         # 导出功能路由
│   └── ollama.js         # Ollama集成路由
├── utils/                 # 工具类
│   ├── fileParser.js     # 文件解析器
│   ├── ollamaClient.js   # Ollama客户端
│   └── mindmapGenerator.js # 思维导图生成器
├── uploads/               # 上传文件目录
├── outputs/               # 输出文件目录
├── server.js             # 主服务器文件
├── package.json          # 项目配置
└── README.md            # 项目说明
```

## 故障排除

### 常见问题

#### 1. Ollama连接失败
- 确保Ollama服务正在运行：`ollama serve`
- 检查Ollama服务地址配置
- 验证防火墙设置

#### 2. 数据库连接失败
- 确保PostgreSQL服务正在运行
- 检查数据库连接参数
- 验证数据库用户权限

#### 3. 文件上传失败
- 检查文件格式是否支持
- 验证文件大小限制
- 确保上传目录权限正确

#### 4. 模型响应慢
- 检查系统资源使用情况
- 考虑使用更小的模型
- 调整模型参数设置

### 日志查看
应用日志会输出到控制台，包括：
- 文件上传和解析状态
- 模型调用和响应
- 数据库操作结果
- 错误信息和堆栈跟踪

## 性能优化

### 系统优化
1. **内存管理**: 定期清理临时文件
2. **并发控制**: 限制同时处理的文件数量
3. **缓存策略**: 缓存模型响应结果
4. **资源监控**: 监控CPU和内存使用

### 模型优化
1. **模型选择**: 根据任务复杂度选择合适的模型
2. **参数调整**: 优化temperature和max_tokens参数
3. **批处理**: 批量处理相似文件
4. **预处理**: 优化输入文本长度

## 安全考虑

### 文件安全
- 文件类型验证
- 文件大小限制
- 恶意文件检测
- 定期清理临时文件

### 数据安全
- 数据库连接加密
- 敏感信息环境变量存储
- 访问权限控制
- 定期数据备份

## 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 许可证

MIT License

## 更新日志

### v1.0.0
- 初始版本发布
- 支持多种电子书格式
- 集成Ollama模型
- 思维导图生成功能
- Web界面和API接口

## 技术支持

如有问题或建议，请通过以下方式联系：
- 创建 Issue
- 发送邮件
- 提交 Pull Request

---

**注意**: 使用本工具前请确保已正确安装和配置所有依赖项，特别是Ollama和PostgreSQL服务。
