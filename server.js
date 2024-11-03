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

// Create a table to store test status updates
db.serialize(() => {
  db.run(`DROP TABLE IF EXISTS test_status_updates`);
  db.run(`CREATE TABLE IF NOT EXISTS test_status_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT,
    timestamp TEXT,
    test_status JSON,
    project_info JSON,
    git_info JSON,
    test_runner_info JSON,
    environment JSON,
    execution JSON
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
app.post('/test-results', (req, res) => {
  const { passed, failed } = req.body;
  // Store the results in a database or process them as needed
  console.log(`Received test results: ${passed} passed, ${failed} failed`);
  res.send({ message: 'Results received' });
});

app.get('/test-results', (req, res) => {
  console.log("Fetching test results");
  console.log(req.body);
  db.all(`SELECT * FROM test_status_updates`, [], (err, rows) => {
    console.log("rows",rows);
    if (err) {
      res.status(500).send(err.message);
      return;
    }
    res.json(rows);
  });
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

// New endpoint to receive test status updates
app.post('/test-status', (req, res) => {
  const {
    user,
    timestamp,
    testStatus,
    projectInfo,
    gitInfo,
    testRunnerInfo,
    environment,
    execution
  } = req.body;

  console.log(`Received test status update from ${user} at ${timestamp}`);

  // Store the complex objects as JSON strings
  db.run(
    `INSERT INTO test_status_updates (
      user,
      timestamp,
      test_status,
      project_info,
      git_info,
      test_runner_info,
      environment,
      execution
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user,
      timestamp,
      JSON.stringify(testStatus),
      JSON.stringify(projectInfo),
      JSON.stringify(gitInfo),
      JSON.stringify(testRunnerInfo),
      JSON.stringify(environment),
      JSON.stringify(execution)
    ],
    function(err) {
      if (err) {
        console.error('Error inserting test status update:', err.message);
        res.status(500).send({ error: 'Failed to store test status update' });
        return;
      }
      console.log(`Test status update inserted with rowid ${this.lastID}`);
      res.send({ message: 'Test status update received', id: this.lastID });
    }
  );
});

// New endpoint to get all test status updates
app.get('/test-status', (req, res) => {
  console.log('Fetching all test status updates');
  db.all(`SELECT * FROM test_status_updates ORDER BY timestamp DESC`, [], (err, rows) => {
    if (err) {
      console.error('Error fetching test status updates:', err.message);
      res.status(500).send({ error: 'Failed to fetch test status updates' });
      return;
    }
    
    // Parse the JSON strings back to objects
    const formattedRows = rows.map(row => ({
      ...row,
      test_status: JSON.parse(row.test_status),
      project_info: JSON.parse(row.project_info),
      git_info: JSON.parse(row.git_info),
      test_runner_info: JSON.parse(row.test_runner_info),
      environment: JSON.parse(row.environment),
      execution: JSON.parse(row.execution)
    }));

    console.log(`Returning ${formattedRows.length} test status updates`);
    res.json(formattedRows);
  });
});

// New endpoint to fetch all test status updates
app.get('/latest-test-results', (req, res) => {
  console.log('Fetching latest test results');
  db.all(`SELECT * FROM test_status_updates ORDER BY timestamp DESC LIMIT 1`, [], (err, rows) => {
    console.log("rows",rows);
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