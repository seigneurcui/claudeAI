-- 创建数据库表结构

-- 转换记录表
CREATE TABLE IF NOT EXISTS conversions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    file_type VARCHAR(50) NOT NULL,
    file_size BIGINT NOT NULL,
    model_used VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    mindmap_data JSONB,
    summary TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processing_time INTEGER, -- 处理时间（秒）
    error_message TEXT
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_conversions_status ON conversions(status);
CREATE INDEX IF NOT EXISTS idx_conversions_created_at ON conversions(created_at);
CREATE INDEX IF NOT EXISTS idx_conversions_model_used ON conversions(model_used);
CREATE INDEX IF NOT EXISTS idx_conversions_file_type ON conversions(file_type);

-- 创建更新时间触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_conversions_updated_at 
    BEFORE UPDATE ON conversions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- 插入一些示例数据（可选）
-- INSERT INTO conversions (filename, original_filename, file_type, file_size, model_used, status, progress, summary) 
-- VALUES 
-- ('sample1.pdf', 'sample1.pdf', 'pdf', 1024000, 'llama2', 'completed', 100, '这是一本关于人工智能的书籍总结'),
-- ('sample2.epub', 'sample2.epub', 'epub', 2048000, 'llama2', 'completed', 100, '这是一本关于机器学习的书籍总结');
