// Express app for Moji Mojo.
//
// This used to be a Socket.IO server holding a persistent WebSocket per
// player, with room state in server/game/store.js's in-memory Map and round
// timers as live setTimeout handles. None of that survives on a serverless
// host (Vercel): no persistent process, no long-lived sockets, and no shared
// memory between invocations. So this is now plain HTTP actions + polling:
// every route below reads/writes a room by (roomCode, playerId) in the body
// or query string, and server/game/roomManager.js resolves time-driven state
// (round timeouts, stale disconnects) lazily on every room load instead of
// via a background timer. See roomManager.js's top-of-file comment and
// applyLazyStateUpdates for the mechanism.
//
// Exported (no .listen() here) so both the local dev entrypoint
// (server/server.js) and the Vercel serverless entrypoint (api/index.js)
// can reuse the identical app.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const rooms = require('./game/roomManager');
const { connectMongo, getDb, recordPlayerResults, getLeaderboard, clearLeaderboard } = require('./data/mongo');
const { arcadeProxy } = require('./arcade-proxy');
const phaseFilter = require('./data/phaseFilter');

const app = express();
app.use(express.json());
app.all('/arcade-api/v1/*', arcadeProxy); // local dev only — see arcade-proxy.js

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
    await rooms.markAnalyticsSaved(room.roomCode);
  } catch (e) {
    console.error('[mongo] Failed to save game session:', e.message);
  }
}

// A round finishing used to be the one moment finishRound() fired the
// analytics save, driven by a live timer. Now that transition can happen
// lazily inside *any* route that loads the room, so every route that gets a
// room back checks for it here — guarded by room.analyticsSaved so it only
// actually writes once even if several routes/polls race right at the end.
function maybeSaveAnalytics(room) {
  if (room && room.state === 'final' && !room.analyticsSaved) {
    saveGameSessionAnalytics(room);
  }
}

function normId(value) {
  return String(value || '').trim();
}

function normCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normName(value) {
  return String(value || '').trim().slice(0, 20) || `Player${Math.floor(Math.random() * 9999)}`;
}

