// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Function to read data from the data.json file
const readDataFromFile = () => {
  try {
    const data = fs.readFileSync('data.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading data from file:', error);
    return [];
  }
};

// Function to write data to the data.json file
const writeDataToFile = (data) => {
  try {
    fs.writeFileSync('data.json', JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing data to file:', error);
  }
};

const websites = readDataFromFile();
const downtimeThreshold = 60000; // 1 minute in milliseconds
const emailCooldown = 900000; // 15 minutes in milliseconds

// Object to track downtime duration for each website
const downtimeTimers = {};

wss.on('connection', (ws) => {
  // Send initial website data to the new client
  ws.send(JSON.stringify({ type: 'websites', data: websites }));

  ws.on('message', async (message) => {
    const data = JSON.parse(message);

    if (data.type === 'addWebsite') {
      const { name, url, email } = data.payload;
      const newWebsite = { name, url, email, status: 'Unknown', lastCheck: '' };
      websites.push(newWebsite);

      // Write updated data to the data.json file
      writeDataToFile(websites);

      // Broadcast the updated website list to all clients
      broadcastWebsites();
    } else if (data.type === 'heartbeat') {
      // Check website status based on HTTP status code
      await Promise.all(websites.map(async (website) => {
        try {
          const response = await axios.head(website.url);
          website.lastCheck = new Date().toISOString();
          website.status = response.status;

          // Clear downtime timer if website is now online
          const downtimeTimer = downtimeTimers[website.url];
          if (downtimeTimer && response.status === 200) {
            clearTimeout(downtimeTimer);
            delete downtimeTimers[website.url];
          }

          // If downtime timer doesn't exist and status is not 200, create one
          if (!downtimeTimer && response.status !== 200) {
            downtimeTimers[website.url] = setTimeout(() => {
              // Send email after 1 minute of downtime
              sendEmail(website.email, 'Website is down!', `Your website is down. Status code: ${response.status}`);

              // Wait 15 minutes before sending another email
              setTimeout(() => {
                sendEmail(website.email, 'Website is still down!', `Your website is still down. Status code: ${response.status}`);
              }, emailCooldown);
            }, downtimeThreshold);
          }
        } catch (error) {
          // Handle errors (e.g., network issues)
          console.error(`Error checking ${website.url}: ${error.message}`);
        }
      }));

      // Write updated data to the data.json file
      writeDataToFile(websites);

      // Broadcast the updated website list to all clients
      broadcastWebsites();
    }
  });
});

// Function to broadcast website data to all connected clients
const broadcastWebsites = () => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'websites', data: websites }));
    }
  });
};

// Function to send an email using the provided Easy API endpoint
const sendEmail = async (receiverEmail, subject, emailText) => {
  try {
    const response = await axios.post('https://api.easy-api.online/v1/email-send', {
      receiver: receiverEmail,
      subject: subject,
      text: emailText,
    });

    console.log('Email sent successfully:', response.data);
  } catch (error) {
    console.error('Error sending email:', error.message);
  }
};

// Serve static files (e.g., HTML, CSS)
app.use(express.static('public'));

const PORT = process.env.PORT || 2222;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
