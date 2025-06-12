const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Database configuration without .env
const pool = new Pool({
  connectionString: 'postgresql://postgres:[YOUR-PASSWORD]@db.khyencccqtfemhfpyutp.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
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

// Async error handler
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ===== Scoring Configuration =====

// Get scoring config (system rules)
app.get('/api/scoring-config', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM custom_rules WHERE is_default = true`
  );
  res.json({ success: true, data: result.rows });
}));

// Update scoring config (modify system rule)
app.put('/api/scoring-config', asyncHandler(async (req, res) => {
  const { rule_key, points, is_active } = req.body;
  
  if (!rule_key) {
    return res.status(400).json({ success: false, message: 'rule_key is required' });
  }
  
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
}));

// ===== Rule Management =====

// Get all rules
app.get('/api/rules', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM custom_rules ORDER BY category, rule_name`
  );
  res.json({ success: true, data: result.rows });
}));

// Create new custom rule
app.post('/api/rules', asyncHandler(async (req, res) => {
  const {
    rule_key, rule_name, description, category,
    points, trigger_condition, is_active, manager_auth_id
  } = req.body;
  
  // Validation
  if (!rule_key || !rule_name || !category || points === undefined) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required fields: rule_key, rule_name, category, points' 
    });
  }
  
  try {
    const result = await pool.query(
      `INSERT INTO custom_rules
       (rule_key, rule_name, description, category, points, trigger_condition, is_active, manager_auth_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manager') RETURNING *`,
      [rule_key, rule_name, description, category, points, JSON.stringify(trigger_condition || {}), is_active, manager_auth_id]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      res.status(409).json({ success: false, message: 'Rule key already exists' });
    } else {
      throw error;
    }
  }
}));

// Update rule
app.put('/api/rules/:ruleId', asyncHandler(async (req, res) => {
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
}));

// Delete custom rule
app.delete('/api/rules/:ruleId', asyncHandler(async (req, res) => {
  const { ruleId } = req.params;
  const result = await pool.query(
    `DELETE FROM custom_rules
     WHERE id = $1 AND is_default = false RETURNING *`,
    [ruleId]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ success: false, message: 'Custom rule not found or is system rule' });
  }
  res.json({ success: true, message: 'Rule deleted successfully' });
}));

