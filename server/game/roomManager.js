// Core game rules for Moji Mojo.
//
// This module is deliberately free of any networking/transport knowledge —
// it only reads and writes plain JSON-shaped "room" objects via ./store.js.
// server/app.js is responsible for wiring these functions to HTTP routes.
// Round timeouts and stale disconnects are resolved lazily (see
// applyLazyStateUpdates) rather than via a live timer, since there's no
// persistent process to hold one across requests. Keeping the split this way
// means the persistence layer (store.js) and the transport layer (app.js)
// can each be swapped out independently of the rules below.
//
// Player identity is a client-generated id (persisted in the browser's
// sessionStorage), NOT a socket/connection id — a refresh gets a fresh HTTP
// session but keeps the same player id, which is what makes
// rejoin-after-refresh, play-again, and the frozen final leaderboard all work.

const { EMOJI_BOARDS, pointsForRank, getBoardsForLanguage } = require('../data/emojiData');
const store = require('./store');

const TOTAL_ROUNDS = 3;
const ROUND_SECONDS = 30;
const MAX_PLAYERS = 8;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — avoids look-alike mixups

// How long a disconnected player's seat stays warm before they're actually
// removed from the room — long enough to survive a page refresh or a closed
// tab right after the final results, without leaving stale seats forever.
const DISCONNECT_GRACE_MS = 5 * 60 * 1000;

// A player is considered disconnected once their heartbeat goes quiet for
// this long — comfortably above the client's ~4s heartbeat interval so a
// couple of missed beats (a slow network tick, a backgrounded tab) don't
// falsely flag someone as gone.
const HEARTBEAT_TIMEOUT_MS = 15 * 1000;

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

