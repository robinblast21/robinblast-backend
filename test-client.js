// test-client.js
// A simple script that simulates two players joining and playing a round.
// This lets us verify the game logic works before building the real frontend.

const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3003";

function createTestPlayer(name, walletAddress) {
  const socket = io(SERVER_URL);

  socket.on("connect", () => {
    console.log(`[${name}] Connected as ${socket.id}`);
    socket.emit("join_room", { roomType: "MICRO", walletAddress });
  });

  socket.on("room_update", (data) => {
    console.log(`[${name}] Room update — ${data.players.length} player(s) in room ${data.roomId}`);
  });

  socket.on("game_start", (data) => {
    console.log(`[${name}] Game started! Players:`, data.players.map((p) => p.walletAddress));
  });

  socket.on("bomb_assigned", (data) => {
    const holder = data.bombHolderId === socket.id ? "ME" : data.bombHolderId;
    console.log(`[${name}] Bomb assigned to: ${holder}`);

    // If I'm holding the bomb, pass it to the other player after 2 seconds
    if (data.bombHolderId === socket.id) {
      setTimeout(() => {
        socket.emit("pass_bomb", {
          roomId: data.roomId,
          targetSocketId: otherPlayerId,
        });
        console.log(`[${name}] Passed the bomb!`);
      }, 2000);
    }
  });

  socket.on("bomb_passed", (data) => {
    const holder = data.toId === socket.id ? "ME" : data.toId;
    console.log(`[${name}] Bomb passed to: ${holder}`);
  });

  socket.on("bomb_exploded", (data) => {
    const who = data.eliminatedId === socket.id ? "ME" : data.eliminatedId;
    console.log(`[${name}] BOOM! Eliminated: ${who} — ${data.survivorsRemaining} survivor(s) left`);
  });

  socket.on("game_finished", (data) => {
    const isWinner = data.winnerId === socket.id;
    console.log(`[${name}] Game finished! Winner: ${data.winnerWallet} ${isWinner ? "(THAT'S ME!)" : ""}`);
    process.exit(0);
  });

  return socket;
}

// We need each player to know the other's socket ID to test pass_bomb.
// For this simple test, we grab it from the room_update event.
let otherPlayerId = null;

const player1 = createTestPlayer("Player1", "0xAAA...111");
const player2 = createTestPlayer("Player2", "0xBBB...222");

// Capture each other's socket ID once both have joined
player1.on("room_update", (data) => {
  const other = data.players.find((p) => p.socketId !== player1.id);
  if (other) otherPlayerId = other.socketId;
});
player2.on("room_update", (data) => {
  const other = data.players.find((p) => p.socketId !== player2.id);
  if (other) otherPlayerId = other.socketId;
});0
