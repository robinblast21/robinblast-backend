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
  cors: { origin: "*" },
});

app.get("/", (req, res) => {
  res.json({ status: "RobinBlast backend is running" });
});

const rooms = {};
const GRACE_PERIOD_MS = 30 * 1000;

function createRoom(roomId, roomType, entryFee) {
  return {
    id: roomId,
    type: roomType,
    entryFee: entryFee,
    players: [],
    status: "waiting",
    waitingTimer: null,
    bombHolderId: null,
    explodeTimer: null,
  };
}

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

function startGame(room) {
  room.status = "playing";
  room.players.forEach((p) => (p.alive = true));
  io.to(room.id).emit("game_start", { roomId: room.id, players: room.players });
  assignBombToRandomPlayer(room);
}

function assignBombToRandomPlayer(room) {
  const alivePlayers = room.players.filter((p) => p.alive);
  if (alivePlayers.length === 0) return;

  const chosen = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
  room.bombHolderId = chosen.socketId;

  io.to(room.id).emit("bomb_assigned", {
    roomId: room.id,
    bombHolderId: chosen.socketId,
  });

  const delay = (Math.floor(Math.random() * 30) + 15) * 1000;
  clearTimeout(room.explodeTimer);
  room.explodeTimer = setTimeout(() => {
    explodeBomb(room);
  }, delay);
}

function explodeBomb(room) {
  const victim = room.players.find((p) => p.socketId === room.bombHolderId);
  if (!victim) return;
  eliminatePlayer(room, victim, "exploded");
}

function eliminatePlayer(room, player, reason) {
  player.alive = false;
  const survivors = room.players.filter((p) => p.alive);

  io.to(room.id).emit("bomb_exploded", {
    roomId: room.id,
    eliminatedId: player.socketId,
    reason,
    survivorsRemaining: survivors.length,
  });

  if (survivors.length <= 1) {
    finishGame(room, survivors[0] || null);
  } else if (room.bombHolderId === player.socketId) {
    assignBombToRandomPlayer(room);
  }
}

function finishGame(room, winner) {
  room.status = "finished";
  io.to(room.id).emit("game_finished", {
    roomId: room.id,
    winnerId: winner ? winner.socketId : null,
    winnerWallet: winner ? winner.walletAddress : null,
  });
  console.log(`Room ${room.id} finished. Winner: ${winner ? winner.walletAddress : "none"}`);
  clearTimeout(room.explodeTimer);
  delete rooms[room.id];
}

function findPlayerRoom(socketId) {
  for (const room of Object.values(rooms)) {
    const player = room.players.find((p) => p.socketId === socketId);
    if (player) return { room, player };
  }
  return null;
}io.on("connection", (socket) => {
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

    room.players.push({
      socketId: socket.id,
      walletAddress,
      alive: true,
      connected: true,
      disconnectTimer: null,
    });
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

  socket.on("rejoin_room", ({ roomId, oldSocketId }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("rejoin_failed", { reason: "Room no longer exists" });
      return;
    }

    const player = room.players.find((p) => p.socketId === oldSocketId);
    if (!player) {
      socket.emit("rejoin_failed", { reason: "Player not found in room" });
      return;
    }

    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
    player.connected = true;

    if (room.bombHolderId === oldSocketId) {
      room.bombHolderId = socket.id;
    }
    player.socketId = socket.id;
    socket.join(room.id);

    console.log(`Player reconnected to room ${room.id}`);

    io.to(room.id).emit("room_update", {
      roomId: room.id,
      players: room.players,
      status: room.status,
    });
    socket.emit("rejoin_success", { roomId: room.id, status: room.status });
  });

  socket.on("pass_bomb", ({ roomId, targetSocketId }) => {
    const room = rooms[roomId];
    if (!room || room.status !== "playing") return;
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
  });

  socket.on("disconnect", () => {
    console.log("A player disconnected:", socket.id);

    const found = findPlayerRoom(socket.id);
    if (!found) return;

    const { room, player } = found;
    player.connected = false;

    if (room.status === "waiting") {
      room.players = room.players.filter((p) => p.socketId !== socket.id);
      io.to(room.id).emit("room_update", {
        roomId: room.id,
        players: room.players,
        status: room.status,
      });
      return;
    }

    if (room.status === "playing" && room.bombHolderId === socket.id) {
      const alivePlayers = room.players.filter(
        (p) => p.alive && p.socketId !== socket.id
      );
      if (alivePlayers.length > 0) {
        assignBombToRandomPlayer(room);
      }
    }

    player.disconnectTimer = setTimeout(() => {
      if (!player.connected && player.alive) {
        console.log(`Player ${socket.id} did not reconnect in time — forfeiting`);
        eliminatePlayer(room, player, "forfeit");
      }
    }, GRACE_PERIOD_MS);
  });
});

const PORT = process.env.PORT || 3003;
server.listen(PORT, () => {
  console.log(`RobinBlast backend listening on port ${PORT}`);
});0
