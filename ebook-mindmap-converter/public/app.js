// 全局变量
let socket;
let selectedFiles = [];
let conversions = [];
let availableModels = [];
let currentTab = 'upload';

// 初始化应用
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

// 初始化应用
async function initializeApp() {
    // 初始化WebSocket连接
    initializeSocket();
    
    // 初始化事件监听器
    initializeEventListeners();
    
    // 加载模型列表
    await loadModels();
    
    // 加载转换列表
    await loadConversions();
    
    // 加载思维导图库
    await loadMindmaps();
    
    // 加载系统统计
    await loadSystemStats();
    
    // 自动检查数据库状态
    await testDatabaseConnection();
    
    showNotification('应用初始化完成', 'success');
}

// 初始化WebSocket连接
function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('WebSocket连接已建立');
        showNotification('服务器连接成功', 'success');
    });
    
    socket.on('disconnect', () => {
        console.log('WebSocket连接已断开');
        showNotification('服务器连接断开', 'warning');
    });
    
    // 监听转换进度事件
    socket.on('conversion_started', (data) => {
        updateConversionStatus(data.conversionId, 'processing', 0, data.message);
        showNotification(`开始转换: ${data.message}`, 'info');
    });
    
    socket.on('conversion_progress', (data) => {
        updateConversionStatus(data.conversionId, 'processing', data.progress, data.message);
    });
    
    socket.on('conversion_completed', (data) => {
        updateConversionStatus(data.conversionId, 'completed', 100, '转换完成');
        showNotification(`转换完成: ${data.processingTime}秒`, 'success');
        loadConversions();
        loadMindmaps();
    });
    
    socket.on('conversion_failed', (data) => {
        updateConversionStatus(data.conversionId, 'failed', 0, data.error);
        showNotification(`转换失败: ${data.error}`, 'error');
    });
    
    socket.on('conversion_cancelled', (data) => {
        updateConversionStatus(data.conversionId, 'cancelled', 0, '用户取消');
        showNotification('转换已取消', 'warning');
    });
}

// 初始化事件监听器
function initializeEventListeners() {
    // 标签页切换
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    
    // 文件上传
    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    
    fileInput.addEventListener('change', handleFileSelect);
    
    // 拖拽上传
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    uploadArea.addEventListener('click', () => fileInput.click());
    
    // 按钮事件
    document.getElementById('startUpload').addEventListener('click', startUpload);
    document.getElementById('clearFiles').addEventListener('click', clearFiles);
    document.getElementById('refreshModels').addEventListener('click', loadModels);
    document.getElementById('startAllConversions').addEventListener('click', startAllConversions);
    document.getElementById('cancelAllConversions').addEventListener('click', cancelAllConversions);
    document.getElementById('exportExcel').addEventListener('click', exportExcel);
    document.getElementById('searchBtn').addEventListener('click', searchMindmaps);
    document.getElementById('clearFilters').addEventListener('click', clearFilters);
    document.getElementById('testOllama').addEventListener('click', testOllamaConnection);
    document.getElementById('testDb').addEventListener('click', testDatabaseConnection);
}

// 标签页切换
function switchTab(tabName) {
    // 更新标签页状态
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    
    // 更新内容区域
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');
    
    currentTab = tabName;
    
    // 根据标签页加载相应数据
    switch(tabName) {
        case 'conversion':
            loadConversions();
            break;
        case 'mindmap':
            loadMindmaps();
            break;
        case 'settings':
            loadSystemStats();
            break;
    }
}

// 文件拖拽处理
function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
}

// 文件选择处理
function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    addFiles(files);
}

// 添加文件到列表
function addFiles(files) {
    files.forEach(file => {
        if (isValidFile(file)) {
            selectedFiles.push({
                file: file,
                id: generateId(),
                status: 'selected'
            });
        } else {
            showNotification(`不支持的文件格式: ${file.name}`, 'error');
        }
    });
    
    updateFileList();
    updateUploadButton();
}

