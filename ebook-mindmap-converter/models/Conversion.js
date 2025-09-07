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

  // 获取所有转换记录
  static async findAll(options = {}) {
    let query = 'SELECT * FROM conversions';
    const values = [];
    let paramCount = 1;

    const conditions = [];
    
    if (options.status) {
      conditions.push(`status = $${paramCount}`);
      values.push(options.status);
      paramCount++;
    }

    if (options.model_used) {
      conditions.push(`model_used = $${paramCount}`);
      values.push(options.model_used);
      paramCount++;
    }

    if (options.start_date) {
      conditions.push(`created_at >= $${paramCount}`);
      values.push(options.start_date);
      paramCount++;
    }

    if (options.end_date) {
      conditions.push(`created_at <= $${paramCount}`);
      values.push(options.end_date);
      paramCount++;
    }

    if (options.keyword) {
      conditions.push(`(original_filename ILIKE $${paramCount} OR summary ILIKE $${paramCount})`);
      values.push(`%${options.keyword}%`);
      paramCount++;
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';

    if (options.limit) {
      query += ` LIMIT $${paramCount}`;
      values.push(options.limit);
    }

    try {
      const result = await pool.query(query, values);
      return result.rows.map(row => new Conversion(row));
    } catch (error) {
      throw new Error(`获取转换记录失败: ${error.message}`);
    }
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
}

module.exports = Conversion;
