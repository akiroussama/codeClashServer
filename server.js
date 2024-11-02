const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

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
  const data = req.body;
  console.log('Data received:', data);

  // Broadcast the data to all connected WebSocket clients
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });

  res.sendStatus(200);
});

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});