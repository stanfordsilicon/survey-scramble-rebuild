const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const rooms = require('./game/roomManager');

const PORT = process.env.PORT || 4333;

const app = express();
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

// Every player plays the same emoji on their own independent board, so the
// room view is tailored per-socket (each player's `round.revealed` only ever
// contains their own guesses) rather than broadcast as one shared payload.
async function emitRoomView(roomCode, eventName) {
  const room = await rooms.getRoom(roomCode);
  if (!room) return;
  const socketsInRoom = await io.in(roomCode).fetchSockets();
  for (const sock of socketsInRoom) {
    sock.emit(eventName, rooms.toClientView(room, sock.id));
  }
}

async function finishRound(roomCode) {
  clearRoundTimer(roomCode);
  const room = await rooms.endRound(roomCode);
  if (!room) return;
  await emitRoomView(roomCode, 'round_ended');
}

io.on('connection', (socket) => {
  socket.on('create_room', async ({ username } = {}, cb) => {
    try {
      const name = String(username || '').trim().slice(0, 20) || `Player${Math.floor(Math.random() * 9999)}`;
      const room = await rooms.createRoom(socket.id, name);
      socket.join(room.roomCode);
      socket.data.roomCode = room.roomCode;
      socket.data.username = name;
      cb && cb({ ok: true, room: rooms.toClientView(room, socket.id) });
      await emitRoomView(room.roomCode, 'room_update');
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('join_room', async ({ username, roomCode } = {}, cb) => {
    try {
      const code = String(roomCode || '').trim().toUpperCase();
      const name = String(username || '').trim().slice(0, 20) || `Player${Math.floor(Math.random() * 9999)}`;
      const room = await rooms.joinRoom(code, socket.id, name);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.username = name;
      cb && cb({ ok: true, room: rooms.toClientView(room, socket.id) });
      await emitRoomView(code, 'room_update');
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('start_game', async (_payload, cb) => {
    try {
      const roomCode = socket.data.roomCode;
      const room = await rooms.startGame(roomCode, socket.id);
      const round = room.rounds[room.roundIndex];
      scheduleRoundEnd(roomCode, round.endsAt);
      cb && cb({ ok: true });
      await emitRoomView(roomCode, 'round_started');
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('submit_guess', async ({ guess } = {}, cb) => {
    try {
      const roomCode = socket.data.roomCode;
      const outcome = await rooms.submitGuess(roomCode, socket.id, guess);
      cb && cb({ ok: true, outcome });
      if (outcome.result === 'correct') {
        // Only the shared scoreboard goes to the rest of the room — the
        // keyword/rank stay on the guesser's own board.
        const room = await rooms.getRoom(roomCode);
        io.to(roomCode).emit('score_update', { players: rooms.buildLeaderboard(room) });
      }
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('next_round', async (_payload, cb) => {
    try {
      const roomCode = socket.data.roomCode;
      const room = await rooms.nextRound(roomCode, socket.id);
      const round = room.rounds[room.roundIndex];
      scheduleRoundEnd(roomCode, round.endsAt);
      cb && cb({ ok: true });
      await emitRoomView(roomCode, 'round_started');
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('leave_room', async (_payload, cb) => {
    await handleLeave(socket);
    cb && cb({ ok: true });
  });

  socket.on('disconnect', async () => {
    await handleLeave(socket);
  });

  async function handleLeave(sock) {
    const roomCode = sock.data.roomCode;
    if (!roomCode) return;
    sock.leave(roomCode);
    const room = await rooms.leaveRoom(roomCode, sock.id);
    sock.data.roomCode = null;
    if (room) {
      await emitRoomView(roomCode, 'room_update');
    } else {
      clearRoundTimer(roomCode);
    }
  }
});

server.listen(PORT, () => {
  console.log(`Emoji Survey Scramble listening on http://localhost:${PORT}`);
});
