const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const rooms = require('./game/roomManager');
const { connectMongo, getDb, recordPlayerResults, getLeaderboard } = require('./data/mongo');
const { arcadeProxy } = require('./arcade-proxy');

const PORT = process.env.PORT || 4333;

// How long a disconnected player's seat stays warm before they're actually
// removed from the room — long enough to survive a page refresh or a closed
// tab right after the final results, without leaving stale seats forever.
const DISCONNECT_GRACE_MS = 5 * 60 * 1000;

const app = express();
app.use(express.json());
app.all('/arcade-api/v1/*', arcadeProxy); // local dev only — see arcade-proxy.js
app.get('/api/leaderboard', async (req, res) => {
  res.json({ leaderboard: await getLeaderboard(20) });
});
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server);

// Timeout handles for auto-ending a round when its clock runs out.
// Kept out of the room document itself since a timer handle can't be
// serialized to a future MongoDB document.
const roundTimers = new Map();

function clearRoundTimer(roomCode) {
  const handle = roundTimers.get(roomCode);
  if (handle) {
    clearTimeout(handle);
    roundTimers.delete(roomCode);
  }
}

function scheduleRoundEnd(roomCode, endsAt) {
  clearRoundTimer(roomCode);
  const delay = Math.max(0, endsAt - Date.now());
  const handle = setTimeout(() => finishRound(roomCode), delay);
  roundTimers.set(roomCode, handle);
}

// Pending "actually remove this player" timers, keyed by `${roomCode}:${playerId}`.
const pendingRemovals = new Map();

function pendingKey(roomCode, playerId) {
  return `${roomCode}:${playerId}`;
}

function clearPendingRemoval(roomCode, playerId) {
  const key = pendingKey(roomCode, playerId);
  const handle = pendingRemovals.get(key);
  if (handle) {
    clearTimeout(handle);
    pendingRemovals.delete(key);
  }
}

function scheduleRemoval(roomCode, playerId) {
  clearPendingRemoval(roomCode, playerId);
  const handle = setTimeout(async () => {
    pendingRemovals.delete(pendingKey(roomCode, playerId));
    try {
      const room = await rooms.leaveRoom(roomCode, playerId);
      if (room) {
        broadcastRoom(roomCode, room);
      } else {
        clearRoundTimer(roomCode);
      }
    } catch (e) {
      console.error('Error removing disconnected player:', e);
    }
  }, DISCONNECT_GRACE_MS);
  pendingRemovals.set(pendingKey(roomCode, playerId), handle);
}

// The board is shared, so every player in the room gets the identical view —
// a single room-wide broadcast is all that's needed.
function broadcastRoom(roomCode, room, eventName = 'room_update') {
  io.to(roomCode).emit(eventName, rooms.toClientView(room));
}

// Best-effort — a slow or unreachable database should never affect
// gameplay, so this is fire-and-forget and swallows its own errors.
async function saveGameSessionAnalytics(room) {
  const db = getDb();
  if (!db) return;
  try {
    const record = rooms.buildGameSessionRecord(room);
    await db.collection('gamesessions').insertOne(record);
    console.log(`[mongo] Saved game session for room ${room.roomCode}`);
    await recordPlayerResults(record.players);
  } catch (e) {
    console.error('[mongo] Failed to save game session:', e.message);
  }
}

async function finishRound(roomCode) {
  clearRoundTimer(roomCode);
  try {
    const room = await rooms.endRound(roomCode);
    if (!room) return;
    broadcastRoom(roomCode, room, 'round_ended');
    if (room.state === 'final') {
      saveGameSessionAnalytics(room);
    }
  } catch (e) {
    console.error('Error ending round:', e);
  }
}

