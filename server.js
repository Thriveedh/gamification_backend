require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ===== Scoring Configuration =====

// Get scoring config (system rules)
app.get('/api/scoring-config', async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM custom_rules WHERE is_default = true`
  );
  res.json({ success: true, data: result.rows });
});

// Update scoring config (modify system rule)
app.put('/api/scoring-config', async (req, res) => {
  const { rule_key, points, is_active } = req.body;
  const result = await pool.query(
    `UPDATE custom_rules
     SET points = COALESCE($2, points),
         is_active = COALESCE($3, is_active),
         updated_at = NOW()
     WHERE rule_key = $1 AND is_default = true
     RETURNING *`,
    [rule_key, points, is_active]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ success: false, message: 'System rule not found' });
  }
  res.json({ success: true, data: result.rows[0] });
});

// ===== Rule Management =====

// Get all rules
app.get('/api/rules', async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM custom_rules ORDER BY category, rule_name`
  );
  res.json({ success: true, data: result.rows });
});

// Create new custom rule
app.post('/api/rules', async (req, res) => {
  const {
    rule_key, rule_name, description, category,
    points, trigger_condition, is_active, manager_auth_id
  } = req.body;
  const result = await pool.query(
    `INSERT INTO custom_rules
     (rule_key, rule_name, description, category, points, trigger_condition, is_active, manager_auth_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manager') RETURNING *`,
    [rule_key, rule_name, description, category, points, JSON.stringify(trigger_condition || {}), is_active, manager_auth_id]
  );
  res.status(201).json({ success: true, data: result.rows[0] });
});

// Update rule
app.put('/api/rules/:ruleId', async (req, res) => {
  const { ruleId } = req.params;
  const { rule_name, description, category, points, trigger_condition, is_active } = req.body;

  const result = await pool.query(
    `UPDATE custom_rules
     SET rule_name = COALESCE($2, rule_name),
         description = COALESCE($3, description),
         category = COALESCE($4, category),
         points = COALESCE($5, points),
         trigger_condition = COALESCE($6, trigger_condition),
         is_active = COALESCE($7, is_active),
         updated_at = NOW()
     WHERE id = $1 AND is_default = false
     RETURNING *`,
    [ruleId, rule_name, description, category, points, trigger_condition ? JSON.stringify(trigger_condition) : null, is_active]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ success: false, message: 'Custom rule not found or is system rule' });
  }
  res.json({ success: true, data: result.rows[0] });
});

// Delete custom rule
app.delete('/api/rules/:ruleId', async (req, res) => {
  const { ruleId } = req.params;
  const result = await pool.query(
    `DELETE FROM custom_rules
     WHERE id = $1 AND is_default = false RETURNING *`,
    [ruleId]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ success: false, message: 'Custom rule not found or is system rule' });
  }
  res.json({ success: true });
});

// Apply custom rule to a driver
app.post('/api/scoring/custom-rule/:ruleId', async (req, res) => {
  const { ruleId } = req.params;
  const { driver_id, applied_by } = req.body;
  const result = await pool.query(
    `INSERT INTO rule_applications (rule_id, driver_id, applied_by)
     VALUES ($1,$2,$3)
     ON CONFLICT (rule_id,driver_id) DO UPDATE SET is_active=true, applied_at=NOW()
     RETURNING *`,
    [ruleId, driver_id, applied_by]
  );
  res.json({ success: true, data: result.rows[0] });
});

// ===== Scoring & Driver Operations =====

// Get driver score
app.get('/api/driver/:driverId/score', async (req, res) => {
  const { driverId } = req.params;
  const result = await pool.query(
    `SELECT * FROM driver_scores WHERE driver_id = $1`,
    [driverId]
  );
  res.json({ success: true, data: result.rows[0] || null });
});

// Get all driver scores
app.get('/api/drivers/scores', async (req, res) => {
  const result = await pool.query(
    `SELECT d.driver_id, d.first_name, d.last_name, ds.current_score
     FROM drivers d
     JOIN driver_scores ds ON d.driver_id = ds.driver_id`
  );
  res.json({ success: true, data: result.rows });
});

// Reset driver score
app.post('/api/driver/:driverId/reset', async (req, res) => {
  const { driverId } = req.params;
  const { period } = req.body; // optional
  await pool.query('SELECT reset_driver_score($1,$2)', [driverId, period]);
  res.json({ success: true, message: 'Driver score reset' });
});

// Get driver leaderboard
app.get('/api/leaderboard', async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM driver_leaderboard ORDER BY rank ASC`
  );
  res.json({ success: true, data: result.rows });
});

// Generic scoring endpoint (custom events)
app.post('/api/scoring/log', async (req, res) => {
  const { driver_id, rule_id, category, event_name, points, details, is_custom, applied_by } = req.body;
  const idRes = await pool.query(
    `SELECT log_scoring_event($1,$2,$3,$4,$5,$6,$7,$8) AS event_id`,
    [driver_id, rule_id, category, event_name, points, JSON.stringify(details||{}), is_custom, applied_by]
  );
  const ev = await pool.query(`SELECT * FROM scoring_events WHERE id = $1`, [idRes.rows[0].event_id]);
  res.status(201).json({ success: true, data: ev.rows[0] });
});

// ===== Listen & Routes Logging =====

app.listen(process.env.PORT || 3000, () => {
  console.log('📦 Driver Scoring API running');
  console.log('  GET  /api/scoring-config');
  console.log('  PUT  /api/scoring-config');
  console.log('  GET  /api/rules');
  console.log('  POST /api/rules');
  console.log('  PUT  /api/rules/:ruleId');
  console.log('  DELETE /api/rules/:ruleId');
  console.log('  POST /api/scoring/custom-rule/:ruleId');
  console.log('  GET  /api/driver/:driverId/score');
  console.log('  GET  /api/drivers/scores');
  console.log('  POST /api/driver/:driverId/reset');
  console.log('  GET  /api/leaderboard');
  console.log('  POST /api/scoring/log');
});
