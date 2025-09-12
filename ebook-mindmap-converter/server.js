const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// 路由
const uploadRoutes = require('./routes/upload');
const conversionRoutes = require('./routes/conversion');
const mindmapRoutes = require('./routes/mindmap');
const exportRoutes = require('./routes/export');
const ollamaRoutes = require('./routes/ollama');

app.use('/api/upload', uploadRoutes);
app.use('/api/conversion', conversionRoutes);
app.use('/api/mindmap', mindmapRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/ollama', ollamaRoutes);

// WebSocket连接处理
io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
  });
});

// 将io实例传递给路由
app.set('io', io);

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: '服务器内部错误',
    message: err.message 
  });
});

// 404处理
app.use('*', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

const PORT = process.env.PORT || 9022;
//const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`访问地址: http://localhost:${PORT}`);
  console.log('注意: 如果Ollama服务未运行，将使用默认模型列表');
});