function pickRoundBoards(boards) {
  const indices = boards.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, TOTAL_ROUNDS).map((boardIndex, i) => ({
    roundNumber: i + 1,
    boardIndex,
    emoji: boards[boardIndex].emoji,
    keywords: boards[boardIndex].keywords,
    // Shared across the whole room — once any player reveals a keyword it's
    // off-limits for everyone else, so this is keyed by keyword, not player.
    revealed: {},
    // Every guess attempt (correct, wrong, or a repeat of an already-revealed
    // word) gets logged here — this is the raw feed the analytics record in
    // buildGameSessionRecord() is built from.
    guesses: [],
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
    lastSeenAt: Date.now(),
    disconnectedAt: null,
  };
}

function reassignHostIfNeeded(room, departingId) {
  if (room.hostId !== departingId) return;
  room.hostId =
    room.playerOrder.find((id) => id !== departingId && room.players[id] && room.players[id].connected) ||
    room.hostId;
}

// Round-timeouts and stale disconnects used to be resolved by live
// setTimeout handles kept in server.js's process memory -- those can't
// survive across serverless invocations (each request may land on a
// different, isolated instance), so instead every room load "catches up"
// any state that should have already changed by wall-clock time. Mutates
// `room` in place; returns true if anything changed, so the caller knows
// whether to persist it.
function applyLazyStateUpdates(room) {
  let changed = false;
  const now = Date.now();

  // 1. The round clock ran out with nobody around (or fast enough) to
  // trigger the next step directly -- advance it exactly like a live round
  // timer used to.
  if (room.state === 'playing') {
    const round = room.rounds[room.roundIndex];
    if (round && round.endsAt && now >= round.endsAt) {
      const isFinalRound = room.roundIndex >= room.totalRounds - 1;
      room.state = isFinalRound ? 'final' : 'roundEnd';
      if (isFinalRound) room.finalLeaderboard = buildLeaderboard(room);
      changed = true;
    }
  }

  // 2. Players who've gone quiet longer than the heartbeat timeout are
  // treated as disconnected -- mirrors what a live socket "disconnect"
  // event used to do immediately.
  for (const id of room.playerOrder) {
    const player = room.players[id];
    if (player && player.connected && now - (player.lastSeenAt || 0) > HEARTBEAT_TIMEOUT_MS) {
      player.connected = false;
      player.disconnectedAt = now;
      reassignHostIfNeeded(room, id);
      changed = true;
    }
  }

  // 3. A seat that's stayed disconnected past the grace period is freed up
  // for real, same as an explicit leave.
  const stale = room.playerOrder.filter((id) => {
    const player = room.players[id];
    return player && !player.connected && player.disconnectedAt && now - player.disconnectedAt > DISCONNECT_GRACE_MS;
  });
  if (stale.length) {
    for (const id of stale) {
      reassignHostIfNeeded(room, id);
      delete room.players[id];
    }
    room.playerOrder = room.playerOrder.filter((id) => !stale.includes(id));
    changed = true;
  }

  return changed;
}

// How many times mutateRoom() retries a save that lost an optimistic-
// concurrency race (or a read that transiently missed an existing room)
// before giving up. A handful is plenty -- each retry means another
// request genuinely raced this one against the same room.
const MAX_MUTATE_RETRIES = 6;

// Every function below reads a room through this instead of calling
// store.getRoom directly, so time-driven state (round timeouts, stale
// disconnects) is always caught up first. Returns null both when the room
// truly doesn't exist and when resolving staleness just emptied it out.
async function loadRoom(roomCode) {
  for (let attempt = 0; attempt < MAX_MUTATE_RETRIES; attempt++) {
    const room = await store.getRoom(roomCode);
    if (!room) return null;
    const changed = applyLazyStateUpdates(room);
    if (room.playerOrder.length === 0) {
      await store.deleteRoom(roomCode);
      return null;
    }
    if (!changed) return room;
    const saved = await store.saveRoom(room, room.version);
    if (saved) return saved;
    // Someone else (another action, a poll-triggered lazy transition) saved
    // first -- loop and retry the transition against the now-current room.
  }
  return store.getRoom(roomCode);
}

// Every *action* (join, start, submit guess, heartbeat, leave, ...) goes
// through this instead of a plain read-mutate-save, so two requests racing
// to modify the *same* room -- e.g. two players' guesses landing less than
// one round trip apart -- can't silently clobber each other (whichever
// saved last would otherwise just win, discarding the other's change even
// though the response for both still reports success). On Vercel two
// concurrent requests for the same room can land on two entirely different
// serverless instances, so an in-process lock can't help here; this instead
// uses the room's version field as an optimistic-concurrency token -- the
// store only accepts a save if the version hasn't moved since this read,
// and if it has, the whole read-mutate-save cycle retries against the
// now-current room instead of overwriting it.
//
// A store.getRoom miss on the very first attempt is retried here too,
// rather than treated as an instant "room not found" -- a cold serverless
// instance's freshly opened Mongo connection can transiently miss a
// document that genuinely exists, and retrying within the same request is
// what actually rides that out instead of failing a real action with no
// recourse (a player's action reporting failure with zero feedback reads,
// from their side, as "the game just isn't responding").
//
// mutateFn may throw (e.g. "Only the host can start the game") -- that
// propagates immediately, uncaught here, since it's a validation failure
// the caller needs to see, not a concurrency conflict to retry past.
// mutateFn's return value, if any, is threaded back out alongside the saved
// room -- some actions (submitGuess) need to report more than just the
// room's new shape.
async function mutateRoom(roomCode, mutateFn) {
  let everFoundRoom = false;
  for (let attempt = 0; attempt < MAX_MUTATE_RETRIES; attempt++) {
    const room = await store.getRoom(roomCode);
    if (!room) continue;
    everFoundRoom = true;
    applyLazyStateUpdates(room);
    if (room.playerOrder.length === 0) {
      await store.deleteRoom(roomCode);
      return { room: null, result: undefined };
    }
    const expectedVersion = room.version;
    const result = mutateFn(room);
    if (room.playerOrder.length === 0) {
      // The mutation itself emptied the room (an explicit leave with nobody
      // else connected) -- delete rather than save.
      await store.deleteRoom(roomCode);
      return { room: null, result };
    }
    const saved = await store.saveRoom(room, expectedVersion);
    if (saved) return { room: saved, result };
    // Someone else saved first -- loop and retry the mutation against
    // whatever the room actually looks like now.
  }
  if (!everFoundRoom) return { room: null, result: undefined };
  throw err('ROOM_BUSY', 'Room is busy — try again.');
}

// desiredCode, when given, adopts an externally-sourced code (the arcade
// party's room code) instead of generating a random one — "one code,
// sourced from the URL when it's there," per the arcade contract. If a
// room under that code already exists here (e.g. two arcade players both
// landed on this game first), that existing room is joined instead so
// there's still only ever one room per code.
async function createRoom(playerId, username, desiredCode, language) {
  if (desiredCode) {
    const normalized = String(desiredCode).trim().toUpperCase();
    const existing = await loadRoom(normalized);
    if (existing) return joinRoom(normalized, playerId, username);
  }
  const roomCode = desiredCode ? String(desiredCode).trim().toUpperCase() : await generateUniqueRoomCode();
  const room = {
    roomCode,
    hostId: playerId,
    // Which board set (see server/data/emojiData.js's getBoardsForLanguage)
    // this room's rounds draw emoji/keywords from -- the arcade party's
    // Game Language, or "en" standalone/unsupported.
    language: language || 'en',
    state: 'lobby', // lobby | playing | roundEnd | final
    players: {
      [playerId]: makePlayer(playerId, username, 0),
    },
    playerOrder: [playerId],
    totalRounds: TOTAL_ROUNDS,
    roundSeconds: ROUND_SECONDS,
    roundIndex: -1,
    rounds: [],
    finalLeaderboard: null,
    createdAt: Date.now(),
    version: 0,
  };
  await store.saveRoom(room); // brand-new room -- nothing to conflict with yet
  return room;
}

// Shared by joinRoom (when the joiner turns out to already be a member) and
// reconnectPlayer, so both go through the exact same mutation.
function applyReconnect(room, playerId, username) {
  const player = room.players[playerId];
  if (!player) throw err('NOT_IN_ROOM', 'You are not in this room.');
  player.connected = true;
  player.disconnectedAt = null;
  player.lastSeenAt = Date.now();
  if (username) player.username = username;
  if (!room.playerOrder.includes(playerId)) room.playerOrder.push(playerId);
}

async function joinRoom(roomCode, playerId, username) {
  const { room } = await mutateRoom(roomCode, (r) => {
    if (r.players[playerId]) {
      // Already a member (e.g. duplicate join from the same device) — treat as reconnect.
      applyReconnect(r, playerId, username);
      return;
    }
    if (r.state !== 'lobby') throw err('GAME_IN_PROGRESS', 'That game has already started.');
    if (r.playerOrder.length >= MAX_PLAYERS) throw err('ROOM_FULL', 'That room is full.');
    r.players[playerId] = makePlayer(playerId, username, r.playerOrder.length);
    r.playerOrder.push(playerId);
  });
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
  return room;
}

// Used for an explicit rejoin_room call (after a refresh).
async function reconnectPlayer(roomCode, playerId, username) {
  const { room } = await mutateRoom(roomCode, (r) => applyReconnect(r, playerId, username));
  if (!room) throw err('ROOM_NOT_FOUND', 'That room no longer exists.');
  return room;
}

// Called every few seconds by a connected client (there's no persistent
// socket to notice a disconnect anymore) -- keeps a player's presence fresh
// and transparently resumes them if a brief blip had already flagged them
// disconnected. Actual staleness detection happens lazily in
// applyLazyStateUpdates on the next room load, not here.
async function heartbeat(roomCode, playerId) {
  const { room } = await mutateRoom(roomCode, (r) => {
    const player = r.players[playerId];
    if (!player) throw err('NOT_IN_ROOM', 'You are not in this room.');
    player.lastSeenAt = Date.now();
    if (!player.connected) {
      player.connected = true;
      player.disconnectedAt = null;
    }
  });
  if (!room) throw err('ROOM_NOT_FOUND', 'That room no longer exists.');
  return room;
}

async function getRoom(roomCode) {
  return loadRoom(roomCode);
}

async function setReady(roomCode, playerId, ready) {
  const { room } = await mutateRoom(roomCode, (r) => {
    if (r.state !== 'lobby') throw err('GAME_IN_PROGRESS', 'That game has already started.');
    const player = r.players[playerId];
    if (!player) throw err('NOT_IN_ROOM', 'You are not in this room.');
    player.ready = !!ready;
  });
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
  return room;
}

async function startGame(roomCode, requesterId) {
  const { room } = await mutateRoom(roomCode, (r) => {
    if (r.hostId !== requesterId) throw err('NOT_HOST', 'Only the host can start the game.');
    if (r.state !== 'lobby') throw err('GAME_IN_PROGRESS', 'The game has already started.');
    if (r.playerOrder.length < 1) throw err('NOT_ENOUGH_PLAYERS', 'Need at least one player.');
    // A disconnected player still mid-grace-period shouldn't block the rest of
    // the group from starting (or restarting via Play Again) — only players
    // who are actually present need to have readied up.
    const allReady = r.playerOrder.every((id) => {
      const player = r.players[id];
      return player && (!player.connected || player.ready);
    });
    if (!allReady) throw err('NOT_ALL_READY', 'Everyone needs to be ready before starting.');

    r.rounds = pickRoundBoards(getBoardsForLanguage(r.language));
    r.roundIndex = 0;
    r.state = 'playing';
    r.finalLeaderboard = null;
    const round = r.rounds[0];
    round.startedAt = Date.now();
    round.endsAt = round.startedAt + ROUND_SECONDS * 1000;
  });
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
  return room;
}

// Resets a finished room back to the lobby so the same group can play again
// without re-sharing the room code — scores and ready state reset, but the
// room, its code, and its players all stay put (so late joiners can still
// hop in before the next start).
async function playAgain(roomCode, requesterId) {
  const { room } = await mutateRoom(roomCode, (r) => {
    if (r.hostId !== requesterId) throw err('NOT_HOST', 'Only the host can start a new game.');
    if (r.state !== 'final') throw err('WRONG_STATE', 'The game has not finished yet.');

    r.state = 'lobby';
    r.roundIndex = -1;
    r.rounds = [];
    r.finalLeaderboard = null;
    for (const id of r.playerOrder) {
      const player = r.players[id];
      if (player) {
        player.score = 0;
        player.ready = false;
      }
    }
  });
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
  return room;
}

async function submitGuess(roomCode, playerId, guessText) {
  const guess = normalizeGuess(guessText);
  if (!guess) return { result: 'empty' };

  const { room, result } = await mutateRoom(roomCode, (r) => {
    if (r.state !== 'playing') throw err('NOT_PLAYING', 'No round is currently active.');
    const player = r.players[playerId];
    if (!player) throw err('NOT_IN_ROOM', 'You are not in this room.');

    const round = r.rounds[r.roundIndex];
    const now = Date.now();
    const logEntry = {
      playerId,
      username: player.username,
      guessText: String(guessText),
      normalizedGuess: guess,
      timestamp: now,
      // "Decision time" / time-to-this-action, measured from when the round
      // (the prompt) started.
      msSinceRoundStart: round.startedAt ? now - round.startedAt : null,
    };

    const existing = round.revealed[guess];
    if (existing) {
      round.guesses.push({ ...logEntry, result: 'already-revealed' });
      return { result: 'already-revealed', keyword: guess, revealedBy: existing.revealedBy };
    }

    const rankIndex = round.keywords.findIndex((k) => k.toLowerCase() === guess);
    if (rankIndex === -1) {
      round.guesses.push({ ...logEntry, result: 'no-match' });
      return { result: 'no-match' };
    }

    const points = pointsForRank(rankIndex, round.keywords.length);
    const revealedBy = { id: player.id, username: player.username, color: player.color };
    round.revealed[guess] = { rankIndex, points, revealedBy };
    player.score += points;
    round.guesses.push({ ...logEntry, result: 'correct', rankIndex, points });

    return {
      result: 'correct',
      keyword: guess,
      rankIndex,
      points,
      scoreTotal: player.score,
      revealedBy,
    };
  });
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
  return result;
}

function buildLeaderboard(room) {
  return room.playerOrder
    .map((id) => room.players[id])
    .filter(Boolean)
    .map((p) => ({ id: p.id, username: p.username, score: p.score, connected: p.connected, ready: p.ready, color: p.color }))
    .sort((a, b) => b.score - a.score);
}

async function nextRound(roomCode, requesterId) {
  const { room } = await mutateRoom(roomCode, (r) => {
    if (r.hostId !== requesterId) throw err('NOT_HOST', 'Only the host can advance the round.');
    if (r.state !== 'roundEnd') throw err('WRONG_STATE', 'The round has not ended yet.');
    if (r.roundIndex >= r.totalRounds - 1) throw err('NO_MORE_ROUNDS', 'That was the final round.');

    r.roundIndex += 1;
    r.state = 'playing';
    const round = r.rounds[r.roundIndex];
    round.startedAt = Date.now();
    round.endsAt = round.startedAt + r.roundSeconds * 1000;
  });
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
  return room;
}

// Full removal — used immediately for an explicit "leave" (Go Home). A
// missed heartbeat instead just flips connected=false via
// applyLazyStateUpdates and keeps the seat warm until its grace period
// actually expires (also handled there).
async function leaveRoom(roomCode, playerId) {
  const { room } = await mutateRoom(roomCode, (r) => {
    if (r.players[playerId]) {
      r.players[playerId].connected = false;
    }
    r.playerOrder = r.playerOrder.filter((id) => id !== playerId);

    const anyoneLeft = r.playerOrder.some((id) => r.players[id] && r.players[id].connected);
    if (!anyoneLeft) {
      // Nobody left connected (some may still be listed mid-grace-period) —
      // tear the room down now rather than leaving zombie seats warm for the
      // full grace period. Emptying playerOrder triggers mutateRoom's own
      // empty-room deletion instead of duplicating that logic here.
      r.playerOrder = [];
      return;
    }

    if (r.hostId === playerId) {
      r.hostId = r.playerOrder.find((id) => r.players[id] && r.players[id].connected) || r.hostId;
    }
  });
  return room;
}

// Lobby-only, host-only: once the game has started, players are mid-round
// (submitted guesses, scores) and removal mid-game risks leaving that state
// inconsistent -- a disruptive player can still be dealt with by waiting for
// the round to end, or by the host resetting via Play Again.
async function kickPlayer(roomCode, requesterId, targetId) {
  const { room } = await mutateRoom(roomCode, (r) => {
    if (r.hostId !== requesterId) throw err('NOT_HOST', 'Only the host can remove a player.');
    if (targetId === requesterId) throw err('CANNOT_KICK_SELF', "You can't remove yourself — use Go Home instead.");
    if (r.state !== 'lobby') throw err('GAME_IN_PROGRESS', "Can't remove a player once the game has started.");
    if (!r.players[targetId]) throw err('NOT_IN_ROOM', 'That player is no longer in the room.');
    r.players[targetId].connected = false;
    r.playerOrder = r.playerOrder.filter((id) => id !== targetId);
    if (r.hostId === targetId) {
      r.hostId = r.playerOrder.find((id) => r.players[id] && r.players[id].connected) || r.hostId;
    }
  });
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
  return room;
}

// No status restriction (unlike kickPlayer) -- handing host to someone else
// mid-game is harmless, since host-only actions (start/play-again) aren't
// reachable again until the game returns to the lobby anyway.
async function transferHost(roomCode, requesterId, targetId) {
  const { room } = await mutateRoom(roomCode, (r) => {
    if (r.hostId !== requesterId) throw err('NOT_HOST', 'Only the host can transfer host.');
    if (targetId === requesterId) return;
    if (!r.players[targetId]) throw err('NOT_IN_ROOM', 'That player is no longer in the room.');
    r.hostId = targetId;
  });
  if (!room) throw err('ROOM_NOT_FOUND', 'That room code does not exist.');
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
        // A bare count of every guess attempt this round (correct, wrong, or
        // a repeat) -- never who guessed or what they typed, so this stays
        // fully anonymous while still giving every player a live signal that
        // guessing is actively happening, not just silence until a match.
        guessCount: currentRound.guesses.length,
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
    finalLeaderboard: room.finalLeaderboard || null,
  };
}

