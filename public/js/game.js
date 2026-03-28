(() => {
  // Get params
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get('room');
  const playerName = sessionStorage.getItem('playerName');

  if (!roomCode || !playerName) {
    window.location.href = '/';
    return;
  }

  // State
  let myIndex = parseInt(sessionStorage.getItem('playerIndex')) || 0;
  let currentView = null;
  let selectedIndices = new Set(); // indices into currentView.myHand
  let hasSubmitted = false;
  let playerNames = [];
  let showingResult = false; // true while round result animation is playing
  let pendingGameUpdate = null; // queued game-update during result animation
  let pendingGameOver = null; // queued game-over during result animation
  let timerInterval = null; // client-side timer display interval
  let timerEndTime = null; // when the current timer expires

  // Init socket
  SocketClient.init();

  // Join room
  SocketClient.emit('join-room', { roomCode, playerName });

  // Setup room code display
  const roomCodeTop = document.getElementById('room-code-top');
  roomCodeTop.textContent = `Room: ${roomCode}`;
  roomCodeTop.onclick = () => {
    navigator.clipboard.writeText(roomCode);
    roomCodeTop.textContent = 'Copied!';
    setTimeout(() => { roomCodeTop.textContent = `Room: ${roomCode}`; }, 1000);
  };

  // Show waiting screen
  Renderer.showScreen('waiting');

  // === Socket Events ===

  SocketClient.on('room-joined', (data) => {
    myIndex = data.playerIndex;
    playerNames = data.players;
    Renderer.renderWaitingRoom(roomCode, data.players, myIndex);
    if (data.reconnected) {
      // Will receive game-update next
    }
  });

  SocketClient.on('player-joined', (data) => {
    playerNames = data.players;
    Renderer.renderWaitingRoom(roomCode, data.players, myIndex);
  });

  SocketClient.on('player-left', (data) => {
    playerNames = data.players;
    Renderer.renderWaitingRoom(roomCode, data.players, myIndex);
  });

  SocketClient.on('game-start', (data) => {
    playerNames = data.players;
    Renderer.showScreen('game');
    Renderer.hideResultOverlay();
    Renderer.hideGameOver();
    selectedIndices.clear();
    hasSubmitted = false;
    showingResult = false;
    pendingGameUpdate = null;
    pendingGameOver = null;
  });

  SocketClient.on('game-update', (data) => {
    // Queue update if result animation is playing
    if (showingResult) {
      pendingGameUpdate = data;
      return;
    }
    applyGameUpdate(data);
  });

  function applyGameUpdate(data) {
    // Clear selections if round changed (e.g. on reconnect)
    if (currentView && data.roundNumber !== currentView.roundNumber) {
      selectedIndices.clear();
      hasSubmitted = false;
    }

    currentView = data;
    playerNames = data.playerNames || playerNames;
    Renderer.showScreen('game');

    document.getElementById('round-number').textContent = data.roundNumber;
    Renderer.renderScoreboard(data.players, playerNames, data.myIndex);
    Renderer.renderTable(data.players, playerNames, data.myIndex);

    // Only re-render hand if not submitted
    if (!hasSubmitted) {
      renderMyHand(data.myHand);
    }

    updateSubmitButton(data);
  }

  SocketClient.on('round-result', (result) => {
    hasSubmitted = false;
    selectedIndices.clear();
    stopTimer();
    showingResult = true;
    playerNames = result.playerNames || playerNames;
    Renderer.renderRoundResult(result, playerNames, myIndex, () => {
      // Called when user clicks continue
      showingResult = false;
      if (pendingGameOver) {
        const data = pendingGameOver;
        pendingGameOver = null;
        Renderer.hideResultOverlay();
        Renderer.renderGameOver(data.winnerIndices || [], data.winnerNames || [], data.draw, data.wins, playerNames, myIndex);
      } else if (pendingGameUpdate) {
        const data = pendingGameUpdate;
        pendingGameUpdate = null;
        applyGameUpdate(data);
      }
    });
  });

  SocketClient.on('game-over', (data) => {
    if (showingResult) {
      // Queue - will be shown after round result continue
      pendingGameOver = data;
      return;
    }
    Renderer.hideResultOverlay();
    Renderer.renderGameOver(data.winnerIndices || [], data.winnerNames || [], data.draw, data.wins, playerNames, myIndex);
  });

  SocketClient.on('player-disconnected', (data) => {
    if (playerNames[data.playerIndex]) {
      playerNames[data.playerIndex].disconnected = true;
    }
    if (currentView) {
      Renderer.renderScoreboard(currentView.players, playerNames, myIndex);
    }
  });

  SocketClient.on('player-reconnected', (data) => {
    if (playerNames[data.playerIndex]) {
      playerNames[data.playerIndex].disconnected = false;
    }
    if (currentView) {
      Renderer.renderScoreboard(currentView.players, playerNames, myIndex);
    }
  });

  // === Timer ===
  function startTimer(durationMs) {
    stopTimer();
    timerEndTime = Date.now() + durationMs;
    const timerSection = document.getElementById('timer-section');
    timerSection.style.display = '';
    updateTimerDisplay();
    timerInterval = setInterval(updateTimerDisplay, 500);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    timerEndTime = null;
    const timerSection = document.getElementById('timer-section');
    if (timerSection) timerSection.style.display = 'none';
  }

  function updateTimerDisplay() {
    if (!timerEndTime) return;
    const remaining = Math.max(0, timerEndTime - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    const totalDuration = 30000;
    const pct = (remaining / totalDuration) * 100;

    const bar = document.getElementById('timer-bar');
    const text = document.getElementById('timer-text');

    bar.style.width = pct + '%';
    text.textContent = `残り ${seconds}秒`;

    bar.className = 'timer-bar';
    text.className = 'timer-text';
    if (seconds <= 5) {
      bar.classList.add('danger');
      text.classList.add('danger');
    } else if (seconds <= 10) {
      bar.classList.add('warning');
    }

    if (remaining <= 0) {
      stopTimer();
    }
  }

  SocketClient.on('timer-start', (data) => {
    if (!hasSubmitted) {
      startTimer(data.duration);
    } else {
      // Already submitted, hide timer
      stopTimer();
    }
  });

  SocketClient.on('error', (data) => {
    alert(data.message);
    // If error occurs before game starts (join failed), redirect to lobby
    if (!currentView) {
      window.location.href = '/';
    }
  });

  // === Hand & Submit ===

  function getSortedIndices(hand) {
    return hand.map((v, i) => i).sort((a, b) => hand[a] - hand[b]);
  }

  function renderMyHand(hand) {
    const el = document.getElementById('hand-cards');
    el.innerHTML = '';
    const sortedIndices = getSortedIndices(hand);

    for (const idx of sortedIndices) {
      const value = hand[idx];
      const card = Renderer.createCardElement(value);
      if (selectedIndices.has(idx)) {
        card.classList.add('selected');
      }
      card.addEventListener('click', () => toggleCard(idx));
      el.appendChild(card);
    }
    updateSelectedSum();
  }

  function toggleCard(idx) {
    if (hasSubmitted) return;

    if (selectedIndices.has(idx)) {
      selectedIndices.delete(idx);
    } else {
      selectedIndices.add(idx);
    }

    if (currentView) {
      renderMyHand(currentView.myHand);
    }
  }

  function updateSelectedSum() {
    if (!currentView) {
      document.getElementById('selected-sum').textContent = '0';
      return;
    }
    const sum = [...selectedIndices].reduce((a, idx) => a + currentView.myHand[idx], 0);
    document.getElementById('selected-sum').textContent = sum;
  }

  function updateSubmitButton(view) {
    const btn = document.getElementById('submit-btn');
    if (hasSubmitted || view.phase !== 'SELECTING') {
      btn.disabled = true;
      btn.textContent = hasSubmitted ? '提出済み - 待機中...' : 'カードを出す';
    } else {
      btn.disabled = false;
      btn.textContent = 'カードを出す';
    }
  }

  // Submit button
  document.getElementById('submit-btn').addEventListener('click', () => {
    if (hasSubmitted) return;
    hasSubmitted = true;
    stopTimer();
    const cards = [...selectedIndices].map(idx => currentView.myHand[idx]);
    SocketClient.emit('submit-cards', { cards });

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = '提出済み - 待機中...';

    document.querySelectorAll('#hand-cards .card').forEach(c => {
      c.classList.add('disabled');
    });
  });

  // Play again - any player can press this
  document.getElementById('play-again-btn').addEventListener('click', () => {
    SocketClient.emit('play-again');
    Renderer.hideGameOver();
    selectedIndices.clear();
    hasSubmitted = false;
  });

})();
