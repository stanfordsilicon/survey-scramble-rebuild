(() => {
  const socket = io();

  // The single source of truth for what this client currently knows about the
  // room — always replaced wholesale from the server's room_update / round_*
  // payloads rather than patched piecemeal, so the UI never drifts from the
  // authoritative game state.
  let room = null;
  let myId = null;
  let timerInterval = null;

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
  }

  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  socket.on('connect', () => {
    myId = socket.id;
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
    loginInviteHint.textContent = `You've been invited to room ${roomCodeInput.value} — enter a name and join!`;
    loginInviteHint.classList.remove('hidden');
    usernameInput.focus();
  }

  document.getElementById('btn-create-room').addEventListener('click', () => {
    loginError.classList.add('hidden');
    socket.emit('create_room', { username: usernameInput.value }, (res) => {
      if (!res.ok) return showLoginError(res.error);
      room = res.room;
      renderLobby();
      showScreen('lobby');
    });
  });

  document.getElementById('btn-join-room').addEventListener('click', () => {
    loginError.classList.add('hidden');
    socket.emit(
      'join_room',
      { username: usernameInput.value, roomCode: roomCodeInput.value },
      (res) => {
        if (!res.ok) return showLoginError(res.error);
        room = res.room;
        renderLobby();
        showScreen('lobby');
      }
    );
  });

  function showLoginError(msg) {
    loginError.textContent = msg || 'Something went wrong.';
    loginError.classList.remove('hidden');
  }

  // ---------- LOBBY ----------
  function renderLobby() {
    document.getElementById('lobby-room-code').textContent = room.roomCode;

    const list = document.getElementById('lobby-player-list');
    list.innerHTML = '';
    room.players.forEach((p) => {
      const li = document.createElement('li');
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
    const allReady = room.players.length > 0 && room.players.every((p) => p.ready);

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

  // ---------- SHARED: room_update (lobby roster / leaderboard changes) ----------
  socket.on('room_update', (updatedRoom) => {
    room = updatedRoom;
    if (room.state === 'lobby') {
      renderLobby();
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

  socket.on('round_started', (updatedRoom) => {
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
  });

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
        guessInput.value = '';
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
  socket.on('round_ended', (updatedRoom) => {
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
  });

  document.getElementById('btn-next-round').addEventListener('click', () => {
    socket.emit('next_round', {}, (res) => {
      if (!res.ok) toast(res.error);
    });
  });

  document.getElementById('btn-to-final').addEventListener('click', () => {
    renderLeaderboard(document.getElementById('final-leaderboard'), room.players);
    showScreen('final');
  });

  document.getElementById('btn-go-home').addEventListener('click', () => {
    socket.emit('leave_room', {}, () => {
      room = null;
      showScreen('login');
      usernameInput.value = '';
      roomCodeInput.value = '';
    });
  });

  // ---------- SHARED RENDER HELPERS ----------
  function renderPlayerBadge(player) {
    const badge = document.createElement('span');
    badge.className = 'player-badge';
    badge.style.backgroundColor = player.color || '#999';
    badge.textContent = (player.username || '?').trim().charAt(0).toUpperCase() || '?';
    badge.title = player.username;
    return badge;
  }

  function renderLeaderboard(listEl, players) {
    listEl.innerHTML = '';
    [...players]
      .sort((a, b) => b.score - a.score)
      .forEach((p) => {
        const li = document.createElement('li');
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
