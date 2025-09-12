const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Conversion {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.filename = data.filename;
    this.original_filename = data.original_filename;
    this.file_type = data.file_type;
    this.file_size = data.file_size;
    this.model_used = data.model_used;
    this.status = data.status || 'pending';
    this.progress = data.progress || 0;
    this.mindmap_data = data.mindmap_data;
    this.summary = data.summary;
    this.created_at = data.created_at || new Date();
    this.updated_at = data.updated_at || new Date();
    this.processing_time = data.processing_time;
    this.error_message = data.error_message;
  }

  // 创建转换记录
  static async create(conversionData) {
    const query = `
      INSERT INTO conversions (
        id, filename, original_filename, file_type, file_size, 
        model_used, status, progress, mindmap_data, summary, 
        created_at, updated_at, processing_time, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
    
    const values = [
      conversionData.id,
      conversionData.filename,
      conversionData.original_filename,
      conversionData.file_type,
      conversionData.file_size,
      conversionData.model_used,
      conversionData.status,
      conversionData.progress,
      conversionData.mindmap_data,
      conversionData.summary,
      conversionData.created_at,
      conversionData.updated_at,
      conversionData.processing_time,
      conversionData.error_message
    ];

    try {
      const result = await pool.query(query, values);
      return new Conversion(result.rows[0]);
    } catch (error) {
      throw new Error(`创建转换记录失败: ${error.message}`);
    }
  }

  // 根据ID获取转换记录
  static async findById(id) {
    const query = 'SELECT * FROM conversions WHERE id = $1';
    try {
      const result = await pool.query(query, [id]);
      return result.rows.length > 0 ? new Conversion(result.rows[0]) : null;
    } catch (error) {
      throw new Error(`获取转换记录失败: ${error.message}`);
    }
  }

  // 别名方法，兼容 Sequelize 风格
  static async findByPk(id) {
    return this.findById(id);
  }

  // 更新转换记录
  async update(updateData) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        fields.push(`${key} = $${paramCount}`);
        values.push(updateData[key]);
        paramCount++;
      }
    });

    if (fields.length === 0) return this;

    fields.push(`updated_at = $${paramCount}`);
    values.push(new Date());
    values.push(this.id);

    const query = `
      UPDATE conversions 
      SET ${fields.join(', ')} 
      WHERE id = $${paramCount + 1}
      RETURNING *
    `;

    try {
      const result = await pool.query(query, values);
      Object.assign(this, result.rows[0]);
      return this;
    } catch (error) {
      throw new Error(`更新转换记录失败: ${error.message}`);
    }
  }

  // 获取所有转换记录 - 增强版本，支持 Sequelize 风格的选项
  static async findAll(options = {}) {
    let query = 'SELECT * FROM conversions';
    const values = [];
    let paramCount = 1;
    const conditions = [];
    
    // 处理 where 条件（Sequelize 风格）
    if (options.where) {
      Object.keys(options.where).forEach(key => {
        const value = options.where[key];
        
        if (typeof value === 'object' && value !== null) {
          // 处理操作符，如 Op.iLike, Op.between
          if (value.$iLike || value.iLike) {
            conditions.push(`${key} ILIKE $${paramCount}`);
            values.push(value.$iLike || value.iLike);
            paramCount++;
          } else if (value.$between || value.between) {
            const betweenValues = value.$between || value.between;
            conditions.push(`${key} BETWEEN $${paramCount} AND $${paramCount + 1}`);
            values.push(betweenValues[0], betweenValues[1]);
            paramCount += 2;
          } else if (value.$like || value.like) {
            conditions.push(`${key} LIKE $${paramCount}`);
            values.push(value.$like || value.like);
            paramCount++;
          }
        } else {
          // 简单的相等比较
          conditions.push(`${key} = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      });
    }

    // 兼容旧的直接选项
    if (options.status && !options.where?.status) {
      conditions.push(`status = $${paramCount}`);
      values.push(options.status);
      paramCount++;
    }

    if (options.model_used && !options.where?.model_used) {
      conditions.push(`model_used = $${paramCount}`);
      values.push(options.model_used);
      paramCount++;
    }

    if (options.start_date && !options.where?.created_at) {
      conditions.push(`created_at >= $${paramCount}`);
      values.push(options.start_date);
      paramCount++;
    }

    if (options.end_date && !options.where?.created_at) {
      conditions.push(`created_at <= $${paramCount}`);
      values.push(options.end_date);
      paramCount++;
    }

