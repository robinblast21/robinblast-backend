// blockchain.js
// Handles all interaction with the RobinBlast smart contract

const { ethers } = require("ethers");
require("dotenv").config();

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const CONTRACT_ABI = [
  "function joinRoom(bytes32 roomId, uint256 entryFee) external payable",
  "function refundRoom(bytes32 roomId) external",
  "function settleRound(bytes32 roomId, address winner) external",
  "function getRoomInfo(bytes32 roomId) external view returns (uint8 status, uint256 entryFee, uint256 playerCount)",
];

const contract = new ethers.Contract(
  process.env.CONTRACT_ADDRESS,
  CONTRACT_ABI,
  wallet
);

// Converts a room's string ID (like "MICRO-12345") into the bytes32
// format the smart contract expects
function roomIdToBytes32(roomId) {
  return ethers.id(roomId);
}

// Called by the backend when a room needs refunding
async function refundRoomOnChain(roomId) {
  const bytes32Id = roomIdToBytes32(roomId);
  const tx = await contract.refundRoom(bytes32Id);
  console.log(`Refund tx sent for room ${roomId}: ${tx.hash}`);
  await tx.wait();
  console.log(`Refund confirmed for room ${roomId}`);
  return tx.hash;
}

// Called by the backend when a round has a winner
async function settleRoundOnChain(roomId, winnerAddress) {
  const bytes32Id = roomIdToBytes32(roomId);
  const tx = await contract.settleRound(bytes32Id, winnerAddress);
  console.log(`Settle tx sent for room ${roomId}: ${tx.hash}`);
  await tx.wait();
  console.log(`Settlement confirmed for room ${roomId}`);
  return tx.hash;
}

module.exports = {
  roomIdToBytes32,
  refundRoomOnChain,
  settleRoundOnChain,
};
