const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Default scoring configuration (can be modified by managers)
let scoringConfig = {
  gpsMonitoring: {
    speedWithinLimit: 2,
    speedExceedingBy30: -10,
    smoothAcceleration: 1,
    severeAcceleration: -4
  },
  driverMonitoring: {
    fallingAsleep: -10,
    mobilePhoneUse: -3,
    maintainingFocus: 2,
    unauthorizedDriver: -15
  },
  safetyEmergency: {
    properEmergencyResponse: 5,
    atFaultAccident: -15,
    collisionAvoidance: 8,
    ignoringFatigueAlerts: -8
  },
  compliance: {
    preTrip: 3,
    expiredLicense: -15,
    cleanRecord: 5,
    duiDwi: -30
  },
  achievements: {
    oneYearAccidentFree: 30,
    bestFuelEconomy: 15,
    safetyChampion: 10
  },
  customRules: {}, // Manager-created custom rules
  basePoints: 0
};

// Rule metadata for better management
let ruleMetadata = {
  gpsMonitoring: {
    speedWithinLimit: {
      name: "Speed within 5% of limit",
      description: "Driver maintains speed within acceptable range",
      category: "GPS Monitoring",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    },
    speedExceedingBy30: {
      name: "Exceeding limit by 30+ mph",
      description: "Driver significantly exceeds speed limit",
      category: "GPS Monitoring",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    },
    smoothAcceleration: {
      name: "Smooth acceleration/braking",
      description: "Driver demonstrates smooth driving technique",
      category: "GPS Monitoring",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    },
    severeAcceleration: {
      name: "Severe braking/acceleration",
      description: "Driver exhibits harsh driving behavior",
      category: "GPS Monitoring",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    }
  },
  driverMonitoring: {
    fallingAsleep: {
      name: "Falling asleep while driving",
      description: "Driver fatigue detected",
      category: "Driver Monitoring",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    },
    mobilePhoneUse: {
      name: "Mobile phone use",
      description: "Driver using phone while driving",
      category: "Driver Monitoring",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    },
    maintainingFocus: {
      name: "Maintaining focus entire trip",
      description: "Driver stays focused throughout journey",
      category: "Driver Monitoring",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    },
    unauthorizedDriver: {
      name: "Unauthorized driver",
      description: "Unauthorized person operating vehicle",
      category: "Driver Monitoring",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    }
  },
  safetyEmergency: {
    properEmergencyResponse: {
      name: "Proper emergency response",
      description: "Driver handles emergency situation correctly",
      category: "Safety & Emergency",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    },
    atFaultAccident: {
      name: "At-fault accident",
      description: "Driver causes accident",
      category: "Safety & Emergency",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    },
    collisionAvoidance: {
      name: "Collision avoidance",
      description: "Driver successfully avoids potential collision",
      category: "Safety & Emergency",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    },
    ignoringFatigueAlerts: {
      name: "Ignoring fatigue alerts",
      description: "Driver ignores fatigue warning systems",
      category: "Safety & Emergency",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    }
  },
  compliance: {
    preTrip: {
      name: "Pre-trip vehicle inspection",
      description: "Driver completes required pre-trip inspection",
      category: "Compliance",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    },
    expiredLicense: {
      name: "Expired license operation",
      description: "Driver operates with expired license",
      category: "Compliance",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    },
    cleanRecord: {
      name: "Clean record for 6 months",
      description: "Driver maintains clean driving record",
      category: "Compliance",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    },
    duiDwi: {
      name: "DUI/DWI offense",
      description: "Driver convicted of impaired driving",
      category: "Compliance",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    }
  },
  achievements: {
    oneYearAccidentFree: {
      name: "1 year accident-free",
      description: "Driver completes one year without accidents",
      category: "Achievement",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    },
    bestFuelEconomy: {
      name: "Best fuel economy (month)",
      description: "Driver achieves best fuel efficiency for the month",
      category: "Achievement",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    },
    safetyChampion: {
      name: "Safety Champion (30 days)",
      description: "Driver recognized for exemplary safety record",
      category: "Achievement",
      isDefault: true,
      createdBy: "system",
      createdAt: new Date()
    }
  },
  customRules: {}
};

// In-memory storage for driver scores (use database in production)
let driverScores = {};

// Helper function to initialize driver score
function initializeDriver(driverId) {
  if (!driverScores[driverId]) {
    driverScores[driverId] = {
      driverId,
      currentScore: scoringConfig.basePoints, // Starts at 0
      lastReset: new Date(),
      scoreHistory: [],
      events: []
    };
  }
  return driverScores[driverId];
}