// 验证文件格式
function isValidFile(file) {
    const validExtensions = ['.epub', '.pdf', '.txt', '.rtf', '.docx', '.mobi', '.azw', '.azw3', '.cbr', '.cbz'];
    const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    return validExtensions.includes(extension);
}

// 更新文件列表显示
function updateFileList() {
    const fileList = document.getElementById('fileList');
    
    if (selectedFiles.length === 0) {
        fileList.innerHTML = '<p style="text-align: center; color: #718096; padding: 40px;">暂无文件</p>';
        return;
    }
    
    fileList.innerHTML = selectedFiles.map(fileItem => `
        <div class="file-item">
            <div class="file-icon">
                <i class="fas fa-file-${getFileIcon(fileItem.file.name)}"></i>
            </div>
            <div class="file-info">
                <div class="file-name">${fileItem.file.name}</div>
                <div class="file-details">
                    大小: ${formatFileSize(fileItem.file.size)} | 
                    类型: ${getFileType(fileItem.file.name)}
                </div>
            </div>
            <div class="file-actions">
                <button class="btn-danger" onclick="removeFile('${fileItem.id}')">
                    <i class="fas fa-trash"></i> 删除
                </button>
            </div>
        </div>
    `).join('');
}

// 获取文件图标
function getFileIcon(filename) {
    const extension = filename.toLowerCase().substring(filename.lastIndexOf('.') + 1);
    const iconMap = {
        'pdf': 'pdf',
        'epub': 'book',
        'txt': 'file-alt',
        'rtf': 'file-word',
        'docx': 'file-word',
        'mobi': 'book',
        'azw': 'book',
        'azw3': 'book',
        'cbr': 'images',
        'cbz': 'images'
    };
    return iconMap[extension] || 'file';
}

