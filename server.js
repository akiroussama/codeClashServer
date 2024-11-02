const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors'); // Import the cors package

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(cors()); // Use the cors middleware

// Initialize SQLite database
const db = new sqlite3.Database('data.db'); // Use a file-based database

// Create a table to store file save events
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS file_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fileName TEXT,
    timestamp TEXT
  )`);
});

// Update the database schema to include username and date
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    date TEXT,
    passed INTEGER,
    failed INTEGER,
    environment TEXT,  
    vscodeVersion TEXT,
    platform TEXT
  )`);
});

let clients = [];

// Handle incoming WebSocket connections
wss.on('connection', (ws) => {
  clients.push(ws);
  console.log('New client connected');

  ws.on('close', () => {
    clients = clients.filter(client => client !== ws);
    console.log('Client disconnected');
  });
});

// Endpoint to receive data from the VSCode extension
app.post('/update', (req, res) => {
  const { fileName, timestamp } = req.body;
  console.log('Data received:', req.body);

  // Insert the data into the database
  db.run(`INSERT INTO file_events (fileName, timestamp) VALUES (?, ?)`, [fileName, timestamp], function(err) {
    if (err) {
      return console.error('Error inserting data:', err.message);
    }
    console.log(`A row has been inserted with rowid ${this.lastID}`);
  });

  // Broadcast the data to all connected WebSocket clients
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(req.body));
    }
  });

  res.sendStatus(200);
});

// Update the /test-results endpoint
app.post('/test-results', (req, res) => {
  const { data: { username, date, passed, failed }, timestamp, environment, vscodeVersion, platform } = req.body;
  console.log(`Received test results from ${username} on ${date}: ${passed} passed, ${failed} failed at ${timestamp}`);
  console.log(`Environment: ${environment}, VSCode Version: ${vscodeVersion}, Platform: ${platform}`);

  // Insert the test results into the database with additional metadata
  db.run(`INSERT INTO test_results (username, date, passed, failed, environment, vscodeVersion, platform) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
    [username, date, passed, failed, environment, vscodeVersion, platform], function(err) {
    if (err) {
      return console.error('Error inserting test results:', err.message);
    }
    console.log(`Test results inserted with rowid ${this.lastID}`);
  });

  res.send({ message: 'Results received' });
});

// New endpoint to fetch all file events
app.get('/events', (req, res) => {
  db.all(`SELECT * FROM file_events`, [], (err, rows) => {
    if (err) {
      res.status(500).send(err.message);
      return;
    }
    res.json(rows);
  });
});

// New endpoint to fetch the latest test result for each user
app.get('/latest-test-results', (req, res) => {
  const query = `
    SELECT username, date, passed, failed, environment, vscodeVersion, platform
    FROM test_results
    WHERE id IN (
      SELECT MAX(id)
      FROM test_results
      GROUP BY username
    )
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).send(err.message);
      return;
    }
    res.json(rows);
  });
});

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});