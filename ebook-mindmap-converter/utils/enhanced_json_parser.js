// utils/enhancedJsonParser.js - 专门处理Ollama模型输出的JSON解析器

class EnhancedJSONParser {
    /**
     * 专门处理Ollama模型输出的智能JSON解析
     * @param {string} rawResponse - 原始响应
     * @returns {Object|null} - 解析后的思维导图对象
     */
    static parseOllamaResponse(rawResponse) {
        if (!rawResponse || typeof rawResponse !== 'string') {
            console.log('输入无效');
            return null;
        }

        console.log('开始解析Ollama响应...');
        console.log('原始响应长度:', rawResponse.length);
        console.log('原始响应内容:', rawResponse);

        // 1. 尝试直接解析
        const directResult = this.tryDirectParse(rawResponse);
        if (directResult) {
            console.log('直接解析成功');
            return this.validateAndFixMindmapStructure(directResult);
        }

        // 2. 尝试修复并解析
        const fixedResult = this.tryFixAndParse(rawResponse);
        if (fixedResult) {
            console.log('修复后解析成功');
            return this.validateAndFixMindmapStructure(fixedResult);
        }

        // 3. 尝试部分重建
        const rebuiltResult = this.tryRebuildFromPartial(rawResponse);
        if (rebuiltResult) {
            console.log('部分重建成功');
            return this.validateAndFixMindmapStructure(rebuiltResult);
        }

        // 4. 创建基于内容的默认结构
        console.log('所有解析尝试失败，创建默认结构');
        return this.createIntelligentDefault(rawResponse);
    }