// Helper function to log scoring event
function logScoringEvent(driverId, category, event, points, details = {}) {
  const driver = initializeDriver(driverId);
  const eventLog = {
    timestamp: new Date(),
    category,
    event,
    points,
    details,
    scoreAfter: driver.currentScore + points
  };
  
  driver.events.push(eventLog);
  driver.currentScore += points;
  
  // Keep only last 100 events per driver
  if (driver.events.length > 100) {
    driver.events = driver.events.slice(-100);
  }
  
  return eventLog;
}

// Routes

// Get current scoring configuration
app.get('/api/scoring-config', (req, res) => {
  res.json(scoringConfig);
});

// Update scoring configuration (manager only)
app.put('/api/scoring-config', (req, res) => {
  try {
    const newConfig = req.body;
    // Validate configuration structure
    if (newConfig.gpsMonitoring && newConfig.driverMonitoring && 
        newConfig.safetyEmergency && newConfig.compliance && 
        newConfig.achievements && newConfig.basePoints) {
      scoringConfig = { ...scoringConfig, ...newConfig };
      res.json({ success: true, message: 'Scoring configuration updated', config: scoringConfig });
    } else {
      res.status(400).json({ success: false, message: 'Invalid configuration structure' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating configuration', error: error.message });
  }
});

// Get driver score
app.get('/api/driver/:driverId/score', (req, res) => {
  const { driverId } = req.params;
  const driver = initializeDriver(driverId);
  res.json(driver);
});

// Get all drivers scores
app.get('/api/drivers/scores', (req, res) => {
  res.json(Object.values(driverScores));
});

// Reset driver score (monthly/quarterly)
app.post('/api/driver/:driverId/reset', (req, res) => {
  const { driverId } = req.params;
  const driver = initializeDriver(driverId);
  
  // Archive current score
  driver.scoreHistory.push({
    period: `${new Date().getFullYear()}-${new Date().getMonth() + 1}`,
    finalScore: driver.currentScore,
    endDate: new Date(),
    eventsCount: driver.events.length
  });
  
  // Reset score
  driver.currentScore = scoringConfig.basePoints; // Reset to 0
  driver.lastReset = new Date();
  driver.events = [];
  
  res.json({ success: true, message: 'Driver score reset', driver });
});

// GPS Monitoring Events
app.post('/api/scoring/gps/speed-within-limit', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.gpsMonitoring.speedWithinLimit;
  const event = logScoringEvent(driverId, 'GPS Monitoring', 'Speed within 5% of limit', points, details);
  res.json({ success: true, event });
});

app.post('/api/scoring/gps/speed-exceeding', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.gpsMonitoring.speedExceedingBy30;
  const event = logScoringEvent(driverId, 'GPS Monitoring', 'Exceeding limit by 30+ mph', points, details);
  res.json({ success: true, event });
});

app.post('/api/scoring/gps/smooth-acceleration', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.gpsMonitoring.smoothAcceleration;
  const event = logScoringEvent(driverId, 'GPS Monitoring', 'Smooth acceleration/braking', points, details);
  res.json({ success: true, event });
});

app.post('/api/scoring/gps/severe-acceleration', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.gpsMonitoring.severeAcceleration;
  const event = logScoringEvent(driverId, 'GPS Monitoring', 'Severe braking/acceleration', points, details);
  res.json({ success: true, event });
});

// Driver Monitoring Events
app.post('/api/scoring/driver/falling-asleep', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.driverMonitoring.fallingAsleep;
  const event = logScoringEvent(driverId, 'Driver Monitoring', 'Falling asleep while driving', points, details);
  res.json({ success: true, event });
});

app.post('/api/scoring/driver/mobile-phone', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.driverMonitoring.mobilePhoneUse;
  const event = logScoringEvent(driverId, 'Driver Monitoring', 'Mobile phone use', points, details);
  res.json({ success: true, event });
});

app.post('/api/scoring/driver/maintaining-focus', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.driverMonitoring.maintainingFocus;
  const event = logScoringEvent(driverId, 'Driver Monitoring', 'Maintaining focus entire trip', points, details);
  res.json({ success: true, event });
});

app.post('/api/scoring/driver/unauthorized', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.driverMonitoring.unauthorizedDriver;
  const event = logScoringEvent(driverId, 'Driver Monitoring', 'Unauthorized driver', points, details);
  res.json({ success: true, event });
});

