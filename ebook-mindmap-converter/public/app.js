// 全局变量
let socket;
let selectedFiles = [];
let conversions = [];
let availableModels = [];
let currentTab = 'upload';
let allMindmaps = [];
let currentMindmapPage = 1;
let perPage = 9;
let currentConversionPage = 1;
let conversionsPerPage = 10;

// 防抖函数，避免快速多次触发搜索
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

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
    
    // 搜索相关事件监听器 - 修复版本
    const searchBtn = document.getElementById('searchBtn');
    const searchKeyword = document.getElementById('searchKeyword');
    const modelFilter = document.getElementById('modelFilter');
    const dateFilter = document.getElementById('dateFilter');
    const clearFiltersBtn = document.getElementById('clearFilters');
    
    if (searchBtn) {
        searchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('搜索按钮被点击');
            performSearch();
        });
    }
    
    if (searchKeyword) {
        // 回车键搜索
        searchKeyword.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                console.log('回车键触发搜索');
                performSearch();
            }
        });
        
        // 实时搜索（带防抖）
        searchKeyword.addEventListener('input', debounce(() => {
            console.log('输入框内容变化，触发搜索');
            performSearch();
        }, 500));
    }
    
    if (modelFilter) {
        modelFilter.addEventListener('change', () => {
            console.log('模型筛选变化，触发搜索');
            performSearch();
        });
    }
    
    if (dateFilter) {
        dateFilter.addEventListener('change', () => {
            console.log('日期筛选变化，触发搜索');
            performSearch();
        });
    }
    
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => {
            console.log('清除筛选按钮被点击');
            clearFilters();
        });
    }
    
    document.getElementById('testOllama').addEventListener('click', testOllamaConnection);
    document.getElementById('testDb').addEventListener('click', testDatabaseConnection);
    
    // 分页选择器事件
    document.getElementById('perPageSelect').addEventListener('change', () => {
        perPage = parseInt(document.getElementById('perPageSelect').value);
        if (perPage === 0) perPage = 999999; // Treat ALL as a large number
        currentMindmapPage = 1;
        updateMindmapDisplay();
    });
    
    document.getElementById('conversionsPerPageSelect').addEventListener('change', () => {
        conversionsPerPage = parseInt(document.getElementById('conversionsPerPageSelect').value);
        if (conversionsPerPage === 0) conversionsPerPage = 999999; // Treat ALL as a large number
        currentConversionPage = 1;
        updateConversionList();
    });
}