// Apply custom rule to a driver (FIXED - now actually applies points)
app.post('/api/scoring/custom-rule/:ruleId', asyncHandler(async (req, res) => {
  const { ruleId } = req.params;
  const { driver_id, applied_by } = req.body;
  
  if (!driver_id) {
    return res.status(400).json({ success: false, message: 'driver_id is required' });
  }
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get rule details
    const ruleResult = await client.query(
      'SELECT * FROM custom_rules WHERE id = $1 AND is_active = true',
      [ruleId]
    );
    
    if (ruleResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Rule not found or inactive' });
    }
    
    const rule = ruleResult.rows[0];
    
    // Apply the rule (create application record)
    await client.query(
      `INSERT INTO rule_applications (rule_id, driver_id, applied_by)
       VALUES ($1,$2,$3)
       ON CONFLICT (rule_id,driver_id) DO UPDATE SET is_active=true, applied_at=NOW()`,
      [ruleId, driver_id, applied_by]
    );
    
    // Log the scoring event and update driver score
    const eventResult = await client.query(
      `SELECT log_scoring_event($1,$2,$3,$4,$5,$6,$7,$8) AS event_id`,
      [driver_id, ruleId, rule.category, rule.rule_name, rule.points, 
       JSON.stringify({}), true, applied_by]
    );
    
    await client.query('COMMIT');
    
    // Get the created event
    const event = await pool.query(
      `SELECT * FROM scoring_events WHERE id = $1`, 
      [eventResult.rows[0].event_id]
    );
    
    res.json({ 
      success: true, 
      message: 'Custom rule applied successfully',
      data: {
        rule_applied: rule.rule_name,
        points_awarded: rule.points,
        event: event.rows[0]
      }
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

// ===== Scoring & Driver Operations =====

// Get driver score
app.get('/api/driver/:driverId/score', asyncHandler(async (req, res) => {
  const { driverId } = req.params;
  
  // Get driver score with recent events - UPDATED TABLE NAME
  const scoreResult = await pool.query(
    `SELECT dts.*, d.first_name, d.last_name, d.email
     FROM driver_total_scores dts
     JOIN drivers d ON dts.driver_id = d.driver_id
     WHERE dts.driver_id = $1`,
    [driverId]
  );
  
  if (scoreResult.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Driver score not found' });
  }
  
  // Get recent events
  const eventsResult = await pool.query(
    `SELECT * FROM scoring_events 
     WHERE driver_id = $1 
     ORDER BY timestamp DESC 
     LIMIT 10`,
    [driverId]
  );
  
  res.json({ 
    success: true, 
    data: {
      ...scoreResult.rows[0],
      recent_events: eventsResult.rows
    }
  });
}));

// Get all driver scores - UPDATED TABLE NAME
app.get('/api/drivers/scores', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT d.driver_id, d.first_name, d.last_name, 
            COALESCE(dts.current_score, 0) as current_score,
            COALESCE(dts.events_count, 0) as events_count,
            dts.last_reset, dts.updated_at
     FROM drivers d
     LEFT JOIN driver_total_scores dts ON d.driver_id = dts.driver_id
     ORDER BY dts.current_score DESC NULLS LAST`
  );
  res.json({ success: true, data: result.rows });
}));

// Reset driver score
app.post('/api/driver/:driverId/reset', asyncHandler(async (req, res) => {
  const { driverId } = req.params;
  const { period = 'manual' } = req.body;
  
  // Check if driver exists
  const driverCheck = await pool.query(
    'SELECT driver_id FROM drivers WHERE driver_id = $1',
    [driverId]
  );
  
  if (driverCheck.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Driver not found' });
  }
  
  await pool.query('SELECT reset_driver_score($1,$2)', [driverId, period]);
  res.json({ success: true, message: 'Driver score reset successfully' });
}));

// Get driver leaderboard
app.get('/api/leaderboard', asyncHandler(async (req, res) => {
  const { limit = 50 } = req.query;
  
  const result = await pool.query(
    `SELECT * FROM driver_leaderboard 
     ORDER BY rank ASC 
     LIMIT $1`,
    [limit]
  );
  res.json({ success: true, data: result.rows });
}));

// Generic scoring endpoint (custom events)
app.post('/api/scoring/log', asyncHandler(async (req, res) => {
  const { driver_id, rule_id, category, event_name, points, details, is_custom, applied_by } = req.body;
  
  // Validation
  if (!driver_id || !category || !event_name || points === undefined) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required fields: driver_id, category, event_name, points' 
    });
  }
  
  const idRes = await pool.query(
    `SELECT log_scoring_event($1,$2,$3,$4,$5,$6,$7,$8) AS event_id`,
    [driver_id, rule_id, category, event_name, points, JSON.stringify(details||{}), is_custom, applied_by]
  );
  
  const ev = await pool.query(`SELECT * FROM scoring_events WHERE id = $1`, [idRes.rows[0].event_id]);
  res.status(201).json({ success: true, data: ev.rows[0] });
}));

// Error handler
app.use((err, req, res, next) => {
  console.error('API Error:', err);
  
  // Handle specific database errors
  if (err.code === '23505') {
    return res.status(409).json({ success: false, message: 'Duplicate entry' });
  }
  
  if (err.code === '23503') {
    return res.status(400).json({ success: false, message: 'Referenced record not found' });
  }
  
  if (err.code === '23502') {
    return res.status(400).json({ success: false, message: 'Required field missing' });
  }
  
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// ===== Listen & Routes Logging =====

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('📦 Driver Scoring API running on port', PORT);
  console.log('Available endpoints:');
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

module.exports = app;