// Safety & Emergency Events
app.post('/api/scoring/safety/emergency-response', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.safetyEmergency.properEmergencyResponse;
  const event = logScoringEvent(driverId, 'Safety & Emergency', 'Proper emergency response', points, details);
  res.json({ success: true, event });
});

app.post('/api/scoring/safety/accident', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.safetyEmergency.atFaultAccident;
  const event = logScoringEvent(driverId, 'Safety & Emergency', 'At-fault accident', points, details);
  res.json({ success: true, event });
});

app.post('/api/scoring/safety/collision-avoidance', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.safetyEmergency.collisionAvoidance;
  const event = logScoringEvent(driverId, 'Safety & Emergency', 'Collision avoidance', points, details);
  res.json({ success: true, event });
});

app.post('/api/scoring/safety/fatigue-alerts', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.safetyEmergency.ignoringFatigueAlerts;
  const event = logScoringEvent(driverId, 'Safety & Emergency', 'Ignoring fatigue alerts', points, details);
  res.json({ success: true, event });
});

// Compliance Events
app.post('/api/scoring/compliance/pre-trip', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.compliance.preTrip;
  const event = logScoringEvent(driverId, 'Compliance', 'Pre-trip vehicle inspection', points, details);
  res.json({ success: true, event });
});

app.post('/api/scoring/compliance/expired-license', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.compliance.expiredLicense;
  const event = logScoringEvent(driverId, 'Compliance', 'Expired license operation', points, details);
  res.json({ success: true, event });
});

app.post('/api/scoring/compliance/clean-record', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.compliance.cleanRecord;
  const event = logScoringEvent(driverId, 'Compliance', 'Clean record for 6 months', points, details);
  res.json({ success: true, event });
});

app.post('/api/scoring/compliance/dui-dwi', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.compliance.duiDwi;
  const event = logScoringEvent(driverId, 'Compliance', 'DUI/DWI offense', points, details);
  res.json({ success: true, event });
});

// Achievement Bonuses
app.post('/api/scoring/achievement/accident-free', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.achievements.oneYearAccidentFree;
  const event = logScoringEvent(driverId, 'Achievement', '1 year accident-free', points, details);
  res.json({ success: true, event });
});

app.post('/api/scoring/achievement/fuel-economy', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.achievements.bestFuelEconomy;
  const event = logScoringEvent(driverId, 'Achievement', 'Best fuel economy (month)', points, details);
  res.json({ success: true, event });
});

app.post('/api/scoring/achievement/safety-champion', (req, res) => {
  const { driverId, details } = req.body;
  const points = scoringConfig.achievements.safetyChampion;
  const event = logScoringEvent(driverId, 'Achievement', 'Safety Champion (30 days)', points, details);
  res.json({ success: true, event });
});

// Generic scoring endpoint for custom events
app.post('/api/scoring/custom', (req, res) => {
  const { driverId, category, event, points, details } = req.body;
  
  if (!driverId || !category || !event || points === undefined) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required fields: driverId, category, event, points' 
    });
  }
  
  const scoringEvent = logScoringEvent(driverId, category, event, points, details);
  res.json({ success: true, event: scoringEvent });
});

// Get driver leaderboard
app.get('/api/leaderboard', (req, res) => {
  const leaderboard = Object.values(driverScores)
    .sort((a, b) => b.currentScore - a.currentScore)
    .map((driver, index) => ({
      rank: index + 1,
      driverId: driver.driverId,
      currentScore: driver.currentScore,
      lastReset: driver.lastReset,
      eventsCount: driver.events.length
    }));
  
  res.json(leaderboard);
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Endpoint not found' 
  });
});

app.listen(PORT, () => {
  console.log(`Fleet Driver Scoring API running on port ${PORT}`);
  console.log(`Base URL: http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET  /api/scoring-config - Get scoring configuration');
  console.log('  PUT  /api/scoring-config - Update scoring configuration');
  console.log('  GET  /api/rules - Get all rules with metadata');
  console.log('  POST /api/rules - Create new custom rule');
  console.log('  PUT  /api/rules/:ruleId - Update existing rule');
  console.log('  DELETE /api/rules/:ruleId - Delete custom rule');
  console.log('  POST /api/scoring/custom-rule/:ruleId - Apply custom rule to driver');
  console.log('  GET  /api/driver/:driverId/score - Get driver score');
  console.log('  GET  /api/drivers/scores - Get all driver scores');
  console.log('  POST /api/driver/:driverId/reset - Reset driver score');
  console.log('  GET  /api/leaderboard - Get driver leaderboard');
  console.log('  POST /api/scoring/* - Various scoring endpoints');
});
module.exports = app;