// 统一的搜索执行函数
async function performSearch() {
    console.log('开始执行搜索...');
    
    const keyword = document.getElementById('searchKeyword')?.value?.trim() || '';
    const dateFilter = document.getElementById('dateFilter')?.value || '';
    const modelFilter = document.getElementById('modelFilter')?.value || '';
    
    console.log('搜索参数:', { keyword, dateFilter, modelFilter });
    
    try {
        // 如果没有任何筛选条件，直接加载所有数据
        if (!keyword && !dateFilter && !modelFilter) {
            console.log('无筛选条件，加载所有数据');
            await loadMindmaps();
            return;
        }
        
        const params = new URLSearchParams();
        
        // 添加关键字参数
        if (keyword) {
            params.append('keyword', keyword);
            console.log('添加关键字筛选:', keyword);
        }
        
        // 添加模型筛选参数
        if (modelFilter) {
            params.append('model_used', modelFilter);
            console.log('添加模型筛选:', modelFilter);
        }
        
        // 添加日期筛选参数
        if (dateFilter) {
            const now = new Date();
            let startDate;
            
            switch (dateFilter) {
                case 'today':
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    break;
                case 'week':
                    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'month':
                    startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                    break;
                default:
                    startDate = null;
            }
            
            if (startDate) {
                params.append('start_date', startDate.toISOString().split('T')[0]);
                params.append('end_date', now.toISOString().split('T')[0]);
                console.log('添加日期筛选:', { 
                    start_date: startDate.toISOString().split('T')[0], 
                    end_date: now.toISOString().split('T')[0] 
                });
            }
        }
        
        const searchUrl = `/api/mindmap/search?${params.toString()}`;
        console.log('搜索URL:', searchUrl);
        
        showNotification('正在搜索...', 'info');
        
        const response = await fetch(searchUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        console.log('搜索响应状态:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('搜索结果:', result);
        
        if (result.success) {
            allMindmaps = result.data || [];
            currentMindmapPage = 1;
            populateMindmapModelFilter();
            updateMindmapDisplay();
            showNotification(`找到 ${allMindmaps.length} 个结果`, 'success');
        } else {
            console.error('搜索失败:', result.error);
            showNotification(`搜索失败: ${result.error}`, 'error');
            allMindmaps = [];
            populateMindmapModelFilter();
            updateMindmapDisplay();
        }
    } catch (error) {
        console.error('搜索过程中发生错误:', error);
        showNotification(`搜索失败: ${error.message}`, 'error');
        allMindmaps = [];
        populateMindmapModelFilter();
        updateMindmapDisplay();
    }
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
            
            // 自动开始转换
            const conversionIds = result.conversions.map(c => c.id);
            await startAllConversions(conversionIds);
        } else {
            showNotification(`上传失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('文件上传失败:', error);
        showNotification(`文件上传失败: ${error.message}`, 'error');
    }
}

// 加载转换列表
async function loadConversions() {
    try {
        const response = await fetch('/api/conversion/all');
        const result = await response.json();
        
        if (result.success) {
            conversions = result.data;
            updateConversionList();
            updateProgressStats();
        }
    } catch (error) {
        console.error('加载转换列表失败:', error);
    }
}

// 更新转换列表
function updateConversionList() {
    const conversionList = document.getElementById('conversionList');
    
    const perPageValue = parseInt(document.getElementById('conversionsPerPageSelect').value);
    conversionsPerPage = perPageValue === 0 ? conversions.length : perPageValue;

    const start = (currentConversionPage - 1) * conversionsPerPage;
    const end = start + conversionsPerPage;
    const displayedConversions = conversions.slice(start, end);
    
    if (displayedConversions.length === 0) {
        conversionList.innerHTML = '<p style="text-align: center; color: #718096; padding: 40px;">暂无转换记录</p>';
        updateConversionPagination();
        return;
    }
    
    conversionList.innerHTML = displayedConversions.map(c => `
        <div class="file-item">
            <div class="file-icon">
                <i class="fas fa-file-${getFileIcon(c.original_filename)}"></i>
            </div>
            <div class="file-info">
                <div class="file-name">${c.original_filename}</div>
                <div class="file-details">
                    状态: ${getStatusText(c.status)} |
                    进度: ${c.progress}% |
                    模型: ${c.model_used} |
                    耗时: ${c.processing_time || 0}秒
                </div>
            </div>
            <div class="file-actions">
                ${c.status === 'processing' ? `
                    <button class="btn-danger" onclick="cancelConversion('${c.id}')">
                        <i class="fas fa-stop"></i> 取消
                    </button>
                ` : ''}
                ${c.status === 'completed' ? `
                    <button class="btn-success" onclick="viewMindmap('${c.id}')">
                        <i class="fas fa-eye"></i> 查看
                    </button>
                ` : ''}
                <button class="btn-danger" onclick="deleteConversion('${c.id}')">
                    <i class="fas fa-trash"></i> 删除
                </button>
            </div>
        </div>
    `).join('');
    
    updateConversionPagination();
}

// 更新转换分页控件
function updateConversionPagination() {
    const pagination = document.getElementById('conversionPagination');
    pagination.innerHTML = '';

    if (conversionsPerPage >= conversions.length) return; // No pagination if showing all

    const totalPages = Math.ceil(conversions.length / conversionsPerPage);

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '<';
    prevBtn.disabled = currentConversionPage === 1;
    prevBtn.onclick = () => {
        if (currentConversionPage > 1) {
            currentConversionPage--;
            updateConversionList();
        }
    };
    pagination.appendChild(prevBtn);

    for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement('button');
        btn.textContent = i;
        if (i === currentConversionPage) btn.classList.add('active');
        btn.onclick = () => {
            currentConversionPage = i;
            updateConversionList();
        };
        pagination.appendChild(btn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.textContent = '>';
    nextBtn.disabled = currentConversionPage === totalPages;
    nextBtn.onclick = () => {
        if (currentConversionPage < totalPages) {
            currentConversionPage++;
            updateConversionList();
        }
    };
    pagination.appendChild(nextBtn);
}

// 获取状态文本
function getStatusText(status) {
    const statusMap = {
        uploaded: '已上传',
        processing: '处理中',
        completed: '已完成',
        failed: '失败',
        cancelled: '已取消'
    };
    return statusMap[status] || status;
}

// 开始全部转换
async function startAllConversions(specificIds = null) {
    const conversionIds = specificIds || conversions
        .filter(c => c.status === 'uploaded')
        .map(c => c.id);
    
    if (conversionIds.length === 0) {
        showNotification('没有可转换的文件', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/conversion/batch-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversionIds })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(`已开始 ${result.results.length} 个转换任务`, 'success');
        } else {
            showNotification(`批量转换失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('批量转换失败:', error);
        showNotification(`批量转换失败: ${error.message}`, 'error');
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
            showNotification('转换已取消', 'success');
        } else {
            showNotification(`取消转换失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('取消转换失败:', error);
        showNotification(`取消转换失败: ${error.message}`, 'error');
    }
}

// 删除转换
async function deleteConversion(conversionId) {
    try {
        const response = await fetch(`/api/upload/${conversionId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            conversions = conversions.filter(c => c.id !== conversionId);
            updateConversionList();
            updateProgressStats();
            showNotification('文件删除成功', 'success');
        } else {
            showNotification(`删除失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('删除文件失败:', error);
        showNotification(`删除文件失败: ${error.message}`, 'error');
    }
}

// 取消全部转换
async function cancelAllConversions() {
    const processingIds = conversions
        .filter(c => c.status === 'processing')
        .map(c => c.id);
    
    if (processingIds.length === 0) {
        showNotification('没有正在处理的转换', 'warning');
        return;
    }
    
    for (const id of processingIds) {
        await cancelConversion(id);
    }
}

// 更新转换统计
function updateProgressStats() {
    const total = conversions.length;
    const completed = conversions.filter(c => c.status === 'completed').length;
    const processing = conversions.filter(c => c.status === 'processing').length;
    const totalTime = conversions
        .filter(c => c.processing_time)
        .reduce((sum, c) => sum + c.processing_time, 0);
    
    document.getElementById('totalFiles').textContent = total;
    document.getElementById('completedFiles').textContent = completed;
    document.getElementById('processingFiles').textContent = processing;
    document.getElementById('totalTime').textContent = `${totalTime}秒`;
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
        console.log('开始加载思维导图库...');
        const response = await fetch('/api/mindmap');
        const result = await response.json();
        
        console.log('思维导图库加载响应:', result);
        
        if (result.success) {
            allMindmaps = result.data || [];
            currentMindmapPage = 1;
            populateMindmapModelFilter();
            updateMindmapDisplay();
            console.log(`加载了 ${allMindmaps.length} 个思维导图`);
        } else {
            showNotification(`加载思维导图库失败: ${result.error}`, 'error');
            allMindmaps = [];
            populateMindmapModelFilter();
            updateMindmapDisplay();
        }
    } catch (error) {
        console.error('加载思维导图库失败:', error);
        showNotification(`加载思维导图库失败: ${error.message}`, 'error');
        allMindmaps = [];
        populateMindmapModelFilter();
        updateMindmapDisplay();
    }
}

// 更新思维导图显示
function updateMindmapDisplay() {
    const perPageValue = parseInt(document.getElementById('perPageSelect').value);
    perPage = perPageValue === 0 ? allMindmaps.length : perPageValue;

    const start = (currentMindmapPage - 1) * perPage;
    const end = start + perPage;
    const displayedMindmaps = allMindmaps.slice(start, end);

    updateMindmapGrid(displayedMindmaps);
    updatePagination();
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
                <span>${mindmap.file_type ? mindmap.file_type.toUpperCase() : 'N/A'}</span>
                <span>${mindmap.model_used || 'N/A'}</span>
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

// 更新分页控件
function updatePagination() {
    const pagination = document.getElementById('pagination');
    pagination.innerHTML = '';

    if (perPage >= allMindmaps.length) return; // No pagination if showing all

    const totalPages = Math.ceil(allMindmaps.length / perPage);

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '<';
    prevBtn.disabled = currentMindmapPage === 1;
    prevBtn.onclick = () => {
        if (currentMindmapPage > 1) {
            currentMindmapPage--;
            updateMindmapDisplay();
        }
    };
    pagination.appendChild(prevBtn);

    for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement('button');
        btn.textContent = i;
        if (i === currentMindmapPage) btn.classList.add('active');
        btn.onclick = () => {
            currentMindmapPage = i;
            updateMindmapDisplay();
        };
        pagination.appendChild(btn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.textContent = '>';
    nextBtn.disabled = currentMindmapPage === totalPages;
    nextBtn.onclick = () => {
        if (currentMindmapPage < totalPages) {
            currentMindmapPage++;
            updateMindmapDisplay();
        }
    };
    pagination.appendChild(nextBtn);
}

// 查看思维导图
function viewMindmap(conversionId) {
    const url = `/api/export/mindmap/${conversionId}/html`;
    window.open(url, '_blank');
}

// 下载思维导图
async function downloadMindmap(conversionId, format) {
    try {
        const response = await fetch(`/api/export/mindmap/${conversionId}/${format}`);
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mindmap_${conversionId}.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showNotification(`思维导图 ${format.toUpperCase()} 下载成功`, 'success');
        } else {
            showNotification(`下载失败: ${format.toUpperCase()}`, 'error');
        }
    } catch (error) {
        console.error(`下载思维导图失败 (${format}):`, error);
        showNotification(`下载失败: ${error.message}`, 'error');
    }
}

// 清除筛选 - 修复版本
function clearFilters() {
    console.log('清除所有筛选条件');
    
    const searchKeyword = document.getElementById('searchKeyword');
    const dateFilter = document.getElementById('dateFilter');
    const modelFilter = document.getElementById('modelFilter');
    
    if (searchKeyword) searchKeyword.value = '';
    if (dateFilter) dateFilter.value = '';
    if (modelFilter) modelFilter.value = '';
    
    // 重新加载所有数据
    loadMindmaps();
    showNotification('筛选条件已清除', 'success');
}

// 填充思维导图模型过滤器
function populateMindmapModelFilter() {
    const select = document.getElementById('modelFilter');
    if (!select) return;
    
    const currentValue = select.value;
    select.innerHTML = '<option value="">全部模型</option>';
    
    const uniqueModels = [...new Set(allMindmaps.map(m => m.model_used).filter(Boolean))].sort();
    
    uniqueModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        select.appendChild(option);
    });
    
    // Restore previous selection if it still exists
    if (currentValue && uniqueModels.includes(currentValue)) {
        select.value = currentValue;
    }
}

// 加载模型列表
async function loadModels() {
    try {
        const ollamaUrl = document.getElementById('ollamaUrl').value || 'http://localhost:11434';
        const response = await fetch(`${ollamaUrl}/api/tags`);
        const result = await response.json();
        
        if (result.models && Array.isArray(result.models)) {
            availableModels = result.models.map(model => model.name);
            console.log('Loaded models:', availableModels);
            populateModelSelect('modelSelect');
            populateModelSelect('defaultModel');
            showNotification('模型列表加载成功', 'success');
        } else {
            throw new Error('Unexpected response format');
        }
    } catch (error) {
        console.error('加载模型失败:', error);
        availableModels = [];
        populateModelSelect('modelSelect');
        populateModelSelect('defaultModel');
        showNotification(`加载模型失败: ${error.message}`, 'error');
    }
}

// 填充模型选择器
function populateModelSelect(selectId) {
    const select = document.getElementById(selectId);
    select.innerHTML = '';
    
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = selectId === 'modelSelect' ? '请选择模型' : '无默认模型';
    select.appendChild(defaultOption);
    
    if (availableModels.length === 0) {
        const noModelsOption = document.createElement('option');
        noModelsOption.value = '';
        noModelsOption.textContent = '无可用模型';
        noModelsOption.disabled = true;
        select.appendChild(noModelsOption);
    } else {
        availableModels.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            select.appendChild(option);
        });
    }
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
        const response = await fetch(`${ollamaUrl}/api/tags`);
        const result = await response.json();
        
        if (result.models && Array.isArray(result.models)) {
            showNotification('Ollama服务连接正常', 'success');
        } else {
            showNotification('Ollama服务响应格式错误', 'error');
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

// 兼容旧的搜索函数名称
function searchMindmaps() {
    performSearch();
}