// Shapes a completed game (lobby -> N rounds -> final) into the document
// written to the `gamesessions` collection for analysis. Pure data shaping —
// no MongoDB/driver code here, so this stays testable and swappable the same
// way ./store.js keeps live room storage separate from game rules.
function buildGameSessionRecord(room) {
  const playedRounds = room.rounds.filter((r) => r.startedAt);
  const gameStartedAt = playedRounds.length ? playedRounds[0].startedAt : room.createdAt;
  const lastRound = playedRounds[playedRounds.length - 1];
  const gameEndedAt = lastRound ? lastRound.endsAt : Date.now();

  const rounds = playedRounds.map((round) => {
    const playerIds = [...new Set(round.guesses.map((g) => g.playerId))];
    const playerTiming = playerIds.map((playerId) => {
      const guesses = round.guesses
        .filter((g) => g.playerId === playerId)
        .sort((a, b) => a.timestamp - b.timestamp);
      const firstCorrect = guesses.find((g) => g.result === 'correct');
      return {
        playerId,
        username: guesses[0] ? guesses[0].username : (room.players[playerId] || {}).username,
        timeToFirstInputMs: guesses.length ? guesses[0].msSinceRoundStart : null,
        timeToCorrectAnswerMs: firstCorrect ? firstCorrect.msSinceRoundStart : null,
      };
    });

    return {
      roundNumber: round.roundNumber,
      emoji: round.emoji,
      keywords: round.keywords,
      roundStartedAt: new Date(round.startedAt),
      roundEndedAt: round.endsAt ? new Date(round.endsAt) : null,
      guesses: round.guesses.map((g) => ({
        playerId: g.playerId,
        username: g.username,
        guessText: g.guessText,
        normalizedGuess: g.normalizedGuess,
        timestamp: new Date(g.timestamp),
        msSinceRoundStart: g.msSinceRoundStart,
        result: g.result,
        rankIndex: g.rankIndex ?? null,
        points: g.points ?? null,
      })),
      playerTiming,
    };
  });

  const finalPlayers = room.finalLeaderboard || buildLeaderboard(room);

  return {
    game: 'Moji Mojo',
    roomCode: room.roomCode,
    language: room.language || 'en',
    gameStartedAt: new Date(gameStartedAt),
    gameEndedAt: new Date(gameEndedAt),
    totalDurationMs: gameEndedAt - gameStartedAt,
    players: finalPlayers.map((p) => ({
      playerId: p.id,
      username: p.username,
      finalScore: p.score,
    })),
    rounds,
  };
}

// Marks a finished room's analytics as already recorded, so a concurrent or
// repeated poll doesn't write a duplicate gamesession document. Best-effort
// like the rest of the analytics path -- app.js calls this right after
// saveGameSessionAnalytics() succeeds.
async function markAnalyticsSaved(roomCode) {
  const room = await store.getRoom(roomCode);
  if (!room) return;
  room.analyticsSaved = true;
  await store.saveRoom(room);
}

module.exports = {
  TOTAL_ROUNDS,
  ROUND_SECONDS,
  createRoom,
  joinRoom,
  reconnectPlayer,
  heartbeat,
  getRoom,
  setReady,
  startGame,
  playAgain,
  submitGuess,
  nextRound,
  leaveRoom,
  kickPlayer,
  transferHost,
  buildLeaderboard,
  buildGameSessionRecord,
  markAnalyticsSaved,
  toClientView,
};
