#!/bin/bash

# 电子书思维导图转换工具启动脚本

echo "🚀 启动电子书思维导图转换工具..."

# 检查Node.js是否安装
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装，请先安装 Node.js 16.0 或更高版本"
    exit 1
fi

# 检查PostgreSQL是否安装
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL 未安装，请先安装 PostgreSQL"
    exit 1
fi

# 检查Ollama是否安装
if ! command -v ollama &> /dev/null; then
    echo "❌ Ollama 未安装，请先安装 Ollama"
    echo "安装命令: curl -fsSL https://ollama.ai/install.sh | sh"
    exit 1
fi

# 检查环境变量文件
if [ ! -f .env ]; then
    echo "⚠️  环境变量文件不存在，正在创建..."
    cp env.example .env
    echo "📝 请编辑 .env 文件配置数据库和Ollama连接信息"
fi

# 检查依赖是否安装
if [ ! -d "node_modules" ]; then
    echo "📦 安装项目依赖..."
    npm install
fi

# 创建必要的目录
echo "📁 创建必要的目录..."
mkdir -p uploads
mkdir -p outputs
mkdir -p outputs/images
mkdir -p outputs/pdfs
mkdir -p outputs/html

# 检查Ollama服务是否运行
echo "🔍 检查Ollama服务状态..."
if ! curl -s http://localhost:11434/api/tags > /dev/null; then
    echo "⚠️  Ollama服务未运行，正在启动..."
    ollama serve &
    sleep 5
    
    # 再次检查
    if ! curl -s http://localhost:11434/api/tags > /dev/null; then
        echo "❌ Ollama服务启动失败，请手动启动: ollama serve"
        exit 1
    fi
fi

# 检查是否有默认模型
echo "🤖 检查Ollama模型..."
if ! ollama list | grep -q "llama2"; then
    echo "📥 下载默认模型 llama2..."
    ollama pull llama2
fi

# 检查数据库连接
echo "🗄️  检查数据库连接..."
if ! psql -h localhost -U postgres -d ebook_mindmap -c "SELECT 1;" > /dev/null 2>&1; then
    echo "⚠️  数据库连接失败，请检查PostgreSQL配置"
    echo "请确保："
    echo "1. PostgreSQL服务正在运行"
    echo "2. 数据库 'ebook_mindmap' 已创建"
    echo "3. 用户权限配置正确"
    echo ""
    echo "创建数据库命令:"
    echo "psql -U postgres -c \"CREATE DATABASE ebook_mindmap;\""
    echo "psql -U postgres -d ebook_mindmap -f database/init.sql"
fi

# 启动应用
echo "🎯 启动应用服务器..."
echo "访问地址: http://localhost:3000"
echo "按 Ctrl+C 停止服务"
echo ""

npm start
