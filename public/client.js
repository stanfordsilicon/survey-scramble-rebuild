// Gated on initI18n(): the string table now arrives over the network, so
// nothing here may run until it has loaded -- the very first statement
// below paints UI text. initI18n() never rejects, so this always runs.
initI18n().then(() => {
  // Static (non-templated) UI text is data-i18n-driven -- see public/i18n.js.
  // Anything with dynamic content (a score, a room code) is set directly
  // below via t() instead, since data-i18n has no way to carry variables.
  applyStaticTranslations();

  // No more persistent Socket.IO connection -- every action is a plain HTTP
  // request, and room updates arrive via polling instead of a push
  // broadcast. See server/app.js's top comment for why (Vercel serverless
  // has no long-lived process to hold a WebSocket open, and no shared
  // memory between invocations to broadcast from anyway).
  async function api(action, payload) {
    const body = Object.assign({}, payload);
    body.playerId = myId;
    if (room && !body.roomCode) body.roomCode = room.roomCode;
    try {
      const res = await fetch(`/api/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await res.json();
    } catch (e) {
      return { ok: false, error: t('connection_error') };
    }
  }

  // Player identity is a persistent id kept in sessionStorage (not a
  // connection id) — a page refresh gets a brand new HTTP session but keeps
  // the same device id, which is what lets rejoin-room put you right back
  // where you were instead of bouncing you to the login screen.
  //
  // sessionStorage rather than localStorage is deliberate: localStorage is
  // shared by every tab on the same origin, so two tabs of this game open in
  // one browser would silently collapse into a single player identity.
  // sessionStorage is scoped to one tab (but still survives a refresh of
  // that tab), which is exactly "one player per device/tab".
  function getDeviceId() {
    let id = sessionStorage.getItem('qmoji_device_id');
    if (!id) {
      id = window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('qmoji_device_id', id);
    }
    return id;
  }

  const myId = getDeviceId();

  function saveSession(roomCode, username) {
    sessionStorage.setItem('qmoji_session', JSON.stringify({ roomCode, username }));
  }

  function clearSession() {
    sessionStorage.removeItem('qmoji_session');
  }

  function loadSession() {
    try {
      return JSON.parse(sessionStorage.getItem('qmoji_session') || 'null');
    } catch (e) {
      return null;
    }
  }

  // The single source of truth for what this client currently knows about the
  // room — always replaced wholesale from a poll/action response rather than
  // patched piecemeal, so the UI never drifts from the authoritative game
  // state returned by the server.
  let room = null;
  let timerInterval = null;
  let pollTimer = null;
  let heartbeatTimer = null;

  const screens = {
    login: document.getElementById('screen-login'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game'),
    scoring: document.getElementById('screen-scoring'),
    final: document.getElementById('screen-final'),
  };

  function showScreen(name) {
    Object.values(screens).forEach((el) => el.classList.remove('active'));
    screens[name].classList.add('active');
    if (name !== 'lobby') stopSoloPrompt();
  }

  // ---------- sound mute toggle ----------
  const muteBtn = document.getElementById('muteBtn');
  muteBtn.addEventListener('click', () => {
    const next = !window.SFX.isMuted();
    window.SFX.setMuted(next);
    muteBtn.textContent = next ? '🔇' : '🔊';
    muteBtn.classList.toggle('muted', next);
  });

  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  // ---------- POLLING + PRESENCE ----------
  // Replaces the old room_update/round_started/round_ended/guess_correct
  // socket broadcasts. Every response is a full authoritative room
  // snapshot, same shape those broadcasts always carried.
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(pollRoom, 1500);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  async function pollRoom() {
    if (!room) return;
    try {
      const res = await fetch(`/api/room?code=${encodeURIComponent(room.roomCode)}`);
      const data = await res.json();
      if (data.ok && data.room) applyRoomSnapshot(data.room);
    } catch (e) {
      // transient network hiccup — the next tick retries
    }
  }

  // Replaces Socket.IO's automatic disconnect detection — there's no
  // persistent connection left for the server to notice drop, so presence
  // is tracked with a periodic heartbeat instead (see roomManager.js on the
  // server for how staleness actually gets detected).
  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (room) api('heartbeat', {});
    }, 4000);
  }

  function stopHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  // Explicit "leaving right now" signal for the common case (closing the
  // tab) — sendBeacon is used because a plain fetch can get cancelled
  // mid-flight when the page unloads. The heartbeat timeout on the server
  // is the fallback for real drops (crash, network loss) where this never
  // fires.
  window.addEventListener('pagehide', () => {
    if (!room || !navigator.sendBeacon) return;
    try {
      const blob = new Blob([JSON.stringify({ roomCode: room.roomCode, playerId: myId })], { type: 'application/json' });
      navigator.sendBeacon('/api/leave-room', blob);
    } catch (e) {
      // best-effort only
    }
  });

  // ---------- LOGIN ----------
  const usernameInput = document.getElementById('input-username');
  const roomCodeInput = document.getElementById('input-room-code');
  const loginError = document.getElementById('login-error');
  const loginInviteHint = document.getElementById('login-invite-hint');

  // A link copied via "Copy Invite Link" lands here as ?room=CODE — prefill
  // the code so the invitee only has to type a name and hit Join.
  const invitedRoomCode = new URLSearchParams(window.location.search).get('room');
  if (invitedRoomCode) {
    roomCodeInput.value = invitedRoomCode.trim().toUpperCase();
    loginInviteHint.textContent = t('invited_hint', { code: roomCodeInput.value });
    loginInviteHint.classList.remove('hidden');
    usernameInput.focus();
  }

  // Common tail end of create/join/rejoin: remember the session, apply
  // whatever state the room is actually in (lobby, mid-round, results —
  // applyRoomSnapshot figures out which), and start keeping it fresh.
  function enterRoom(updatedRoom, username) {
    saveSession(updatedRoom.roomCode, username);
    applyRoomSnapshot(updatedRoom);
    startPolling();
    startHeartbeat();
  }

  document.getElementById('btn-create-room').addEventListener('click', () => {
    loginError.classList.add('hidden');
    const name = usernameInput.value;
    // arcadeLang/arcadeUiLang (declared below, set by initArcadeLink()) are
    // already resolved by the time a real click can happen -- null just
    // means "no arcade party" or "no board data for that language yet",
    // and the server falls back to English either way.
    api('create-room', { username: name, language: arcadeLang, uiLang: arcadeUiLang }).then((res) => {
      if (!res.ok) return showLoginError(res.error);
      enterRoom(res.room, name || usernameInput.value);
    });
  });

  document.getElementById('btn-join-room').addEventListener('click', () => {
    loginError.classList.add('hidden');
    const name = usernameInput.value;
    api('join-room', { username: name, roomCode: roomCodeInput.value }).then((res) => {
      if (!res.ok) return showLoginError(res.error);
      enterRoom(res.room, name || usernameInput.value);
    });
  });

  function showLoginError(msg) {
    loginError.textContent = msg || t('generic_error');
    loginError.classList.remove('hidden');
  }

  // ---------- QMoji Arcade: party continuity from the homescreen ----------
  // Enhancement only — if there's no ?room= or the lookup fails, none of
  // this runs and the login screen above behaves exactly as it does
  // standalone (including its own pre-existing ?room= invite-link prefill).
  const backToLaunchpadBtn = document.getElementById('backToLaunchpadBtn');
  let arcadeRoomCode = null;
  let arcadeLang = null;
  let arcadeUiLang = null;
  let arcadePlayerId = null;

  // Mirrors qmoji/app.js's own launchGame() transition (fade in "LOADING…"
  // with a bar-fill, then navigate after a beat) so leaving a game feels
  // like the same continuous arcade as entering one, instead of an instant
  // jump cut.
  function navigateWithLoadingScreen(href) {
    const loadingScreen = document.getElementById('loadingScreen');
    const fill = document.getElementById('loadingBarFill');
    if (!loadingScreen || !fill) {
      window.location.href = href;
      return;
    }
    loadingScreen.classList.add('is-visible');
    loadingScreen.setAttribute('aria-hidden', 'false');
    fill.style.width = '0%';
    requestAnimationFrame(() => { fill.style.width = '100%'; });
    setTimeout(() => { window.location.href = href; }, 650);
  }

  backToLaunchpadBtn.addEventListener('click', () => {
    // Best-effort: leaves the room cleanly instead of just navigating away
    // and leaving a ghost player behind until their heartbeat times out.
    // Not awaited -- navigateWithLoadingScreen's own ~650ms transition delay
    // is enough time for this to reach the server either way.
    if (room) api('leave-room', {}).catch(() => {});
    navigateWithLoadingScreen(QMojiArcade.backToHomescreenUrl(arcadeRoomCode, arcadeLang, arcadePlayerId, arcadeUiLang));
  });

  (async function initArcadeLink() {
    const arcade = await QMojiArcade.initArcade();
    if (!arcade) return;
    arcadeRoomCode = arcade.roomCode;
    arcadeLang = arcade.lang;
    arcadeUiLang = arcade.uiLang;
    arcadePlayerId = arcade.playerId;

    const me = (arcade.room.players || []).find((p) => p.playerId === arcadePlayerId);
    if (!me) {
      // A raw game link was opened directly (not routed through the
      // homescreen) — the existing invite-link code above already prefilled
      // the room code; just also enroll whoever joins into the arcade party.
      document.getElementById('btn-join-room').addEventListener('click', () => {
        const name = usernameInput.value.trim();
        if (name) QMojiArcade.joinRoom(arcadeRoomCode, name).catch(() => {});
      });
      return;
    }

    // Known party member — skip the manual entry screen entirely. Try to
    // join the room this game already knows about; if this is the first
    // arcade player to reach this game, seed one under the party's code
    // instead of a random one (one code, sourced from the URL).
    usernameInput.value = me.name;
    const res = await api('join-room', { username: me.name, roomCode: arcadeRoomCode });
    if (res.ok) {
      enterRoom(res.room, me.name);
      return;
    }
    const res2 = await api('create-room', { username: me.name, code: arcadeRoomCode, language: arcadeLang, uiLang: arcadeUiLang });
    if (!res2.ok) return; // arcade layer is an enhancement — leave the standalone login screen up
    enterRoom(res2.room, me.name);
  })();

  // ---------- REJOIN AFTER REFRESH ----------
  // On load, try to resume whatever room this device was last in. If the
  // room's gone, just fall back to login.
  (async function initSession() {
    const session = loadSession();
    if (!session || !session.roomCode) return;
    const res = await api('rejoin-room', { roomCode: session.roomCode, username: session.username });
    if (!res.ok) {
      clearSession();
      return;
    }
    usernameInput.value = session.username || '';
    enterRoom(res.room, session.username);
  })();

  // ---------- LOBBY ----------
  function renderPlayerBadge(player) {
    const badge = document.createElement('span');
    badge.className = 'player-badge';
    badge.style.backgroundColor = player.color || '#999';
    badge.textContent = (player.username || '?').trim().charAt(0).toUpperCase() || '?';
    badge.title = player.username;
    return badge;
  }

  function renderLobby() {
    document.getElementById('lobby-room-code').textContent = room.roomCode;

    const list = document.getElementById('lobby-player-list');
    list.innerHTML = '';
    room.players.forEach((p) => {
      const li = document.createElement('li');
      if (!p.connected) li.classList.add('disconnected');
      const left = document.createElement('span');
      left.className = 'roster-left';
      left.appendChild(renderPlayerBadge(p));
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.username + (p.id === room.hostId ? ' ' + t('host_suffix') : '');
      left.appendChild(name);

      const readyBadge = document.createElement('span');
      readyBadge.className = 'ready-badge ' + (p.ready ? 'is-ready' : 'is-waiting');
      readyBadge.textContent = p.ready ? t('ready_badge') : t('waiting_badge');

      li.appendChild(left);
      li.appendChild(readyBadge);

      // Host-only controls for every OTHER player in the room -- kicking
      // yourself would just be leaving, and transferring host to yourself is
      // a no-op, so neither button is shown on the host's own row.
      if (room.hostId === myId && p.id !== myId) {
        const actions = document.createElement('span');
        actions.className = 'player-actions';

        const makeHostBtn = document.createElement('button');
        makeHostBtn.type = 'button';
        makeHostBtn.className = 'player-action-btn';
        makeHostBtn.textContent = t('make_host_button');
        makeHostBtn.addEventListener('click', async () => {
          const res = await api('transfer-host', { targetId: p.id });
          if (!res.ok) return toast(res.error);
          applyRoomSnapshot(res.room);
        });
        actions.appendChild(makeHostBtn);

        const kickBtn = document.createElement('button');
        kickBtn.type = 'button';
        kickBtn.className = 'player-action-btn kick';
        kickBtn.textContent = t('kick_button');
        kickBtn.addEventListener('click', async () => {
          if (!window.confirm(t('kick_confirm', { name: p.username }))) return;
          const res = await api('kick-player', { targetId: p.id });
          if (!res.ok) return toast(res.error);
          applyRoomSnapshot(res.room);
        });
        actions.appendChild(kickBtn);

        li.appendChild(actions);
      }

      list.appendChild(li);
    });

    const isHost = room.hostId === myId;
    const me = room.players.find((p) => p.id === myId);
    const allReady = room.players.length > 0 && room.players.every((p) => !p.connected || p.ready);

    const readyBtn = document.getElementById('btn-toggle-ready');
    readyBtn.textContent = me && me.ready ? t('cancel_ready_button') : t('ready_up_button');

    const startBtn = document.getElementById('btn-start-game');
    startBtn.classList.toggle('hidden', !isHost);
    startBtn.disabled = !allReady;

    const waiting = document.getElementById('lobby-waiting');
    if (allReady) {
      waiting.textContent = isHost ? t('lobby_waiting_host_ready') : t('lobby_waiting_guest_ready');
    } else {
      waiting.textContent = t('lobby_waiting_not_ready');
    }

    maybeShowSoloPrompt();
  }

  function applyLobbyState(updatedRoom) {
    room = updatedRoom;
    renderLobby();
    showScreen('lobby');
  }

  document.getElementById('btn-toggle-ready').addEventListener('click', () => {
    const me = room.players.find((p) => p.id === myId);
    const nextReady = !(me && me.ready);
    api('set-ready', { ready: nextReady }).then((res) => {
      if (!res.ok) return toast(res.error);
      applyRoomSnapshot(res.room);
    });
  });

  document.getElementById('btn-start-game').addEventListener('click', () => {
    api('start-game', {}).then((res) => {
      if (!res.ok) return toast(res.error);
      applyRoomSnapshot(res.room);
    });
  });

  document.getElementById('btn-copy-code').addEventListener('click', async () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${room.roomCode}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(t('invite_link_copied'));
    } catch (e) {
      toast(url);
    }
  });

  // ---------- SOLO PLAY NUDGE ----------
  // Offer to start solo immediately rather than making a lone player wait --
  // the room stays open in the background either way, so anyone who joins
  // later still gets pulled in normally.
  function maybeShowSoloPrompt() {
    const hint = document.getElementById('lobby-solo-hint');
    if (room && room.players.length === 1 && room.state === 'lobby') {
      hint.classList.remove('hidden');
    } else {
      hint.classList.add('hidden');
    }
  }

  document.getElementById('btn-play-solo').addEventListener('click', () => {
    api('set-ready', { ready: true }).then((res) => {
      if (!res.ok) return toast(res.error);
      return api('start-game', {}).then((res2) => {
        if (!res2.ok) return toast(res2.error);
        applyRoomSnapshot(res2.room);
      });
    });
  });

  function stopSoloPrompt() {
    document.getElementById('lobby-solo-hint').classList.add('hidden');
  }

  // ---------- ROOM SNAPSHOT DISPATCH ----------
  // Every poll tick and every action response hands over a full room
  // snapshot; this decides which screen it implies and whether it's a
  // meaningfully new state (a fresh round, fresh results) or just the same
  // one with a minor change (a reveal, a score, a roster update) so the
  // game screen doesn't stomp on whatever the player is mid-typing.
  // Detects being kicked: we were previously confirmed in this room (room
  // is set), but this fresher snapshot's player list no longer includes us.
  // The only path that removes a still-polling player from the list like
  // this is the host's kick action -- an explicit "leave" already tears
  // down polling locally first, and a dropped connection just flips
  // connected=false without removing the seat.
  function handleKicked() {
    stopPolling();
    stopHeartbeat();
    clearSession();
    room = null;
    showScreen('login');
    usernameInput.value = '';
    roomCodeInput.value = '';
    toast(t('kicked_from_room'));
  }

  function applyRoomSnapshot(updatedRoom) {
    if (room && Array.isArray(updatedRoom.players) && !updatedRoom.players.some((p) => p.id === myId)) {
      handleKicked();
      return;
    }

    const prev = room;

    if (updatedRoom.state === 'lobby') {
      applyLobbyState(updatedRoom);
      return;
    }

    if (updatedRoom.state === 'playing') {
      const isNewRound =
        !prev || prev.state !== 'playing' || !prev.round || prev.round.roundNumber !== updatedRoom.round.roundNumber;
      if (isNewRound) {
        applyRoundStarted(updatedRoom);
      } else {
        room = updatedRoom;
        renderAnswerBoard(document.getElementById('answer-board'), room.round, false);
        renderLeaderboard(document.getElementById('game-leaderboard'), room.players);
        renderMyScore();
        renderGuessActivity(room.round);
      }
      return;
    }

    // roundEnd or final
    const isNewResults =
      !prev ||
      prev.state === 'playing' ||
      prev.state !== updatedRoom.state ||
      (prev.round && updatedRoom.round && prev.round.roundNumber !== updatedRoom.round.roundNumber);
    if (isNewResults) {
      applyRoundEnded(updatedRoom);
    } else {
      room = updatedRoom;
      if (screens.scoring.classList.contains('active')) {
        renderLeaderboard(document.getElementById('scoring-leaderboard'), room.players);
      }
    }
  }

  // ---------- GAME ----------
  const guessForm = document.getElementById('guess-form');
  const guessInput = document.getElementById('input-guess');
  const guessFeedback = document.getElementById('guess-feedback');

  function applyRoundStarted(updatedRoom) {
    room = updatedRoom;
    window.SFX.roundStart();
    guessInput.value = '';
    guessFeedback.textContent = '';
    guessFeedback.className = 'guess-feedback';
    document.getElementById('game-round-badge').textContent = t('round_progress', { round: room.round.roundNumber, total: room.totalRounds });
    document.getElementById('game-emoji').textContent = room.round.emoji;
    renderMyScore();
    renderAnswerBoard(document.getElementById('answer-board'), room.round, false);
    renderLeaderboard(document.getElementById('game-leaderboard'), room.players);
    renderGuessActivity(room.round);
    showScreen('game');
    guessInput.focus();
    startTimer(room.round.endsAt);
  }

  // Ambient, fully-anonymized signal that guessing is actively happening --
  // a bare count, never who guessed or what they typed, so a wrong guess
  // still shows up as *activity* (the round isn't quiet) without exposing
  // anything the answer board itself doesn't already reveal once a keyword
  // is actually matched.
  function renderGuessActivity(round) {
    const el = document.getElementById('guess-activity');
    const count = round.guessCount || 0;
    el.textContent = count > 0 ? t('guess_activity', { count }) : '';
  }

  guessForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const guess = guessInput.value;
    if (!guess.trim()) return;
    api('submit-guess', { guess }).then((res) => {
      if (!res.ok) return toast(res.error);
      const outcome = res.outcome;
      // Every attempt (correct, wrong, or already-revealed) counts toward
      // the ambient activity count -- reflect it here immediately rather
      // than waiting for the next poll tick to catch up.
      if (room && room.round) {
        room.round.guessCount = (room.round.guessCount || 0) + 1;
        renderGuessActivity(room.round);
      }
      if (outcome.result === 'correct') {
        window.SFX.correct();
        guessFeedback.textContent = t('guess_correct', { keyword: outcome.keyword, points: outcome.points });
        guessFeedback.className = 'guess-feedback correct';
        // Reflect the reveal (and my own new score) immediately instead of
        // waiting for the next poll tick -- everyone else's screens pick up
        // the same change on their next poll a moment later.
        if (room && room.round) {
          room.round.revealed[outcome.keyword] = {
            rankIndex: outcome.rankIndex,
            points: outcome.points,
            revealedBy: outcome.revealedBy,
          };
          const me = room.players.find((p) => p.id === myId);
          if (me) me.score = outcome.scoreTotal;
          renderAnswerBoard(document.getElementById('answer-board'), room.round, false);
          renderLeaderboard(document.getElementById('game-leaderboard'), room.players);
          renderMyScore();
        }
      } else if (outcome.result === 'already-revealed') {
        const who = outcome.revealedBy ? outcome.revealedBy.username : t('guess_already_revealed_fallback_who');
        guessFeedback.textContent = t('guess_already_revealed', { who, keyword: outcome.keyword });
        guessFeedback.className = 'guess-feedback info';
      } else if (outcome.result === 'no-match') {
        window.SFX.wrong();
        guessFeedback.textContent = t('guess_wrong');
        guessFeedback.className = 'guess-feedback wrong';
      }
      // Clear on every outcome except a fresh correct guess still visible in
      // the board — an incorrect/duplicate guess shouldn't sit there wasting
      // the player's time re-deleting it before their next attempt.
      guessInput.value = '';
      guessInput.focus();
    });
  });

  function renderMyScore() {
    const me = room.players.find((p) => p.id === myId);
    document.getElementById('game-score-line').textContent = t('score_line', { score: me ? me.score : 0 });
  }

  function startTimer(endsAt) {
    clearInterval(timerInterval);
    const timerEl = document.getElementById('game-timer');
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      timerEl.textContent = remaining;
      timerEl.classList.toggle('low', remaining <= 10);
      if (remaining <= 0) clearInterval(timerInterval);
    };
    tick();
    timerInterval = setInterval(tick, 250);
  }

  // ---------- SCORING / ROUND END ----------
  function applyRoundEnded(updatedRoom) {
    room = updatedRoom;
    clearInterval(timerInterval);
    const isFinal = room.state === 'final';
    const isHost = room.hostId === myId;
    if (isFinal) window.SFX.gameOver(); else window.SFX.roundEnd();

    document.getElementById('scoring-title').textContent = isFinal
      ? t('final_round_results_title')
      : t('round_results_title', { round: room.round.roundNumber });
    document.getElementById('scoring-emoji').textContent = room.round.emoji;
    renderAnswerBoard(document.getElementById('scoring-answer-board'), room.round, true);
    renderLeaderboard(document.getElementById('scoring-leaderboard'), room.players);

    const nextBtn = document.getElementById('btn-next-round');
    const finalBtn = document.getElementById('btn-to-final');
    const waiting = document.getElementById('scoring-waiting');

    nextBtn.classList.toggle('hidden', isFinal || !isHost);
    finalBtn.classList.toggle('hidden', !isFinal);
    waiting.classList.toggle('hidden', isFinal || isHost);

    showScreen('scoring');
  }

  document.getElementById('btn-next-round').addEventListener('click', () => {
    api('next-round', {}).then((res) => {
      if (!res.ok) return toast(res.error);
      applyRoomSnapshot(res.room);
    });
  });

  document.getElementById('btn-to-final').addEventListener('click', () => {
    showFinalScreen();
  });

  function showFinalScreen() {
    const finalPlayers = (room.finalLeaderboard && room.finalLeaderboard.length) ? room.finalLeaderboard : room.players;
    renderLeaderboard(document.getElementById('final-leaderboard'), finalPlayers);

    const isHost = room.hostId === myId;
    document.getElementById('btn-play-again').classList.toggle('hidden', !isHost);
    document.getElementById('final-waiting').classList.toggle('hidden', isHost);
    showScreen('final');
    loadAllTimeLeaderboard();
  }

  // ---------- ALL-TIME LEADERBOARD ----------
  // Best single-game score across every game ever played, not just this room.
  function loadAllTimeLeaderboard() {
    const listEl = document.getElementById('all-time-leaderboard');
    fetch('/api/leaderboard')
      .then((res) => res.json())
      .then((data) => {
        listEl.innerHTML = '';
        (data.leaderboard || []).forEach((entry) => {
          const li = document.createElement('li');
          const name = document.createElement('span');
          name.className = 'name';
          name.textContent = entry.username;
          const score = document.createElement('span');
          score.className = 'score';
          score.textContent = t('all_time_score_summary', { score: entry.bestScore, games: entry.gamesPlayed });
          li.appendChild(name);
          li.appendChild(score);
          listEl.appendChild(li);
        });
      })
      .catch(() => { listEl.innerHTML = ''; });
  }

  document.getElementById('btn-play-again').addEventListener('click', () => {
    api('play-again', {}).then((res) => {
      if (!res.ok) return toast(res.error);
      applyRoomSnapshot(res.room);
    });
  });

  // Shared by the final screen's "Go Home" button and the mid-game "leave"
  // icon button (homeBtnGame). This used to just reset to this game's own
  // login screen -- which, mid-arcade-party, reads
  // as a dead end: a bare "Survey Scramble"-branded form that isn't where
  // "Home" sounds like it should go, and isn't reachable from the arcade
  // homescreen without also losing the party. "Home" now means the same
  // thing everywhere else in the arcade does -- back to the QMoji
  // homescreen, same as backToLaunchpadBtn -- rather than a second,
  // different destination depending on which button happened to be
  // clicked. leave-room still fires first either way, so no ghost player
  // is left behind waiting on its own heartbeat timeout.
  function leaveGame() {
    api('leave-room', {}).then(() => {
      stopPolling();
      stopHeartbeat();
      clearSession();
      room = null;
      navigateWithLoadingScreen(QMojiArcade.backToHomescreenUrl(arcadeRoomCode, arcadeLang, arcadePlayerId, arcadeUiLang));
    });
  }

  document.getElementById('btn-go-home').addEventListener('click', leaveGame);
  const homeBtnGame = document.getElementById('homeBtnGame');
  if (homeBtnGame) homeBtnGame.addEventListener('click', leaveGame);

  // ---------- SHARED RENDER HELPERS ----------
  function renderLeaderboard(listEl, players) {
    listEl.innerHTML = '';
    [...players]
      .sort((a, b) => b.score - a.score)
      .forEach((p) => {
        const li = document.createElement('li');
        if (p.connected === false) li.classList.add('disconnected');
        const left = document.createElement('span');
        left.className = 'roster-left';
        left.appendChild(renderPlayerBadge(p));
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = p.username + (p.id === myId ? ' ' + t('you_suffix') : '');
        left.appendChild(name);
        const score = document.createElement('span');
        score.className = 'score';
        score.textContent = p.score;
        li.appendChild(left);
        li.appendChild(score);
        listEl.appendChild(li);
      });
  }

  function renderAnswerBoard(boardEl, round, revealAll) {
    boardEl.innerHTML = '';
    // Every English board has exactly 10 keywords, but a language board
    // (see server/data/emojiData.js's getBoardsForLanguage) can be shorter,
    // so the slot count follows the round's own data instead of assuming 10.
    const size = (round.keywords && round.keywords.length) || 10;
    const revealedByRank = new Array(size).fill(null);
    Object.entries(round.revealed || {}).forEach(([keyword, info]) => {
      revealedByRank[info.rankIndex] = { keyword, ...info };
    });

    for (let rank = 0; rank < size; rank++) {
      const slot = document.createElement('div');
      slot.className = 'answer-slot';
      const rankBadge = document.createElement('span');
      rankBadge.className = 'rank';
      rankBadge.textContent = rank + 1;
      const label = document.createElement('span');
      label.className = 'answer-label';

      const entry = revealedByRank[rank];
      if (entry) {
        slot.classList.add('revealed');
        label.textContent = `${entry.keyword} (+${entry.points})`;
      } else if (revealAll && round.keywords) {
        slot.classList.add('missed');
        label.textContent = round.keywords[rank];
      } else {
        label.textContent = '???';
      }

      slot.appendChild(rankBadge);
      slot.appendChild(label);
      if (entry && entry.revealedBy) {
        slot.appendChild(renderPlayerBadge(entry.revealedBy));
      }
      boardEl.appendChild(slot);
    }
  }
});
