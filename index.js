// index.js
// Entry point for the RobinBlast backend server

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.get("/", (req, res) => {
  res.json({ status: "RobinBlast backend is running" });
});

// In-memory storage for rooms
const rooms = {};

function createRoom(roomId, roomType, entryFee) {
  return {
    id: roomId,
    type: roomType,
    entryFee: entryFee,
    players: [],           // { socketId, walletAddress, alive }
    status: "waiting",     // "waiting" | "playing" | "finished"
    waitingTimer: null,
    bombHolderId: null,    // socketId of whoever currently has the bomb
    explodeTimer: null,
  };
}

// Called 60 seconds after the first player joins a waiting room
function handleWaitingTimeout(roomId) {
  const room = rooms[roomId];
  if (!room || room.status !== "waiting") return;

  if (room.players.length < 2) {
    console.log(`Room ${roomId} did not fill up — refunding players`);
    io.to(room.id).emit("room_refunded", { roomId: room.id });
    delete rooms[roomId];
  } else {
    startGame(room);
  }
}

// Kicks off the actual bomb game once a room has enough players
function startGame(room) {
  room.status = "playing";
  room.players.forEach((p) => (p.alive = true));

  io.to(room.id).emit("game_start", {
    roomId: room.id,
    players: room.players,
  });

  assignBombToRandomPlayer(room);
}

// Picks a random living player to hold the bomb, and starts a hidden countdown
function assignBombToRandomPlayer(room) {
  const alivePlayers = room.players.filter((p) => p.alive);
  const chosen = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
  room.bombHolderId = chosen.socketId;

  // Tell everyone who holds the bomb now — but NOT when it will explode.
  // The explosion timing is only known to the server.
  io.to(room.id).emit("bomb_assigned", {
    roomId: room.id,
    bombHolderId: chosen.socketId,
  });

  // Random explosion delay between 15 and 45 seconds
  const delay = (Math.floor(Math.random() * 30) + 15) * 1000;

  clearTimeout(room.explodeTimer);
  room.explodeTimer = setTimeout(() => {
    explodeBomb(room);
  }, delay);
}

// Called when the hidden timer runs out — whoever holds the bomb is eliminated
function explodeBomb(room) {
  const victim = room.players.find((p) => p.socketId === room.bombHolderId);
  if (!victim) return;

  victim.alive = false;

  const survivors = room.players.filter((p) => p.alive);

  io.to(room.id).emit("bomb_exploded", {
    roomId: room.id,
    eliminatedId: victim.socketId,
    survivorsRemaining: survivors.length,
  });

  if (survivors.length <= 1) {
    finishGame(room, survivors[0] || null);
  } else {
    // Continue the game with the remaining players
    assignBombToRandomPlayer(room);
  }
}

// Called when only one player (or zero) remains
function finishGame(room, winner) {
  room.status = "finished";

  io.to(room.id).emit("game_finished", {
    roomId: room.id,
    winnerId: winner ? winner.socketId : null,
    winnerWallet: winner ? winner.walletAddress : null,
  });

  console.log(
    `Room ${room.id} finished. Winner: ${winner ? winner.walletAddress : "none"}`
  );

  // Clean up — this room's job is done
  clearTimeout(room.explodeTimer);
  delete rooms[room.id];
}

io.on("connection", (socket) => {
  console.log("A player connected:", socket.id);

  socket.on("join_room", ({ roomType, walletAddress }) => {
    let room = Object.values(rooms).find(
      (r) => r.type === roomType && r.status === "waiting"
    );

    if (!room) {
      const roomId = `${roomType}-${Date.now()}`;
      const entryFee = roomType === "MICRO" ? 0.005 : 0.01;
      room = createRoom(roomId, roomType, entryFee);
      rooms[roomId] = room;
    }

    room.players.push({ socketId: socket.id, walletAddress, alive: true });
    socket.join(room.id);

    console.log(`Player ${socket.id} joined room ${room.id} (${room.players.length} players)`);

    io.to(room.id).emit("room_update", {
      roomId: room.id,
      players: room.players,
      status: room.status,
    });

    if (room.players.length === 1) {
      room.waitingTimer = setTimeout(() => {
        handleWaitingTimeout(room.id);
      }, 60 * 1000);
    }
  });

  // Player taps another player to pass the bomb to them
  socket.on("pass_bomb", ({ roomId, targetSocketId }) => {
    const room = rooms[roomId];
    if (!room || room.status !== "playing") return;

    // Only the current bomb holder is allowed to pass it
    if (room.bombHolderId !== socket.id) return;

    const target = room.players.find(
      (p) => p.socketId === targetSocketId && p.alive
    );
    if (!target) return;

    room.bombHolderId = target.socketId;

    io.to(room.id).emit("bomb_passed", {
      roomId: room.id,
      fromId: socket.id,
      toId: target.socketId,
    });
    // Note: the explosion timer keeps running in the background —
    // passing the bomb does NOT reset or extend it.
  });

  socket.on("disconnect", () => {
    console.log("A player disconnected:", socket.id);
    // TODO: handle a player disconnecting mid-game
  });
});

const PORT = process.env.PORT || 3003;
server.listen(PORT, () => {
  console.log(`RobinBlast backend listening on port ${PORT}`);
});0
