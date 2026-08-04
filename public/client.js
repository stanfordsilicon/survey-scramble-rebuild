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
      li.textContent = p.username + (p.id === room.hostId ? ' (host)' : '');
      list.appendChild(li);
    });

    const isHost = room.hostId === myId;
    document.getElementById('btn-start-game').classList.toggle('hidden', !isHost);
    document.getElementById('lobby-waiting').classList.toggle('hidden', isHost);
  }

  document.getElementById('btn-start-game').addEventListener('click', () => {
    socket.emit('start_game', {}, (res) => {
      if (!res.ok) toast(res.error);
    });
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
      } else if (outcome.result === 'already-revealed') {
        guessFeedback.textContent = `Someone already guessed "${outcome.keyword}".`;
        guessFeedback.className = 'guess-feedback info';
      } else if (outcome.result === 'no-match') {
        guessFeedback.textContent = `Not in the top 10. Try again!`;
        guessFeedback.className = 'guess-feedback wrong';
      }
    });
  });

  socket.on('guess_correct', ({ rankIndex, keyword, points, revealedBy, players }) => {
    if (!room || !room.round) return;
    room.round.revealed[keyword] = { rankIndex, revealedBy, points };
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
  function renderLeaderboard(listEl, players) {
    listEl.innerHTML = '';
    [...players]
      .sort((a, b) => b.score - a.score)
      .forEach((p) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = p.username + (p.id === myId ? ' (you)' : '');
        const score = document.createElement('span');
        score.className = 'score';
        score.textContent = p.score;
        li.appendChild(name);
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
      boardEl.appendChild(slot);
    }
  }

  socket.on('connect_error', () => toast('Connection error — retrying…'));
})();