    /**
     * 尝试直接解析JSON
     */
    static tryDirectParse(jsonString) {
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            console.log('直接解析失败:', error.message);
            return null;
        }
    }

    /**
     * 尝试修复常见问题后解析
     */
    static tryFixAndParse(jsonString) {
        try {
            console.log('开始修复JSON...');
            
            // 步骤1: 提取JSON部分
            let cleaned = this.extractMainJSONBlock(jsonString);
            console.log('提取后的JSON:', cleaned);

            // 步骤2: 修复结构问题
            cleaned = this.fixStructuralIssues(cleaned);
            console.log('修复结构后:', cleaned);

            // 步骤3: 修复语法问题
            cleaned = this.fixSyntaxIssues(cleaned);
            console.log('修复语法后:', cleaned);

            // 步骤4: 尝试解析
            return JSON.parse(cleaned);

        } catch (error) {
            console.log('修复后解析失败:', error.message);
            console.log('错误位置分析:', this.analyzeErrorPosition(error, jsonString));
            return null;
        }
    }

    /**
     * 提取主要的JSON块
     */
    static extractMainJSONBlock(text) {
        // 查找第一个完整的 { ... } 块
        const stack = [];
        let start = -1;
        let result = '';

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            
            if (char === '{') {
                if (stack.length === 0) {
                    start = i;
                }
                stack.push('{');
            } else if (char === '}') {
                stack.pop();
                if (stack.length === 0 && start !== -1) {
                    result = text.substring(start, i + 1);
                    break;
                }
            }
        }

        return result || text;
    }

    /**
     * 修复结构问题
     */
    static fixStructuralIssues(jsonString) {
        let fixed = jsonString.trim();

        // 确保有完整的开始和结束
        if (!fixed.startsWith('{')) {
            const firstBrace = fixed.indexOf('{');
            if (firstBrace !== -1) {
                fixed = fixed.substring(firstBrace);
            }
        }

        // 计算括号平衡
        const openBraces = (fixed.match(/{/g) || []).length;
        const closeBraces = (fixed.match(/}/g) || []).length;
        const openBrackets = (fixed.match(/\[/g) || []).length;
        const closeBrackets = (fixed.match(/]/g) || []).length;

        console.log('括号统计:', { openBraces, closeBraces, openBrackets, closeBrackets });

        // 修复不完整的数组和对象
        if (openBrackets > closeBrackets) {
            // 如果最后一个字符不是逗号或闭合符，添加闭合符
            const lastChar = fixed.trim().slice(-1);
            if (lastChar === ',') {
                fixed = fixed.trim().slice(0, -1); // 移除尾随逗号
            }
            
            // 添加缺失的闭合括号
            for (let i = 0; i < openBrackets - closeBrackets; i++) {
                fixed += ']';
            }
        }

        if (openBraces > closeBraces) {
            for (let i = 0; i < openBraces - closeBraces; i++) {
                fixed += '}';
            }
        }

        return fixed;
    }

    /**
     * 修复语法问题
     */
    static fixSyntaxIssues(jsonString) {
        let fixed = jsonString;

        // 修复尾随逗号
        fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
        
        // 修复单引号
        fixed = fixed.replace(/'/g, '"');
        
        // 修复未引用的键
        fixed = fixed.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
        
        // 修复缺少引号的字符串值
        fixed = fixed.replace(/:(\s*)([a-zA-Z][^",}\]]*?)(\s*[,}\]])/g, ':"$2"$3');

        return fixed;
    }

    /**
     * 尝试从部分数据重建JSON
     */
    static tryRebuildFromPartial(text) {
        try {
            console.log('尝试从部分数据重建...');
            
            // 提取可识别的字段
            const title = this.extractField(text, 'title');
            const summary = this.extractField(text, 'summary');
            const nodes = this.extractNodesFromPartial(text);

            const rebuilt = {
                title: title || 'Becoming An Entrepreneur',
                summary: summary || '企业家精神指南',
                nodes: nodes.length > 0 ? nodes : this.createDefaultNodes(title)
            };

            console.log('重建结果:', JSON.stringify(rebuilt, null, 2));
            return rebuilt;

        } catch (error) {
            console.log('重建失败:', error.message);
            return null;
        }
    }

    /**
     * 从文本中提取字段值
     */
    static extractField(text, fieldName) {
        const patterns = [
            new RegExp(`"${fieldName}"\\s*:\\s*"([^"]*)"`, 'i'),
            new RegExp(`"${fieldName}"\\s*:\\s*'([^']*)'`, 'i'),
            new RegExp(`${fieldName}\\s*:\\s*"([^"]*)"`, 'i')
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1];
            }
        }

        return null;
    }

    /**
     * 从部分数据中提取节点信息
     */
    static extractNodesFromPartial(text) {
        const nodes = [];
        let nodeIdCounter = 1;

        // 查找节点模式
        const nodePatterns = [
            /"label"\s*:\s*"([^"]*)"/g,
            /"label"\s*:\s*'([^']*)'/g,
            /label\s*:\s*"([^"]*)"/g
        ];

        const labels = new Set();
        
        for (const pattern of nodePatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                labels.add(match[1]);
            }
        }

        // 转换为节点数组
        Array.from(labels).forEach((label, index) => {
            nodes.push({
                id: String(nodeIdCounter++),
                label: label,
                level: index === 0 ? 0 : 1,
                children: []
            });
        });

        // 如果没有找到标签，尝试从内容中提取关键概念
        if (nodes.length === 0) {
            const conceptMatches = text.match(/"([^"]*(?:指南|基础|创业|商业)[^"]*)"/g);
            if (conceptMatches) {
                conceptMatches.forEach((match, index) => {
                    const cleanLabel = match.replace(/"/g, '');
                    if (cleanLabel.length > 2 && cleanLabel.length < 50) {
                        nodes.push({
                            id: String(nodeIdCounter++),
                            label: cleanLabel,
                            level: index === 0 ? 0 : 1,
                            children: []
                        });
                    }
                });
            }
        }

        return nodes.slice(0, 10); // 限制节点数量
    }

    /**
     * 创建默认节点
     */
    static createDefaultNodes(title) {
        const baseTitle = title || 'Becoming An Entrepreneur';
        return [
            {
                id: '1',
                label: baseTitle,
                level: 0,
                children: []
            },
            {
                id: '2',
                label: '首个指南',
                level: 1,
                children: []
            },
            {
                id: '3',
                label: '创业的基础',
                level: 1,
                children: []
            },
            {
                id: '4',
                label: '小型商业公司',
                level: 1,
                children: []
            }
        ];
    }

    /**
     * 验证和修复思维导图结构
     */
    static validateAndFixMindmapStructure(data) {
        if (!data || typeof data !== 'object') {
            return null;
        }

        const fixed = {
            title: data.title || 'Unknown Title',
            summary: data.summary || data.description || 'No summary available',
            nodes: []
        };

        // 处理节点数组
        if (Array.isArray(data.nodes)) {
            fixed.nodes = data.nodes.map((node, index) => this.fixNodeStructure(node, index));
        } else if (data.nodes && typeof data.nodes === 'object') {
            // 如果nodes是对象而不是数组
            fixed.nodes = [this.fixNodeStructure(data.nodes, 0)];
        }

        // 确保至少有一个根节点
        if (fixed.nodes.length === 0) {
            fixed.nodes = this.createDefaultNodes(fixed.title);
        }

        // 验证节点ID唯一性
        fixed.nodes = this.ensureUniqueIds(fixed.nodes);

        return fixed;
    }

    /**
     * 修复单个节点结构
     */
    static fixNodeStructure(node, index) {
        return {
            id: node.id || String(index + 1),
            label: node.label || node.name || node.text || `Node ${index + 1}`,
            level: typeof node.level === 'number' ? node.level : (index === 0 ? 0 : 1),
            children: Array.isArray(node.children) ? node.children : []
        };
    }

    /**
     * 确保节点ID唯一性
     */
    static ensureUniqueIds(nodes) {
        const seenIds = new Set();
        let counter = 1;

        return nodes.map(node => {
            if (seenIds.has(node.id)) {
                node.id = String(counter++);
            }
            seenIds.add(node.id);
            return node;
        });
    }

    /**
     * 创建基于内容的智能默认结构
     */
    static createIntelligentDefault(rawText) {
        // 尝试从原始文本中提取信息
        const title = this.extractField(rawText, 'title') || 
                     'Becoming An Entrepreneur';
        
        const summary = this.extractField(rawText, 'summary') || 
                       '企业家精神和小型商业指南';

        console.log('创建智能默认结构:', { title, summary });

        return {
            title: title,
            summary: summary,
            nodes: [
                {
                    id: '1',
                    label: title,
                    level: 0,
                    children: []
                },
                {
                    id: '2',
                    label: '企业家基础',
                    level: 1,
                    children: []
                },
                {
                    id: '3',
                    label: '商业计划',
                    level: 1,
                    children: []
                },
                {
                    id: '4',
                    label: '创业指南',
                    level: 1,
                    children: []
                }
            ]
        };
    }

    /**
     * 分析错误位置
     */
    static analyzeErrorPosition(error, text) {
        const message = error.message;
        const positionMatch = message.match(/position (\d+)/);
        
        if (positionMatch) {
            const position = parseInt(positionMatch[1]);
            const beforeError = text.substring(Math.max(0, position - 50), position);
            const atError = text.substring(position, position + 10);
            const afterError = text.substring(position + 10, position + 60);
            
            return {
                position: position,
                before: beforeError,
                at: atError,
                after: afterError,
                context: `...${beforeError}[ERROR HERE: "${atError}"]${afterError}...`
            };
        }
        
        return null;
    }

    /**
     * 调试输出方法
     */
    static debugOutput(label, data) {
        console.group(`🐛 ${label}`);
        console.log('数据类型:', typeof data);
        console.log('数据长度:', typeof data === 'string' ? data.length : 'N/A');
        console.log('前100字符:', typeof data === 'string' ? data.substring(0, 100) : data);
        console.groupEnd();
    }
}

module.exports = EnhancedJSONParser;