io.on('connection', (socket) => {
  socket.on('create_room', async ({ username, playerId, code } = {}, cb) => {
    try {
      const id = String(playerId || '').trim() || socket.id;
      const name = String(username || '').trim().slice(0, 20) || `Player${Math.floor(Math.random() * 9999)}`;
      const room = await rooms.createRoom(id, name, code);
      socket.join(room.roomCode);
      socket.data.roomCode = room.roomCode;
      socket.data.playerId = id;
      cb && cb({ ok: true, room: rooms.toClientView(room) });
      broadcastRoom(room.roomCode, room);
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('join_room', async ({ username, roomCode, playerId } = {}, cb) => {
    try {
      const code = String(roomCode || '').trim().toUpperCase();
      const id = String(playerId || '').trim() || socket.id;
      const name = String(username || '').trim().slice(0, 20) || `Player${Math.floor(Math.random() * 9999)}`;
      const room = await rooms.joinRoom(code, id, name);
      clearPendingRemoval(code, id);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.playerId = id;
      cb && cb({ ok: true, room: rooms.toClientView(room) });
      broadcastRoom(code, room);
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  // Fired on page load when a device has a saved room/player in localStorage
  // — this is what makes a refresh (or reopening the tab) land back in the
  // same game instead of bouncing to the login screen.
  socket.on('rejoin_room', async ({ roomCode, playerId, username } = {}, cb) => {
    try {
      const code = String(roomCode || '').trim().toUpperCase();
      const id = String(playerId || '').trim();
      if (!id) throw new Error('Missing player id.');
      const room = await rooms.reconnectPlayer(code, id, username);
      clearPendingRemoval(code, id);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.playerId = id;
      cb && cb({ ok: true, room: rooms.toClientView(room) });
      broadcastRoom(code, room);
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('set_ready', async ({ ready } = {}, cb) => {
    try {
      const roomCode = socket.data.roomCode;
      const room = await rooms.setReady(roomCode, socket.data.playerId, !!ready);
      cb && cb({ ok: true });
      broadcastRoom(roomCode, room);
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('start_game', async (_payload, cb) => {
    try {
      const roomCode = socket.data.roomCode;
      const room = await rooms.startGame(roomCode, socket.data.playerId);
      const round = room.rounds[room.roundIndex];
      scheduleRoundEnd(roomCode, round.endsAt);
      cb && cb({ ok: true });
      broadcastRoom(roomCode, room, 'round_started');
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('submit_guess', async ({ guess } = {}, cb) => {
    try {
      const roomCode = socket.data.roomCode;
      const outcome = await rooms.submitGuess(roomCode, socket.data.playerId, guess);
      cb && cb({ ok: true, outcome });
      if (outcome.result === 'correct') {
        // Everyone shares one board — broadcast the reveal so it becomes
        // off-limits on every player's screen, not just the guesser's.
        const room = await rooms.getRoom(roomCode);
        io.to(roomCode).emit('guess_correct', {
          rankIndex: outcome.rankIndex,
          keyword: outcome.keyword,
          points: outcome.points,
          revealedBy: outcome.revealedBy,
          players: rooms.buildLeaderboard(room),
        });
      }
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('next_round', async (_payload, cb) => {
    try {
      const roomCode = socket.data.roomCode;
      const room = await rooms.nextRound(roomCode, socket.data.playerId);
      const round = room.rounds[room.roundIndex];
      scheduleRoundEnd(roomCode, round.endsAt);
      cb && cb({ ok: true });
      broadcastRoom(roomCode, room, 'round_started');
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('play_again', async (_payload, cb) => {
    try {
      const roomCode = socket.data.roomCode;
      const room = await rooms.playAgain(roomCode, socket.data.playerId);
      cb && cb({ ok: true });
      broadcastRoom(roomCode, room);
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('leave_room', async (_payload, cb) => {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (roomCode && playerId) {
      clearPendingRemoval(roomCode, playerId);
      socket.leave(roomCode);
      const room = await rooms.leaveRoom(roomCode, playerId);
      if (room) {
        broadcastRoom(roomCode, room);
      } else {
        clearRoundTimer(roomCode);
      }
    }
    socket.data.roomCode = null;
    socket.data.playerId = null;
    cb && cb({ ok: true });
  });

  // A disconnect (refresh, closed tab, dropped wifi) doesn't immediately
  // evict the player — it just marks them disconnected and starts the grace
  // timer, so a quick rejoin_room picks up exactly where they left off.
  socket.on('disconnect', async () => {
    try {
      const roomCode = socket.data.roomCode;
      const playerId = socket.data.playerId;
      if (!roomCode || !playerId) return;
      const room = await rooms.markDisconnected(roomCode, playerId);
      if (room) broadcastRoom(roomCode, room);
      scheduleRemoval(roomCode, playerId);
    } catch (e) {
      console.error('Error handling disconnect:', e);
    }
  });
});

// Last-resort safety net: a bug in one room's game loop (a bad timer
// callback, an unexpected null) should never take down every other room's
// live game. Log it and keep serving instead of letting Node's default
// crash-the-process behavior for unhandled rejections wipe everyone out.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

connectMongo(); // fire-and-forget — gameplay works fine before/without this resolving

server.listen(PORT, () => {
  console.log(`Emoji Survey Scramble listening on http://localhost:${PORT}`);
});
