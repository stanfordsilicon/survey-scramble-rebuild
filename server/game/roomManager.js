// Core game rules for Emoji Survey Scramble.
//
// This module is deliberately free of any Socket.io / networking knowledge —
// it only reads and writes plain JSON-shaped "room" objects via ./store.js.
// server.js is responsible for wiring these functions to socket events and
// for round timers. Keeping the split this way means the persistence layer
// (store.js) and the transport layer (server.js) can each be swapped out
// independently of the rules below.

const { EMOJI_BOARDS, pointsForRank } = require('../data/emojiData');
const store = require('./store');

const TOTAL_ROUNDS = 3;
const ROUND_SECONDS = 30;
const MAX_PLAYERS = 8;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — avoids look-alike mixups

function normalizeGuess(text) {
  return String(text || '').trim().toLowerCase();
}

function randomRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

async function generateUniqueRoomCode() {
  let code;
  do {
    code = randomRoomCode();
  } while (await store.getRoom(code));
  return code;
}

function pickRoundBoards() {
  const indices = EMOJI_BOARDS.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, TOTAL_ROUNDS).map((boardIndex) => ({
    boardIndex,
    emoji: EMOJI_BOARDS[boardIndex].emoji,
    keywords: EMOJI_BOARDS[boardIndex].keywords,
    revealed: {},
    startedAt: null,
    endsAt: null,
  }));
}

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

async function createRoom(hostId, username) {
  const roomCode = await generateUniqueRoomCode();
  const room = {
    roomCode,
    hostId,
    state: 'lobby', // lobby | playing | roundEnd | final
    players: {
      [hostId]: { id: hostId, username, score: 0, connected: true },
    },
    playerOrder: [hostId],
    totalRounds: TOTAL_ROUNDS,
    roundSeconds: ROUND_SECONDS,
    roundIndex: -1,
    rounds: [],
    createdAt: Date.now(),
  };
  await store.saveRoom(room);
  return room;
}

async function joinRoom(roomCode, playerId, username) {
  const room = await store.getRoom(roomCode);
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
  if (room.state !== 'lobby') throw err('GAME_IN_PROGRESS', 'That game has already started.');
  if (room.playerOrder.length >= MAX_PLAYERS) throw err('ROOM_FULL', 'That room is full.');

  room.players[playerId] = { id: playerId, username, score: 0, connected: true };
  room.playerOrder.push(playerId);
  await store.saveRoom(room);
  return room;
}

async function getRoom(roomCode) {
  return store.getRoom(roomCode);
}

async function startGame(roomCode, requesterId) {
  const room = await store.getRoom(roomCode);
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
  if (room.hostId !== requesterId) throw err('NOT_HOST', 'Only the host can start the game.');
  if (room.state !== 'lobby') throw err('GAME_IN_PROGRESS', 'The game has already started.');
  if (room.playerOrder.length < 1) throw err('NOT_ENOUGH_PLAYERS', 'Need at least one player.');

  room.rounds = pickRoundBoards();
  room.roundIndex = 0;
  room.state = 'playing';
  const round = room.rounds[0];
  round.startedAt = Date.now();
  round.endsAt = round.startedAt + ROUND_SECONDS * 1000;

  await store.saveRoom(room);
  return room;
}

async function submitGuess(roomCode, playerId, guessText) {
  const room = await store.getRoom(roomCode);
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
  if (room.state !== 'playing') throw err('NOT_PLAYING', 'No round is currently active.');
  const player = room.players[playerId];
  if (!player) throw err('NOT_IN_ROOM', 'You are not in this room.');

  const round = room.rounds[room.roundIndex];
  const guess = normalizeGuess(guessText);
  if (!guess) return { result: 'empty' };

  if (round.revealed[guess]) {
    return { result: 'already-revealed', keyword: guess };
  }

  const rankIndex = round.keywords.findIndex((k) => k.toLowerCase() === guess);
  if (rankIndex === -1) {
    return { result: 'no-match' };
  }

  const points = pointsForRank(rankIndex);
  round.revealed[guess] = { rankIndex, revealedBy: player.username, points };
  player.score += points;

  await store.saveRoom(room);
  return {
    result: 'correct',
    keyword: guess,
    rankIndex,
    points,
    scoreTotal: player.score,
    revealedBy: player.username,
  };
}

function buildLeaderboard(room) {
  return room.playerOrder
    .map((id) => room.players[id])
    .filter(Boolean)
    .map((p) => ({ id: p.id, username: p.username, score: p.score, connected: p.connected }))
    .sort((a, b) => b.score - a.score);
}

async function endRound(roomCode) {
  const room = await store.getRoom(roomCode);
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
  if (room.state !== 'playing') return room;

  const isFinalRound = room.roundIndex >= room.totalRounds - 1;
  room.state = isFinalRound ? 'final' : 'roundEnd';
  await store.saveRoom(room);
  return room;
}

async function nextRound(roomCode, requesterId) {
  const room = await store.getRoom(roomCode);
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
  if (room.hostId !== requesterId) throw err('NOT_HOST', 'Only the host can advance the round.');
  if (room.state !== 'roundEnd') throw err('WRONG_STATE', 'The round has not ended yet.');
  if (room.roundIndex >= room.totalRounds - 1) throw err('NO_MORE_ROUNDS', 'That was the final round.');

  room.roundIndex += 1;
  room.state = 'playing';
  const round = room.rounds[room.roundIndex];
  round.startedAt = Date.now();
  round.endsAt = round.startedAt + room.roundSeconds * 1000;

  await store.saveRoom(room);
  return room;
}

async function leaveRoom(roomCode, playerId) {
  const room = await store.getRoom(roomCode);
  if (!room) return null;

  if (room.players[playerId]) {
    room.players[playerId].connected = false;
  }
  room.playerOrder = room.playerOrder.filter((id) => id !== playerId);

  const anyoneLeft = room.playerOrder.some((id) => room.players[id] && room.players[id].connected);
  if (!anyoneLeft) {
    await store.deleteRoom(roomCode);
    return null;
  }

  if (room.hostId === playerId) {
    room.hostId = room.playerOrder.find((id) => room.players[id] && room.players[id].connected) || room.hostId;
  }

  await store.saveRoom(room);
  return room;
}

// Shapes a room for a specific client: strips the current round's answer key
// so players can't read it out of the network payload while it's still live.
function toClientView(room) {
  const currentRound = room.roundIndex >= 0 ? room.rounds[room.roundIndex] : null;
  const roundView = currentRound
    ? {
        roundNumber: room.roundIndex + 1,
        emoji: currentRound.emoji,
        endsAt: currentRound.endsAt,
        revealed: currentRound.revealed,
        ...(room.state !== 'playing' ? { keywords: currentRound.keywords } : {}),
      }
    : null;

  return {
    roomCode: room.roomCode,
    hostId: room.hostId,
    state: room.state,
    totalRounds: room.totalRounds,
    roundSeconds: room.roundSeconds,
    players: buildLeaderboard(room),
    round: roundView,
  };
}

module.exports = {
  TOTAL_ROUNDS,
  ROUND_SECONDS,
  createRoom,
  joinRoom,
  getRoom,
  startGame,
  submitGuess,
  endRound,
  nextRound,
  leaveRoom,
  buildLeaderboard,
  toClientView,
};
