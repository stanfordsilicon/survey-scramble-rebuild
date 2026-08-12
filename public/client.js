(() => {
  const socket = io();

  // Player identity is a persistent id kept in sessionStorage (not the
  // socket id) — a page refresh gets a brand new socket connection but keeps
  // the same device id, which is what lets rejoin_room put you right back
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
  // room — always replaced wholesale from the server's room_update / round_*
  // payloads rather than patched piecemeal, so the UI never drifts from the
  // authoritative game state.
  let room = null;
  let timerInterval = null;
  let factoidInterval = null;

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
    if (name !== 'lobby') stopSoloPromptAndFactoid();
  }

  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
  }

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
    loginInviteHint.textContent = `You've been invited to room ${roomCodeInput.value} — enter a name and join!`;
    loginInviteHint.classList.remove('hidden');
    usernameInput.focus();
  }

  document.getElementById('btn-create-room').addEventListener('click', () => {
    loginError.classList.add('hidden');
    const name = usernameInput.value;
    socket.emit('create_room', { username: name, playerId: myId }, (res) => {
      if (!res.ok) return showLoginError(res.error);
      room = res.room;
      saveSession(room.roomCode, name || usernameInput.value);
      renderLobby();
      showScreen('lobby');
    });
  });

  document.getElementById('btn-join-room').addEventListener('click', () => {
    loginError.classList.add('hidden');
    const name = usernameInput.value;
    socket.emit(
      'join_room',
      { username: name, roomCode: roomCodeInput.value, playerId: myId },
      (res) => {
        if (!res.ok) return showLoginError(res.error);
        room = res.room;
        saveSession(room.roomCode, name || usernameInput.value);
        renderLobby();
        showScreen('lobby');
      }
    );
  });

  function showLoginError(msg) {
    loginError.textContent = msg || 'Something went wrong.';
    loginError.classList.remove('hidden');
  }

  // ---------- QMoji Arcade: party continuity from the homescreen ----------
  // Enhancement only — if there's no ?room= or the lookup fails, none of
  // this runs and the login screen above behaves exactly as it does
  // standalone (including its own pre-existing ?room= invite-link prefill).
  const backToLaunchpadBtn = document.getElementById('backToLaunchpadBtn');
  let arcadeRoomCode = null;
  let arcadeLang = null;
  let arcadePlayerId = null;

  backToLaunchpadBtn.addEventListener('click', () => {
    window.location.href = QMojiArcade.backToHomescreenUrl(arcadeRoomCode, arcadeLang, arcadePlayerId);
  });

  (async function initArcadeLink() {
    const arcade = await QMojiArcade.initArcade();
    if (!arcade) return;
    arcadeRoomCode = arcade.roomCode;
    arcadeLang = arcade.lang;
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
    socket.emit('join_room', { username: me.name, roomCode: arcadeRoomCode, playerId: myId }, (res) => {
      if (res.ok) {
        room = res.room;
        saveSession(room.roomCode, me.name);
        renderLobby();
        showScreen('lobby');
        return;
      }
      socket.emit('create_room', { username: me.name, playerId: myId, code: arcadeRoomCode }, (res2) => {
        if (!res2.ok) return; // arcade layer is an enhancement — leave the standalone login screen up
        room = res2.room;
        saveSession(room.roomCode, me.name);
        renderLobby();
        showScreen('lobby');
      });
    });
  })();

  // ---------- REJOIN AFTER REFRESH ----------
  // On connect (including the very first page load), try to resume whatever
  // room this device was last in. If the room's gone, just fall back to login.
  socket.on('connect', () => {
    const session = loadSession();
    if (!session || !session.roomCode) return;
    socket.emit('rejoin_room', { roomCode: session.roomCode, playerId: myId, username: session.username }, (res) => {
      if (!res.ok) {
        clearSession();
        return;
      }
      usernameInput.value = session.username || '';
      room = res.room;
      enterRoomAtCurrentState(room);
    });
  });

  function enterRoomAtCurrentState(updatedRoom) {
    if (updatedRoom.state === 'lobby') {
      applyLobbyState(updatedRoom);
    } else if (updatedRoom.state === 'playing') {
      applyRoundStarted(updatedRoom);
    } else {
      applyRoundEnded(updatedRoom);
    }
  }

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
      name.textContent = p.username + (p.id === room.hostId ? ' (host)' : '');
      left.appendChild(name);

      const readyBadge = document.createElement('span');
      readyBadge.className = 'ready-badge ' + (p.ready ? 'is-ready' : 'is-waiting');
      readyBadge.textContent = p.ready ? '✅ Ready' : '⏳ Waiting';

      li.appendChild(left);
      li.appendChild(readyBadge);
      list.appendChild(li);
    });

    const isHost = room.hostId === myId;
    const me = room.players.find((p) => p.id === myId);
    const allReady = room.players.length > 0 && room.players.every((p) => !p.connected || p.ready);

    const readyBtn = document.getElementById('btn-toggle-ready');
    readyBtn.textContent = me && me.ready ? 'Cancel Ready' : '✅ Ready Up';

    const startBtn = document.getElementById('btn-start-game');
    startBtn.classList.toggle('hidden', !isHost);
    startBtn.disabled = !allReady;

    const waiting = document.getElementById('lobby-waiting');
    if (allReady) {
      waiting.textContent = isHost ? 'Everyone is ready — start when you are!' : 'Waiting for the host to start the game…';
    } else {
      waiting.textContent = 'Waiting for everyone to be ready…';
    }

    maybeShowSoloPrompt();
    startFactoidRotator();
  }

  function applyLobbyState(updatedRoom) {
    room = updatedRoom;
    renderLobby();
    showScreen('lobby');
  }

  document.getElementById('btn-toggle-ready').addEventListener('click', () => {
    const me = room.players.find((p) => p.id === myId);
    const nextReady = !(me && me.ready);
    socket.emit('set_ready', { ready: nextReady }, (res) => {
      if (!res.ok) toast(res.error);
    });
  });

  document.getElementById('btn-start-game').addEventListener('click', () => {
    socket.emit('start_game', {}, (res) => {
      if (!res.ok) toast(res.error);
    });
  });

  document.getElementById('btn-copy-code').addEventListener('click', async () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${room.roomCode}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Invite link copied!');
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
    socket.emit('set_ready', { ready: true }, (res) => {
      if (!res.ok) return toast(res.error);
      socket.emit('start_game', {}, (res2) => {
        if (!res2.ok) toast(res2.error);
      });
    });
  });

  // ---------- LOBBY FACTOIDS ----------
  function startFactoidRotator() {
    const box = document.getElementById('lobby-factoid');
    const textEl = document.getElementById('lobby-factoid-text');
    const facts = window.SURVEY_SCRAMBLE_FACTOIDS || [];
    if (factoidInterval || !facts.length) return;

    let index = Math.floor(Math.random() * facts.length);
    textEl.textContent = facts[index];
    box.classList.remove('hidden');

    factoidInterval = setInterval(() => {
      textEl.classList.add('fade');
      setTimeout(() => {
        index = (index + 1) % facts.length;
        textEl.textContent = facts[index];
        textEl.classList.remove('fade');
      }, 400);
    }, 12000);
  }

  function stopSoloPromptAndFactoid() {
    clearInterval(factoidInterval);
    factoidInterval = null;
    document.getElementById('lobby-solo-hint').classList.add('hidden');
  }

  // ---------- SHARED: room_update (roster / ready / leaderboard changes, and play-again resets) ----------
  socket.on('room_update', (updatedRoom) => {
    room = updatedRoom;
    if (room.state === 'lobby') {
      renderLobby();
      showScreen('lobby');
    } else if (screens.game.classList.contains('active')) {
      renderLeaderboard(document.getElementById('game-leaderboard'), room.players);
    } else if (screens.scoring.classList.contains('active')) {
      renderLeaderboard(document.getElementById('scoring-leaderboard'), room.players);
    }
  });

  // ---------- GAME ----------
  const guessForm = document.getElementById('guess-form');
  const guessInput = document.getElementById('input-guess');
  const guessFeedback = document.getElementById('guess-feedback');

  function applyRoundStarted(updatedRoom) {
    room = updatedRoom;
    guessInput.value = '';
    guessFeedback.textContent = '';
    guessFeedback.className = 'guess-feedback';
    document.getElementById('game-round-number').textContent = room.round.roundNumber;
    document.getElementById('game-total-rounds').textContent = room.totalRounds;
    document.getElementById('game-emoji').textContent = room.round.emoji;
    renderMyScore();
    renderAnswerBoard(document.getElementById('answer-board'), room.round, false);
    renderLeaderboard(document.getElementById('game-leaderboard'), room.players);
    showScreen('game');
    guessInput.focus();
    startTimer(room.round.endsAt);
  }

  socket.on('round_started', applyRoundStarted);

  guessForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const guess = guessInput.value;
    if (!guess.trim()) return;
    socket.emit('submit_guess', { guess }, (res) => {
      if (!res.ok) return toast(res.error);
      const outcome = res.outcome;
      if (outcome.result === 'correct') {
        guessFeedback.textContent = `✅ "${outcome.keyword}" — +${outcome.points} points!`;
        guessFeedback.className = 'guess-feedback correct';
        // The board itself updates from the room-wide guess_correct broadcast
        // (which also reaches this tab), so nothing to render here directly.
      } else if (outcome.result === 'already-revealed') {
        const who = outcome.revealedBy ? outcome.revealedBy.username : 'someone';
        guessFeedback.textContent = `${who} already guessed "${outcome.keyword}".`;
        guessFeedback.className = 'guess-feedback info';
      } else if (outcome.result === 'no-match') {
        guessFeedback.textContent = `Not in the top 10. Try again!`;
        guessFeedback.className = 'guess-feedback wrong';
      }
      // Clear on every outcome except a fresh correct guess still visible in
      // the board — an incorrect/duplicate guess shouldn't sit there wasting
      // the player's time re-deleting it before their next attempt.
      guessInput.value = '';
      guessInput.focus();
    });
  });

  // Shared board — a correct guess from any player reveals the keyword (and
  // who got it) for the whole room, and takes it off the table for everyone.
  socket.on('guess_correct', ({ rankIndex, keyword, points, revealedBy, players }) => {
    if (!room || !room.round) return;
    room.round.revealed[keyword] = { rankIndex, points, revealedBy };
    room.players = players;
    renderAnswerBoard(document.getElementById('answer-board'), room.round, false);
    renderLeaderboard(document.getElementById('game-leaderboard'), room.players);
    renderMyScore();
  });

  function renderMyScore() {
    const me = room.players.find((p) => p.id === myId);
    document.getElementById('game-my-score').textContent = me ? me.score : 0;
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

    document.getElementById('scoring-title').textContent = isFinal
      ? 'Final Round Results'
      : `Round ${room.round.roundNumber} Results`;
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

  socket.on('round_ended', applyRoundEnded);

  document.getElementById('btn-next-round').addEventListener('click', () => {
    socket.emit('next_round', {}, (res) => {
      if (!res.ok) toast(res.error);
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
          score.textContent = `best ${entry.bestScore} · ${entry.gamesPlayed} games`;
          li.appendChild(name);
          li.appendChild(score);
          listEl.appendChild(li);
        });
      })
      .catch(() => { listEl.innerHTML = ''; });
  }

  document.getElementById('btn-play-again').addEventListener('click', () => {
    socket.emit('play_again', {}, (res) => {
      if (!res.ok) toast(res.error);
    });
  });

  document.getElementById('btn-go-home').addEventListener('click', () => {
    socket.emit('leave_room', {}, () => {
      clearSession();
      room = null;
      showScreen('login');
      usernameInput.value = '';
      roomCodeInput.value = '';
    });
  });

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
        name.textContent = p.username + (p.id === myId ? ' (you)' : '');
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
    const revealedByRank = new Array(10).fill(null);
    Object.entries(round.revealed || {}).forEach(([keyword, info]) => {
      revealedByRank[info.rankIndex] = { keyword, ...info };
    });

    for (let rank = 0; rank < 10; rank++) {
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

  socket.on('connect_error', () => toast('Connection error — retrying…'));
})();