// 获取文件类型
function getFileType(filename) {
    return filename.toLowerCase().substring(filename.lastIndexOf('.') + 1).toUpperCase();
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 移除文件
function removeFile(fileId) {
    selectedFiles = selectedFiles.filter(item => item.id !== fileId);
    updateFileList();
    updateUploadButton();
}

// 清空文件列表
function clearFiles() {
    selectedFiles = [];
    updateFileList();
    updateUploadButton();
}

// 更新上传按钮状态
function updateUploadButton() {
    const startUploadBtn = document.getElementById('startUpload');
    const modelSelect = document.getElementById('modelSelect');
    
    startUploadBtn.disabled = selectedFiles.length === 0 || !modelSelect.value;
}

// 开始上传文件
async function startUpload() {
    if (selectedFiles.length === 0) {
        showNotification('请先选择文件', 'warning');
        return;
    }
    
    const modelSelect = document.getElementById('modelSelect');
    if (!modelSelect.value) {
        showNotification('请选择Ollama模型', 'warning');
        return;
    }
    
    try {
        const formData = new FormData();
        selectedFiles.forEach(fileItem => {
            formData.append('files', fileItem.file);
        });
        formData.append('model', modelSelect.value);
        
        const response = await fetch('/api/upload/multiple', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(`成功上传 ${result.conversions.length} 个文件`, 'success');
            selectedFiles = [];
            updateFileList();
            updateUploadButton();
            loadConversions();
        } else {
            showNotification(`上传失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('上传失败:', error);
        showNotification(`上传失败: ${error.message}`, 'error');
    }
}

// 加载模型列表
async function loadModels() {
    try {
        console.log('正在加载模型列表...');
        const response = await fetch('/api/ollama/models', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('模型列表响应状态:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('模型列表结果:', result);
        
        if (result.success && result.data) {
            availableModels = result.data;
            updateModelSelect();
            showNotification(`成功加载 ${availableModels.length} 个模型`, 'success');
        } else {
            console.error('模型列表加载失败:', result.error || result.message);
            showNotification(`加载模型列表失败: ${result.error || result.message}`, 'error');
        }
    } catch (error) {
        console.error('加载模型失败:', error);
        showNotification(`加载模型列表失败: ${error.message}`, 'error');
        
        // 如果加载失败，显示默认模型选项
        showDefaultModels();
    }
}

// 更新模型选择下拉框
function updateModelSelect() {
    const modelSelect = document.getElementById('modelSelect');
    const defaultModelSelect = document.getElementById('defaultModel');
    
    const options = availableModels.map(model => 
        `<option value="${model.name}">${model.name} (${formatFileSize(model.size)})</option>`
    ).join('');
    
    modelSelect.innerHTML = '<option value="">请选择模型</option>' + options;
    defaultModelSelect.innerHTML = options;
    
    updateUploadButton();
}

// 显示默认模型选项（当无法加载模型列表时）
function showDefaultModels() {
    const modelSelect = document.getElementById('modelSelect');
    const defaultModelSelect = document.getElementById('defaultModel');
    
    const defaultOptions = `
        <option value="llama3.2:1b">llama3.2:1b (推荐)</option>
        <option value="llama2">llama2</option>
        <option value="mistral">mistral</option>
        <option value="codellama">codellama</option>
    `;
    
    modelSelect.innerHTML = '<option value="">请选择模型</option>' + defaultOptions;
    defaultModelSelect.innerHTML = defaultOptions;
    
    updateUploadButton();
}

// 加载转换列表
async function loadConversions() {
    try {
        console.log('正在加载转换列表...');
        const response = await fetch('/api/conversion/all');
        const result = await response.json();
        
        if (result.success) {
            conversions = result.data;
            updateConversionList();
            updateProgressStats();
        } else {
            console.error('加载转换列表失败:', result.error);
        }
    } catch (error) {
        console.error('加载转换列表失败:', error);
        showNotification('加载转换列表失败', 'error');
    }
}

// 更新转换列表显示
function updateConversionList() {
    const conversionList = document.getElementById('conversionList');
    
    if (conversions.length === 0) {
        conversionList.innerHTML = '<p style="text-align: center; color: #718096; padding: 40px;">暂无转换记录</p>';
        return;
    }
    
    conversionList.innerHTML = conversions.map(conversion => `
        <div class="conversion-item">
            <div class="conversion-header">
                <div class="conversion-title">${conversion.original_filename}</div>
                <div class="conversion-status status-${conversion.status}">
                    ${getStatusText(conversion.status)}
                </div>
            </div>
            
            ${conversion.status === 'processing' ? `
                <div class="conversion-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${conversion.progress}%"></div>
                    </div>
                </div>
            ` : ''}
            
            <div class="conversion-details">
                <div class="detail-item">
                    <span class="detail-label">文件类型:</span>
                    <span class="detail-value">${conversion.file_type.toUpperCase()}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">文件大小:</span>
                    <span class="detail-value">${formatFileSize(conversion.file_size)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">使用模型:</span>
                    <span class="detail-value">${conversion.model_used}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">处理时间:</span>
                    <span class="detail-value">${conversion.processing_time || 0}秒</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">创建时间:</span>
                    <span class="detail-value">${new Date(conversion.created_at).toLocaleString('zh-CN')}</span>
                </div>
            </div>
            
            ${conversion.summary ? `
                <div class="conversion-summary">
                    <strong>摘要:</strong> ${conversion.summary}
                </div>
            ` : ''}
            
            ${conversion.error_message ? `
                <div class="conversion-error">
                    <strong>错误信息:</strong> ${conversion.error_message}
                </div>
            ` : ''}
            
            <div class="conversion-actions">
                ${conversion.status === 'uploaded' ? `
                    <button class="btn-primary" onclick="startConversion('${conversion.id}')">
                        <i class="fas fa-play"></i> 开始转换
                    </button>
                ` : ''}
                
                ${conversion.status === 'processing' ? `
                    <button class="btn-danger" onclick="cancelConversion('${conversion.id}')">
                        <i class="fas fa-stop"></i> 取消转换
                    </button>
                ` : ''}
                
                ${conversion.status === 'completed' ? `
                    <button class="btn-success" onclick="downloadMindmap('${conversion.id}', 'html')">
                        <i class="fas fa-download"></i> 下载HTML
                    </button>
                    <button class="btn-success" onclick="downloadMindmap('${conversion.id}', 'png')">
                        <i class="fas fa-image"></i> 下载PNG
                    </button>
                    <button class="btn-success" onclick="downloadMindmap('${conversion.id}', 'pdf')">
                        <i class="fas fa-file-pdf"></i> 下载PDF
                    </button>
                ` : ''}
                
                <button class="btn-secondary" onclick="deleteConversion('${conversion.id}')">
                    <i class="fas fa-trash"></i> 删除
                </button>
            </div>
        </div>
    `).join('');
}

// 获取状态文本
function getStatusText(status) {
    const statusMap = {
        'pending': '等待中',
        'uploaded': '已上传',
        'processing': '处理中',
        'completed': '已完成',
        'failed': '失败',
        'cancelled': '已取消'
    };
    return statusMap[status] || status;
}

// 更新进度统计
function updateProgressStats() {
    const totalFiles = conversions.length;
    const completedFiles = conversions.filter(c => c.status === 'completed').length;
    const processingFiles = conversions.filter(c => c.status === 'processing').length;
    const totalTime = conversions.reduce((sum, c) => sum + (c.processing_time || 0), 0);
    
    document.getElementById('totalFiles').textContent = totalFiles;
    document.getElementById('completedFiles').textContent = completedFiles;
    document.getElementById('processingFiles').textContent = processingFiles;
    document.getElementById('totalTime').textContent = `${totalTime}秒`;
}

// 开始转换
async function startConversion(conversionId) {
    try {
        const response = await fetch(`/api/conversion/start/${conversionId}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('转换已开始', 'success');
            loadConversions();
        } else {
            showNotification(`开始转换失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('开始转换失败:', error);
        showNotification(`开始转换失败: ${error.message}`, 'error');
    }
}

// 取消转换
async function cancelConversion(conversionId) {
    try {
        const response = await fetch(`/api/conversion/cancel/${conversionId}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('转换已取消', 'warning');
            loadConversions();
        } else {
            showNotification(`取消转换失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('取消转换失败:', error);
        showNotification(`取消转换失败: ${error.message}`, 'error');
    }
}

// 开始全部转换
async function startAllConversions() {
    const uploadedConversions = conversions.filter(c => c.status === 'uploaded');
    
    if (uploadedConversions.length === 0) {
        showNotification('没有可转换的文件', 'warning');
        return;
    }
    
    try {
        const conversionIds = uploadedConversions.map(c => c.id);
        
        const response = await fetch('/api/conversion/batch-start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ conversionIds })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(`批量转换已开始，共处理 ${result.results.length} 个文件`, 'success');
            loadConversions();
        } else {
            showNotification(`批量转换失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('批量转换失败:', error);
        showNotification(`批量转换失败: ${error.message}`, 'error');
    }
}

// 取消全部转换
async function cancelAllConversions() {
    const processingConversions = conversions.filter(c => c.status === 'processing');
    
    if (processingConversions.length === 0) {
        showNotification('没有正在处理的转换', 'warning');
        return;
    }
    
    for (const conversion of processingConversions) {
        await cancelConversion(conversion.id);
    }
}

// 删除转换
async function deleteConversion(conversionId) {
    if (!confirm('确定要删除这个转换记录吗？')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/upload/${conversionId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('转换记录已删除', 'success');
            loadConversions();
        } else {
            showNotification(`删除失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('删除失败:', error);
        showNotification(`删除失败: ${error.message}`, 'error');
    }
}

// 下载思维导图
function downloadMindmap(conversionId, format) {
    const url = `/api/export/mindmap/${conversionId}/${format}`;
    window.open(url, '_blank');
}

// 导出Excel报告
async function exportExcel() {
    try {
        const response = await fetch('/api/export/excel');
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `转换报告_${new Date().toISOString().split('T')[0]}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            showNotification('Excel报告导出成功', 'success');
        } else {
            showNotification('导出Excel报告失败', 'error');
        }
    } catch (error) {
        console.error('导出Excel失败:', error);
        showNotification(`导出Excel失败: ${error.message}`, 'error');
    }
}

// 加载思维导图库
async function loadMindmaps() {
    try {
        const response = await fetch('/api/mindmap');
        const result = await response.json();
        
        if (result.success) {
            updateMindmapGrid(result.data);
        }
    } catch (error) {
        console.error('加载思维导图库失败:', error);
    }
}

// 更新思维导图网格
function updateMindmapGrid(mindmaps) {
    const mindmapGrid = document.getElementById('mindmapGrid');
    
    if (mindmaps.length === 0) {
        mindmapGrid.innerHTML = '<p style="text-align: center; color: #718096; padding: 40px;">暂无思维导图</p>';
        return;
    }
    
    mindmapGrid.innerHTML = mindmaps.map(mindmap => `
        <div class="mindmap-card" onclick="viewMindmap('${mindmap.id}')">
            <div class="mindmap-title">${mindmap.original_filename}</div>
            <div class="mindmap-summary">${mindmap.summary || '暂无摘要'}</div>
            <div class="mindmap-meta">
                <span>${mindmap.file_type.toUpperCase()}</span>
                <span>${new Date(mindmap.created_at).toLocaleDateString('zh-CN')}</span>
            </div>
            <div class="mindmap-actions">
                <button class="btn-success" onclick="event.stopPropagation(); downloadMindmap('${mindmap.id}', 'html')">
                    <i class="fas fa-download"></i> HTML
                </button>
                <button class="btn-success" onclick="event.stopPropagation(); downloadMindmap('${mindmap.id}', 'png')">
                    <i class="fas fa-image"></i> PNG
                </button>
                <button class="btn-success" onclick="event.stopPropagation(); downloadMindmap('${mindmap.id}', 'pdf')">
                    <i class="fas fa-file-pdf"></i> PDF
                </button>
            </div>
        </div>
    `).join('');
}

// 查看思维导图
function viewMindmap(conversionId) {
    const url = `/api/export/mindmap/${conversionId}/html`;
    window.open(url, '_blank');
}

// 搜索思维导图
async function searchMindmaps() {
    const keyword = document.getElementById('searchKeyword').value;
    const dateFilter = document.getElementById('dateFilter').value;
    const modelFilter = document.getElementById('modelFilter').value;
    
    try {
        const params = new URLSearchParams();
        if (keyword) params.append('keyword', keyword);
        if (dateFilter) {
            const date = new Date();
            switch (dateFilter) {
                case 'today':
                    params.append('start_date', date.toISOString().split('T')[0]);
                    break;
                case 'week':
                    date.setDate(date.getDate() - 7);
                    params.append('start_date', date.toISOString().split('T')[0]);
                    break;
                case 'month':
                    date.setMonth(date.getMonth() - 1);
                    params.append('start_date', date.toISOString().split('T')[0]);
                    break;
            }
        }
        if (modelFilter) params.append('model_used', modelFilter);
        
        const response = await fetch(`/api/mindmap/search?${params}`);
        const result = await response.json();
        
        if (result.success) {
            updateMindmapGrid(result.data);
            showNotification(`找到 ${result.data.length} 个结果`, 'success');
        }
    } catch (error) {
        console.error('搜索失败:', error);
        showNotification(`搜索失败: ${error.message}`, 'error');
    }
}

// 清除筛选
function clearFilters() {
    document.getElementById('searchKeyword').value = '';
    document.getElementById('dateFilter').value = '';
    document.getElementById('modelFilter').value = '';
    loadMindmaps();
}

// 加载系统统计
async function loadSystemStats() {
    try {
        const response = await fetch('/api/export/stats');
        const result = await response.json();
        
        if (result.success) {
            updateSystemStats(result.data);
        }
    } catch (error) {
        console.error('加载系统统计失败:', error);
    }
}

// 更新系统统计显示
function updateSystemStats(stats) {
    const systemStats = document.getElementById('systemStats');
    
    systemStats.innerHTML = `
        <div class="stat-card">
            <h4>总文件数</h4>
            <div class="stat-number">${stats.overview.total}</div>
        </div>
        <div class="stat-card">
            <h4>已完成</h4>
            <div class="stat-number">${stats.overview.completed}</div>
        </div>
        <div class="stat-card">
            <h4>处理中</h4>
            <div class="stat-number">${stats.overview.processing}</div>
        </div>
        <div class="stat-card">
            <h4>失败</h4>
            <div class="stat-number">${stats.overview.failed}</div>
        </div>
        <div class="stat-card">
            <h4>平均处理时间</h4>
            <div class="stat-number">${stats.processingTime.average}秒</div>
        </div>
    `;
}

// 测试Ollama连接
async function testOllamaConnection() {
    const ollamaUrl = document.getElementById('ollamaUrl').value;
    
    try {
        const response = await fetch('/api/ollama/health');
        const result = await response.json();
        
        if (result.success) {
            if (result.data.healthy) {
                showNotification('Ollama服务连接正常', 'success');
            } else {
                showNotification('Ollama服务未运行，但可以使用默认模型', 'warning');
            }
        } else {
            showNotification('Ollama服务连接失败', 'error');
        }
    } catch (error) {
        console.error('测试Ollama连接失败:', error);
        showNotification(`测试Ollama连接失败: ${error.message}`, 'error');
    }
}

// 测试数据库连接
async function testDatabaseConnection() {
    try {
        const response = await fetch('/api/ollama/db-health');
        const result = await response.json();
        
        if (result.success) {
            if (result.data.healthy) {
                document.getElementById('dbStatus').textContent = '连接正常';
                document.getElementById('dbStatus').className = 'status-indicator status-online';
                showNotification('数据库连接正常', 'success');
            } else {
                document.getElementById('dbStatus').textContent = '连接失败';
                document.getElementById('dbStatus').className = 'status-indicator status-offline';
                showNotification(`数据库连接失败: ${result.data.message}`, 'error');
            }
        } else {
            document.getElementById('dbStatus').textContent = '连接失败';
            document.getElementById('dbStatus').className = 'status-indicator status-offline';
            showNotification('数据库连接失败', 'error');
        }
    } catch (error) {
        console.error('测试数据库连接失败:', error);
        document.getElementById('dbStatus').textContent = '连接失败';
        document.getElementById('dbStatus').className = 'status-indicator status-offline';
        showNotification(`测试数据库连接失败: ${error.message}`, 'error');
    }
}

// 更新转换状态
function updateConversionStatus(conversionId, status, progress, message) {
    const conversion = conversions.find(c => c.id === conversionId);
    if (conversion) {
        conversion.status = status;
        conversion.progress = progress;
        updateConversionList();
        updateProgressStats();
    }
}

// 显示通知
function showNotification(message, type = 'info') {
    const notifications = document.getElementById('notifications');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    const icon = type === 'success' ? 'check-circle' : 
                 type === 'error' ? 'exclamation-circle' : 
                 type === 'warning' ? 'exclamation-triangle' : 'info-circle';
    
    notification.innerHTML = `
        <i class="fas fa-${icon}"></i>
        <span>${message}</span>
    `;
    
    notifications.appendChild(notification);
    
    // 5秒后自动移除通知
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 5000);
}

// 关闭进度模态框
function closeProgressModal() {
    const modal = document.getElementById('progressModal');
    modal.classList.remove('show');
}

// 生成唯一ID
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}