// if (options.keyword) {
 //     conditions.push(`(original_filename ILIKE $${paramCount} OR summary ILIKE $${paramCount})`);
  //    values.push(`%${options.keyword}%`);
   //   paramCount++;
   // }

    if (options.keyword && !options.where?.original_filename) {
      // 扩展搜索范围：文件名、摘要、思维导图数据
      conditions.push(`(
        original_filename ILIKE ${paramCount} OR 
        summary ILIKE ${paramCount} OR 
        mindmap_data::text ILIKE ${paramCount}
      )`);
      values.push(`%${options.keyword}%`);
      paramCount++;
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    // 处理排序
    if (options.order && Array.isArray(options.order)) {
      const orderClauses = options.order.map(orderItem => {
        if (Array.isArray(orderItem) && orderItem.length >= 2) {
          return `${orderItem[0]} ${orderItem[1]}`;
        }
        return orderItem;
      });
      query += ` ORDER BY ${orderClauses.join(', ')}`;
    } else {
      query += ' ORDER BY created_at DESC';
    }

    // 处理分页
    if (options.offset) {
      query += ` OFFSET $${paramCount}`;
      values.push(options.offset);
      paramCount++;
    }

    if (options.limit) {
      query += ` LIMIT $${paramCount}`;
      values.push(options.limit);
      paramCount++;
    }

    try {
      const result = await pool.query(query, values);
      return result.rows.map(row => new Conversion(row));
    } catch (error) {
      throw new Error(`获取转换记录失败: ${error.message}`);
    }
  }

  // 计数方法 - 新增
  static async count(options = {}) {
    let query = 'SELECT COUNT(*) as count FROM conversions';
    const values = [];
    let paramCount = 1;
    const conditions = [];
    
    // 处理 where 条件
    if (options.where) {
      Object.keys(options.where).forEach(key => {
        const value = options.where[key];
        
        if (typeof value === 'object' && value !== null) {
          if (value.$iLike || value.iLike) {
            conditions.push(`${key} ILIKE $${paramCount}`);
            values.push(value.$iLike || value.iLike);
            paramCount++;
          } else if (value.$between || value.between) {
            const betweenValues = value.$between || value.between;
            conditions.push(`${key} BETWEEN $${paramCount} AND $${paramCount + 1}`);
            values.push(betweenValues[0], betweenValues[1]);
            paramCount += 2;
          } else if (value.$like || value.like) {
            conditions.push(`${key} LIKE $${paramCount}`);
            values.push(value.$like || value.like);
            paramCount++;
          }
        } else {
          conditions.push(`${key} = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      });
    }

    // 兼容旧的直接选项
    if (options.status && !options.where?.status) {
      conditions.push(`status = $${paramCount}`);
      values.push(options.status);
      paramCount++;
    }

    if (options.model_used && !options.where?.model_used) {
      conditions.push(`model_used = $${paramCount}`);
      values.push(options.model_used);
      paramCount++;
    }

    if (options.start_date && !options.where?.created_at) {
      conditions.push(`created_at >= $${paramCount}`);
      values.push(options.start_date);
      paramCount++;
    }

    if (options.end_date && !options.where?.created_at) {
      conditions.push(`created_at <= $${paramCount}`);
      values.push(options.end_date);
      paramCount++;
    }

    if (options.keyword && !options.where?.original_filename) {
      conditions.push(`(original_filename ILIKE $${paramCount} OR summary ILIKE $${paramCount})`);
      values.push(`%${options.keyword}%`);
      paramCount++;
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    try {
      const result = await pool.query(query, values);
      return parseInt(result.rows[0].count);
    } catch (error) {
      throw new Error(`计数查询失败: ${error.message}`);
    }
  }

  // findAndCountAll 方法 - 新增
  static async findAndCountAll(options = {}) {
    const count = await this.count(options);
    const rows = await this.findAll(options);
    
    return {
      count: count,
      rows: rows
    };
  }

  // 查找单条记录
  static async findOne(options = {}) {
    const results = await this.findAll({ ...options, limit: 1 });
    return results.length > 0 ? results[0] : null;
  }

  // 删除转换记录
  async delete() {
    const query = 'DELETE FROM conversions WHERE id = $1';
    try {
      await pool.query(query, [this.id]);
      return true;
    } catch (error) {
      throw new Error(`删除转换记录失败: ${error.message}`);
    }
  }

  // 别名方法，兼容 Sequelize 风格
  async destroy() {
    return this.delete();
  }

  // 静态删除方法
  static async destroy(options = {}) {
    let query = 'DELETE FROM conversions';
    const values = [];
    let paramCount = 1;
    const conditions = [];
    
    if (options.where) {
      Object.keys(options.where).forEach(key => {
        const value = options.where[key];
        conditions.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      });
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    try {
      const result = await pool.query(query, values);
      return result.rowCount;
    } catch (error) {
      throw new Error(`批量删除失败: ${error.message}`);
    }
  }
}

module.exports = Conversion;