app.post('/api/create-room', async (req, res) => {
  try {
    const { username, playerId, code, language, uiLang } = req.body || {};
    const id = normId(playerId);
    if (!id) return res.json({ ok: false, error: 'Missing player id.' });
    const room = await rooms.createRoom(
      id,
      normName(username),
      code,
      typeof language === 'string' ? language : undefined,
      typeof uiLang === 'string' ? uiLang : undefined
    );
    maybeSaveAnalytics(room);
    res.json({ ok: true, room: rooms.toClientView(room) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/join-room', async (req, res) => {
  try {
    const { username, roomCode, playerId } = req.body || {};
    const id = normId(playerId);
    if (!id) return res.json({ ok: false, error: 'Missing player id.' });
    const room = await rooms.joinRoom(normCode(roomCode), id, normName(username));
    maybeSaveAnalytics(room);
    res.json({ ok: true, room: rooms.toClientView(room) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Called on page load when a device has a saved room/player in
// sessionStorage — this is what makes a refresh (or reopening the tab) land
// back in the same game instead of bouncing to the login screen.
app.post('/api/rejoin-room', async (req, res) => {
  try {
    const { roomCode, playerId, username } = req.body || {};
    const id = normId(playerId);
    if (!id) return res.json({ ok: false, error: 'Missing player id.' });
    const room = await rooms.reconnectPlayer(normCode(roomCode), id, username);
    maybeSaveAnalytics(room);
    res.json({ ok: true, room: rooms.toClientView(room) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/set-ready', async (req, res) => {
  try {
    const { roomCode, playerId, ready } = req.body || {};
    const room = await rooms.setReady(normCode(roomCode), normId(playerId), !!ready);
    maybeSaveAnalytics(room);
    res.json({ ok: true, room: rooms.toClientView(room) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/start-game', async (req, res) => {
  try {
    const { roomCode, playerId } = req.body || {};
    const code = normCode(roomCode);
    // Bounded wait (see phaseFilter.js's ensureFresh) before the boards for
    // this room's actual rounds get picked -- create-room can't pre-warm
    // this itself, since Moji Mojo doesn't pick round boards until the game
    // actually starts (getBoardsForLanguage isn't called until here). A cold
    // serverless instance's fire-and-forget background fetch has no
    // guarantee of finishing before this specific request needs it.
    const existing = await rooms.getRoom(code);
    if (existing) await phaseFilter.ensureFresh(existing.language || 'en');
    const room = await rooms.startGame(code, normId(playerId));
    maybeSaveAnalytics(room);
    res.json({ ok: true, room: rooms.toClientView(room) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/submit-guess', async (req, res) => {
  try {
    const { roomCode, playerId, guess } = req.body || {};
    const outcome = await rooms.submitGuess(normCode(roomCode), normId(playerId), guess);
    res.json({ ok: true, outcome });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/next-round', async (req, res) => {
  try {
    const { roomCode, playerId } = req.body || {};
    const room = await rooms.nextRound(normCode(roomCode), normId(playerId));
    maybeSaveAnalytics(room);
    res.json({ ok: true, room: rooms.toClientView(room) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/play-again', async (req, res) => {
  try {
    const { roomCode, playerId } = req.body || {};
    const room = await rooms.playAgain(normCode(roomCode), normId(playerId));
    maybeSaveAnalytics(room);
    res.json({ ok: true, room: rooms.toClientView(room) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/leave-room', async (req, res) => {
  try {
    const { roomCode, playerId } = req.body || {};
    await rooms.leaveRoom(normCode(roomCode), normId(playerId));
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Host-only, lobby-only — see roomManager.kickPlayer for why kicking is
// restricted to before the game starts.
app.post('/api/kick-player', async (req, res) => {
  try {
    const { roomCode, playerId, targetId } = req.body || {};
    const room = await rooms.kickPlayer(normCode(roomCode), normId(playerId), normId(targetId));
    res.json({ ok: true, room: rooms.toClientView(room) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Host-only. Unlike kick-player, this works at any room state.
app.post('/api/transfer-host', async (req, res) => {
  try {
    const { roomCode, playerId, targetId } = req.body || {};
    const room = await rooms.transferHost(normCode(roomCode), normId(playerId), normId(targetId));
    res.json({ ok: true, room: rooms.toClientView(room) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Sent every few seconds by a connected client — there's no persistent
// socket left to notice a disconnect, so presence is tracked this way
// instead (see roomManager's applyLazyStateUpdates for how staleness is
// actually detected).
app.post('/api/heartbeat', async (req, res) => {
  try {
    const { roomCode, playerId } = req.body || {};
    await rooms.heartbeat(normCode(roomCode), normId(playerId));
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  res.json({ leaderboard: await getLeaderboard(20) });
});

// crypto.timingSafeEqual throws on length mismatch, so pad both sides to
// the same length first -- a length-revealing early return would leak the
// secret's length one comparison at a time. Mirrors emoji-munchers'
// identical helper.
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  const len = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(len);
  const paddedB = Buffer.alloc(len);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return crypto.timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

// Admin-only, server-to-server: qmoji-2's own /api/admin/clear-leaderboard
// route is the only intended caller -- it authenticates the human admin
// itself (a real qmoji-2 admin session token) and then relays here with
// this shared secret, so the secret never reaches a browser.
app.post('/api/admin/clear-leaderboard', async (req, res) => {
  const expected = process.env.QMOJI_ADMIN_SECRET;
  const given = req.get('x-qmoji-admin-secret') || '';
  if (!expected || !timingSafeStringEqual(given, expected)) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  try {
    await clearLeaderboard();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Polling endpoint — replaces the old room_update/round_started/round_ended/
// guess_correct socket broadcasts. Every response is the full authoritative
// room snapshot, same as those broadcasts always were.
app.get('/api/room', async (req, res) => {
  try {
    const code = normCode(req.query.code);
    if (!code) return res.status(400).json({ ok: false, error: 'Missing room code.' });
    const room = await rooms.getRoom(code);
    if (!room) return res.json({ ok: true, room: null });
    maybeSaveAnalytics(room);
    res.json({ ok: true, room: rooms.toClientView(room) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Local dev only in practice — on Vercel, requests under /public are served
// directly by the platform before ever reaching this function.
app.use(express.static(path.join(__dirname, '..', 'public')));

connectMongo(); // fire-and-forget — gameplay works fine before/without this resolving

module.exports = app;
