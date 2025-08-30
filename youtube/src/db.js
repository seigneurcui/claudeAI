const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

async function insertUploadRecord(videoFile, status, progress = 0, youtubeId = null, error = null) {
  const query = `
    INSERT INTO uploads (video_file, status, progress, youtube_id, error_message)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id;
  `;
  const values = [videoFile, status, progress, youtubeId, error];
  const res = await pool.query(query, values);
  return res.rows[0].id;
}

async function updateUploadRecord(id, status, progress, youtubeId = null, error = null) {
  const query = `
    UPDATE uploads
    SET status = $1, progress = $2, youtube_id = $3, error_message = $4
    WHERE id = $5;
  `;
  const values = [status, progress, youtubeId, error, id];
  await pool.query(query, values);
}

module.exports = { insertUploadRecord, updateUploadRecord };
