// index.js
// Entry point for the RobinBlast backend server

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

// Create the Express app (handles regular HTTP requests)
const app = express();
app.use(cors());
app.use(express.json());

// Create an HTTP server that wraps the Express app
// Socket.io needs this raw HTTP server to attach itself to
const server = http.createServer(app);

// Create the Socket.io server (handles realtime/WebSocket connections)
const io = new Server(server, {
  cors: {
    origin: "*", // we'll restrict this to your actual frontend domain later
  },
});

// Simple test route — just to confirm the server is alive
app.get("/", (req, res) => {
  res.json({ status: "RobinBlast backend is running" });
});

// This runs every time a player's browser connects via Socket.io
io.on("connection", (socket) => {
  console.log("A player connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("A player disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3003;
server.listen(PORT, () => {
  console.log(`RobinBlast backend listening on port ${PORT}`);
});0
