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

// Assigned to players in join order so each one gets a stable badge color
// that never shifts when the leaderboard re-sorts by score.
const PLAYER_COLORS = ['#FF5C8A', '#4B3F72', '#35B06D', '#FFD166', '#3AA6FF', '#FF8C42', '#9B5DE5', '#00BBF9'];

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
    // Shared across the whole room — once any player reveals a keyword it's
    // off-limits for everyone else, so this is keyed by keyword, not player.
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

function makePlayer(id, username, colorIndex) {
  return {
    id,
    username,
    score: 0,
    connected: true,
    ready: false,
    color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
  };
}

async function createRoom(hostId, username) {
  const roomCode = await generateUniqueRoomCode();
  const room = {
    roomCode,
    hostId,
    state: 'lobby', // lobby | playing | roundEnd | final
    players: {
      [hostId]: makePlayer(hostId, username, 0),
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

  room.players[playerId] = makePlayer(playerId, username, room.playerOrder.length);
  room.playerOrder.push(playerId);
  await store.saveRoom(room);
  return room;
}

async function getRoom(roomCode) {
  return store.getRoom(roomCode);
}

async function setReady(roomCode, playerId, ready) {
  const room = await store.getRoom(roomCode);
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
  if (room.state !== 'lobby') throw err('GAME_IN_PROGRESS', 'That game has already started.');
  const player = room.players[playerId];
  if (!player) throw err('NOT_IN_ROOM', 'You are not in this room.');

  player.ready = !!ready;
  await store.saveRoom(room);
  return room;
}

async function startGame(roomCode, requesterId) {
  const room = await store.getRoom(roomCode);
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
  if (room.hostId !== requesterId) throw err('NOT_HOST', 'Only the host can start the game.');
  if (room.state !== 'lobby') throw err('GAME_IN_PROGRESS', 'The game has already started.');
  if (room.playerOrder.length < 1) throw err('NOT_ENOUGH_PLAYERS', 'Need at least one player.');
  const allReady = room.playerOrder.every((id) => room.players[id] && room.players[id].ready);
  if (!allReady) throw err('NOT_ALL_READY', 'Everyone needs to be ready before starting.');

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

  const existing = round.revealed[guess];
  if (existing) {
    return { result: 'already-revealed', keyword: guess, revealedBy: existing.revealedBy };
  }

  const rankIndex = round.keywords.findIndex((k) => k.toLowerCase() === guess);
  if (rankIndex === -1) {
    return { result: 'no-match' };
  }

  const points = pointsForRank(rankIndex);
  const revealedBy = { id: player.id, username: player.username, color: player.color };
  round.revealed[guess] = { rankIndex, points, revealedBy };
  player.score += points;

  await store.saveRoom(room);
  return {
    result: 'correct',
    keyword: guess,
    rankIndex,
    points,
    scoreTotal: player.score,
    revealedBy,
  };
}

function buildLeaderboard(room) {
  return room.playerOrder
    .map((id) => room.players[id])
    .filter(Boolean)
    .map((p) => ({ id: p.id, username: p.username, score: p.score, connected: p.connected, ready: p.ready, color: p.color }))
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

// Shapes a room for the wire. The board is shared, so every player in the
// room receives the identical view — only the current round's answer key is
// withheld while it's still live, so it can't be read out of the payload.
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
  setReady,
  startGame,
  submitGuess,
  endRound,
  nextRound,
  leaveRoom,
  buildLeaderboard,
  toClientView,
};
