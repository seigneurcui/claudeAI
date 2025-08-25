const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const fs = require('fs').promises;
const ExcelJS = require('exceljs');

const app = express();
const port = 8805;

// 中间件配置
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// PostgreSQL数据库配置
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || '127.0.0.1',
  database: process.env.DB_NAME || 'app_manager',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 6432,
});

// 初始化数据库表
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS installed_apps (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        version VARCHAR(100),
        publisher VARCHAR(255),
        install_date DATE,
        install_location TEXT,
        size_mb DECIMAL,
        system_type VARCHAR(50),
        architecture VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // 创建索引以提高搜索性能
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_app_name ON installed_apps(name);
      CREATE INDEX IF NOT EXISTS idx_system_type ON installed_apps(system_type);
      CREATE INDEX IF NOT EXISTS idx_publisher ON installed_apps(publisher);
    `);
    
    console.log('数据库初始化完成');
  } catch (error) {
    console.error('数据库初始化失败:', error);
  }
}

// 系统应用程序获取类
class SystemAppManager {
  static async getInstalledApps() {
    const platform = os.platform();
    const architecture = os.arch();
    
    switch (platform) {
      case 'win32':
        return await this.getWindowsApps(architecture);
      case 'darwin':
        return await this.getMacApps(architecture);
      case 'linux':
        return await this.getLinuxApps(architecture);
      default:
        throw new Error(`不支持的操作系统: ${platform}`);
    }
  }
  
  // Windows应用程序获取
  static async getWindowsApps(architecture) {
    return new Promise((resolve, reject) => {
      const script = `
        Get-WmiObject -Class Win32_Product | Select-Object Name, Version, Vendor, InstallDate, InstallLocation | 
        ConvertTo-Json -Depth 3
      `;
      
      exec(`powershell -Command "${script}"`, { maxBuffer: 1024 * 1024 * 10 }, async (error, stdout) => {
        if (error) {
          // 如果WMI失败，尝试注册表方法
          try {
            const regApps = await this.getWindowsAppsFromRegistry();
            resolve(regApps.map(app => ({
              ...app,
              system_type: 'Windows',
              architecture
            })));
          } catch (regError) {
            reject(regError);
          }
          return;
        }
        
        try {
          const apps = JSON.parse(stdout) || [];
          const formattedApps = (Array.isArray(apps) ? apps : [apps]).map(app => ({
            name: app.Name || 'Unknown',
            version: app.Version || 'Unknown',
            publisher: app.Vendor || 'Unknown',
            install_date: app.InstallDate ? this.parseWindowsDate(app.InstallDate) : null,
            install_location: app.InstallLocation || null,
            size_mb: null,
            system_type: 'Windows',
            architecture
          }));
          
          resolve(formattedApps);
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
  }
  
  // Windows注册表备用方法
  static async getWindowsAppsFromRegistry() {
    return new Promise((resolve, reject) => {
      const script = `
        $apps = @()
        $paths = @(
          "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
          "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"
        )
        
        foreach($path in $paths) {
          Get-ItemProperty $path -ErrorAction SilentlyContinue | 
          Where-Object { $_.DisplayName -and $_.SystemComponent -ne 1 } |
          ForEach-Object {
            $apps += [PSCustomObject]@{
              Name = $_.DisplayName
              Version = $_.DisplayVersion
              Publisher = $_.Publisher
              InstallDate = $_.InstallDate
              InstallLocation = $_.InstallLocation
              EstimatedSize = $_.EstimatedSize
            }
          }
        }
        $apps | ConvertTo-Json -Depth 3
      `;
      
      exec(`powershell -Command "${script}"`, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        
        try {
          const apps = JSON.parse(stdout) || [];
          const formattedApps = (Array.isArray(apps) ? apps : [apps]).map(app => ({
            name: app.Name || 'Unknown',
            version: app.Version || 'Unknown',
            publisher: app.Publisher || 'Unknown',
            install_date: app.InstallDate ? this.parseWindowsDate(app.InstallDate) : null,
            install_location: app.InstallLocation || null,
            size_mb: app.EstimatedSize ? (app.EstimatedSize / 1024).toFixed(2) : null
          }));
          
          resolve(formattedApps);
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
  }
  
  // macOS应用程序获取
  static async getMacApps(architecture) {
    return new Promise((resolve, reject) => {
      const script = `
        find /Applications -name "*.app" -maxdepth 2 | while read app; do
          plist="$app/Contents/Info.plist"
          if [ -f "$plist" ]; then
            name=$(basename "$app" .app)
            version=$(defaults read "$plist" CFBundleShortVersionString 2>/dev/null || echo "Unknown")
            bundle_version=$(defaults read "$plist" CFBundleVersion 2>/dev/null || echo "")
            if [ "$version" != "$bundle_version" ] && [ ! -z "$bundle_version" ]; then
              version="$version ($bundle_version)"
            fi
            echo "$name|$version|$app"
          fi
        done
      `;
      
      exec(script, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        
        const apps = stdout.trim().split('\n').filter(line => line).map(line => {
          const [name, version, location] = line.split('|');
          return {
            name: name || 'Unknown',
            version: version || 'Unknown',
            publisher: 'Unknown',
            install_date: null,
            install_location: location || null,
            size_mb: null,
            system_type: 'macOS',
            architecture
          };
        });
        
        resolve(apps);
      });
    });
  }
  
  // Linux应用程序获取
  static async getLinuxApps(architecture) {
    try {
      // 尝试不同的包管理器
      const managers = [
        { cmd: 'dpkg -l', parser: this.parseDpkg },
        { cmd: 'rpm -qa', parser: this.parseRpm },
        { cmd: 'pacman -Q', parser: this.parsePacman }
      ];
      
      for (const manager of managers) {
        try {
          const apps = await this.executeLinuxCommand(manager.cmd, manager.parser, architecture);
          if (apps.length > 0) return apps;
        } catch (error) {
          continue;
        }
      }
      
      return [];
    } catch (error) {
      throw error;
    }
  }
  
  static async executeLinuxCommand(command, parser, architecture) {
    return new Promise((resolve, reject) => {
      exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        
        try {
          const apps = parser(stdout).map(app => ({
            ...app,
            system_type: 'Linux',
            architecture
          }));
          resolve(apps);
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
  }
  
  static parseDpkg(output) {
    return output.split('\n')
      .filter(line => line.startsWith('ii'))
      .map(line => {
        const parts = line.split(/\s+/);
        return {
          name: parts[1] || 'Unknown',
          version: parts[2] || 'Unknown',
          publisher: 'Unknown',
          install_date: null,
          install_location: null,
          size_mb: null
        };
      });
  }
  
  static parseRpm(output) {
    return output.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const match = line.match(/^(.+)-([^-]+)-([^-]+)$/);
        if (match) {
          return {
            name: match[1] || 'Unknown',
            version: `${match[2]}-${match[3]}` || 'Unknown',
            publisher: 'Unknown',
            install_date: null,
            install_location: null,
            size_mb: null
          };
        }
        return {
          name: line || 'Unknown',
          version: 'Unknown',
          publisher: 'Unknown',
          install_date: null,
          install_location: null,
          size_mb: null
        };
      });
  }
  
  static parsePacman(output) {
    return output.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split(' ');
        return {
          name: parts[0] || 'Unknown',
          version: parts[1] || 'Unknown',
          publisher: 'Unknown',
          install_date: null,
          install_location: null,
          size_mb: null
        };
      });
  }
  
  static parseWindowsDate(dateStr) {
    if (!dateStr) return null;
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return `${year}-${month}-${day}`;
  }
}

// API路由
app.get('/api/apps', async (req, res) => {
  try {
    const { search, system, publisher, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    
    let query = 'SELECT * FROM installed_apps WHERE 1=1';
    const values = [];
    let paramCount = 0;
    
    if (search) {
      paramCount++;
      query += ` AND name ILIKE $${paramCount}`;
      values.push(`%${search}%`);
    }
    
    if (system) {
      paramCount++;
      query += ` AND system_type = $${paramCount}`;
      values.push(system);
    }
    
    if (publisher) {
      paramCount++;
      query += ` AND publisher ILIKE $${paramCount}`;
      values.push(`%${publisher}%`);
    }
    
    query += ' ORDER BY name ASC';
    query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    values.push(limit, offset);
    
    const result = await pool.query(query, values);
    
    // 获取总数
    let countQuery = 'SELECT COUNT(*) FROM installed_apps WHERE 1=1';
    const countValues = values.slice(0, -2); // 移除limit和offset
    let countParamCount = 0;
    
    if (search) {
      countParamCount++;
      countQuery += ` AND name ILIKE $${countParamCount}`;
    }
    if (system) {
      countParamCount++;
      countQuery += ` AND system_type = $${countParamCount}`;
    }
    if (publisher) {
      countParamCount++;
      countQuery += ` AND publisher ILIKE $${countParamCount}`;
    }
    
    const countResult = await pool.query(countQuery, countValues);
    
    res.json({
      apps: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      totalPages: Math.ceil(countResult.rows[0].count / limit)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/scan', async (req, res) => {
  try {
    console.log('开始扫描系统应用程序...');
    
    // 清空现有数据
    await pool.query('DELETE FROM installed_apps');
    
    // 获取系统应用程序
    const apps = await SystemAppManager.getInstalledApps();
    
    // 批量插入数据库
    if (apps.length > 0) {
      const values = apps.map(app => [
        app.name,
        app.version,
        app.publisher,
        app.install_date,
        app.install_location,
        app.size_mb,
        app.system_type,
        app.architecture
      ]);
      
      const placeholders = values.map((_, i) => 
        `($${i * 8 + 1}, $${i * 8 + 2}, $${i * 8 + 3}, $${i * 8 + 4}, $${i * 8 + 5}, $${i * 8 + 6}, $${i * 8 + 7}, $${i * 8 + 8})`
      ).join(', ');
      
      const query = `
        INSERT INTO installed_apps 
        (name, version, publisher, install_date, install_location, size_mb, system_type, architecture)
        VALUES ${placeholders}
      `;
      
      await pool.query(query, values.flat());
    }
    
    res.json({ 
      message: '扫描完成', 
      count: apps.length,
      system: os.platform(),
      architecture: os.arch()
    });
  } catch (error) {
    console.error('扫描失败:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/export', async (req, res) => {
  try {
    const { search, system, publisher } = req.query;
    
    let query = 'SELECT * FROM installed_apps WHERE 1=1';
    const values = [];
    let paramCount = 0;
    
    if (search) {
      paramCount++;
      query += ` AND name ILIKE $${paramCount}`;
      values.push(`%${search}%`);
    }
    
    if (system) {
      paramCount++;
      query += ` AND system_type = $${paramCount}`;
      values.push(system);
    }
    
    if (publisher) {
      paramCount++;
      query += ` AND publisher ILIKE $${paramCount}`;
      values.push(`%${publisher}%`);
    }
    
    query += ' ORDER BY name ASC';
    
    const result = await pool.query(query, values);
    
    // 创建Excel工作簿
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('应用程序列表');
    
    // 设置列头
    worksheet.columns = [
      { header: '应用程序名称', key: 'name', width: 30 },
      { header: '版本', key: 'version', width: 15 },
      { header: '发布商', key: 'publisher', width: 20 },
      { header: '安装日期', key: 'install_date', width: 15 },
      { header: '安装位置', key: 'install_location', width: 40 },
      { header: '大小(MB)', key: 'size_mb', width: 12 },
      { header: '系统类型', key: 'system_type', width: 12 },
      { header: '架构', key: 'architecture', width: 12 },
      { header: '创建时间', key: 'created_at', width: 20 }
    ];
    
    // 添加数据
    result.rows.forEach(app => {
      worksheet.addRow({
        name: app.name,
        version: app.version,
        publisher: app.publisher,
        install_date: app.install_date ? app.install_date.toISOString().split('T')[0] : '',
        install_location: app.install_location || '',
        size_mb: app.size_mb || '',
        system_type: app.system_type,
        architecture: app.architecture,
        created_at: app.created_at ? app.created_at.toISOString() : ''
      });
    });
    
    // 设置响应头
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=应用程序列表_${new Date().toISOString().split('T')[0]}.xlsx`);
    
    // 写入响应
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动服务器
async function startServer() {
  await initDatabase();
  app.listen(port, () => {
    console.log(`服务器运行在 http://localhost:${port}`);
    console.log(`操作系统: ${os.platform()} (${os.arch()})`);
  });
}

startServer().catch(console.error);
