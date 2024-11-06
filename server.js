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

  // Validate required fields
  if (!user || !projectInfo || !testStatus || testStatus.total === 0) {
    console.log('Invalid test status update - missing required fields or zero total tests');
    res.status(400).send({ error: 'Missing required fields or zero total tests' });
    return;
  }

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

// New endpoint to fetch latest test results grouped by user
app.get('/latest-test-results-by-user', (req, res) => {
  console.log('Fetching latest test results by user');
  
  // Subquery to get the latest timestamp for each user
  const query = `
    WITH LatestUserUpdates AS (
      SELECT user, MAX(timestamp) as max_timestamp
      FROM test_status_updates
      GROUP BY user
    )
    SELECT t.*
    FROM test_status_updates t
    INNER JOIN LatestUserUpdates l
      ON t.user = l.user AND t.timestamp = l.max_timestamp
    ORDER BY t.timestamp DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Error fetching latest test results by user:', err.message);
      res.status(500).send({ error: 'Failed to fetch latest test results by user' });
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

    console.log(`Returning latest test results for ${formattedRows.length} users`);
    res.json(formattedRows);
  });
});

app.get('/filtered-test-results', (req, res) => {
  const { username, date, totalTests, failed, passed } = req.query;
  console.log('Fetching filtered test results:', { username, date, totalTests, failed, passed });

  let query = `
    WITH LatestUserUpdates AS (
      SELECT user, MAX(timestamp) as max_timestamp
      FROM test_status_updates
      WHERE user IS NOT NULL 
      AND timestamp IS NOT NULL
      AND test_status IS NOT NULL
      AND project_info IS NOT NULL
      AND git_info IS NOT NULL
      AND test_runner_info IS NOT NULL
      AND environment IS NOT NULL
      AND execution IS NOT NULL
  `;
  const params = [];

  if (username) {
    query += ' AND user = ?';
    params.push(username);
  }

  if (date) {
    query += ' AND DATE(timestamp) = DATE(?)';
    params.push(date);
  }

  query += `
      GROUP BY user
    )
    SELECT t.*
    FROM test_status_updates t
    INNER JOIN LatestUserUpdates l
      ON t.user = l.user AND t.timestamp = l.max_timestamp
    WHERE t.user IS NOT NULL 
    AND t.timestamp IS NOT NULL
    AND t.test_status IS NOT NULL
    AND t.project_info IS NOT NULL
    AND t.git_info IS NOT NULL
    AND t.test_runner_info IS NOT NULL
    AND t.environment IS NOT NULL
    AND t.execution IS NOT NULL
    ORDER BY t.timestamp DESC
  `;

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching filtered test results:', err.message);
      res.status(500).send({ error: 'Failed to fetch filtered test results' });
      return;
    }

    let filteredRows = rows.map(row => {
      // Only include rows where JSON parsing succeeds and values exist
      try {
        const test_status = JSON.parse(row.test_status);
        const project_info = JSON.parse(row.project_info);
        const git_info = JSON.parse(row.git_info);
        const test_runner_info = JSON.parse(row.test_runner_info);
        const environment = JSON.parse(row.environment);
        const execution = JSON.parse(row.execution);

        // Check if parsed objects have required properties
        if (!test_status || !project_info || !git_info || 
            !test_runner_info || !environment || !execution) {
          return null;
        }

        return {
          ...row,
          test_status,
          project_info,
          git_info,
          test_runner_info,
          environment,
          execution
        };
      } catch (e) {
        return null;
      }
    }).filter(row => row !== null); // Remove any null entries

    // Additional filtering based on test counts
    if (totalTests) {
      filteredRows = filteredRows.filter(row => 
        row.test_status.totalTests === parseInt(totalTests));
    }
    if (failed) {
      filteredRows = filteredRows.filter(row => 
        row.test_status.failed === parseInt(failed));
    }
    if (passed) {
      filteredRows = filteredRows.filter(row => 
        row.test_status.passed === parseInt(passed));
    }

    if (filteredRows.length === 0) {
      return res.status(404).json({ 
        message: 'No results found matching the specified criteria.',
        parameters: { username, date, totalTests, failed, passed }
      });
    }

    console.log(`Returning ${filteredRows.length} filtered test results`);
    res.json(filteredRows);
  });
});

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});