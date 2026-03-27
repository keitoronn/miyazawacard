const Renderer = {
  // Helper to safely escape HTML
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  createCardElement(value, extraClasses = '') {
    const div = document.createElement('div');
    div.className = `card card-${value} ${extraClasses}`.trim();
    div.textContent = value;
    div.dataset.value = value;
    return div;
  },

  createCardBack() {
    const div = document.createElement('div');
    div.className = 'card-back';
    return div;
  },

  renderWaitingRoom(roomCode, players, myIndex) {
    const codeEl = document.getElementById('waiting-room-code');
    codeEl.textContent = roomCode;
    codeEl.onclick = () => {
      navigator.clipboard.writeText(roomCode);
      codeEl.style.color = '#4caf50';
      setTimeout(() => { codeEl.style.color = ''; }, 1000);
    };

    const slotsEl = document.getElementById('player-slots');
    slotsEl.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const slot = document.createElement('div');
      const player = players.find(p => p.index === i);
      slot.className = 'player-slot' +
        (player ? ' filled' : '') +
        (player && player.index === myIndex ? ' is-me' : '');

      const label = document.createElement('div');
      label.className = 'slot-label';
      label.textContent = `Player ${i + 1}`;

      const nameEl = document.createElement('div');
      if (player) {
        nameEl.className = 'slot-name';
        nameEl.textContent = player.name + (player.index === myIndex ? ' (あなた)' : '');
      } else {
        nameEl.className = 'slot-empty';
        nameEl.textContent = '待機中...';
      }

      slot.appendChild(label);
      slot.appendChild(nameEl);
      slotsEl.appendChild(slot);
    }
  },

  renderScoreboard(players, playerNames, myIndex) {
    const el = document.getElementById('scoreboard');
    el.innerHTML = '';
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const name = playerNames[i] ? playerNames[i].name : `Player ${i + 1}`;
      const item = document.createElement('div');
      item.className = 'score-item' +
        (i === myIndex ? ' is-me' : '') +
        (playerNames[i] && playerNames[i].disconnected ? ' disconnected' : '');

      const nameDiv = document.createElement('div');
      nameDiv.className = 'score-name';
      nameDiv.textContent = name + (i === myIndex ? ' (あなた)' : '');

      const winsDiv = document.createElement('div');
      winsDiv.className = 'score-wins';
      winsDiv.textContent = '★'.repeat(p.wins) + '☆'.repeat(Math.max(0, 3 - p.wins));

      item.appendChild(nameDiv);
      item.appendChild(winsDiv);

      if (p.hasSubmitted && !p.revealed) {
        const subDiv = document.createElement('div');
        subDiv.className = 'score-submitted';
        subDiv.textContent = '提出済';
        item.appendChild(subDiv);
      }

      el.appendChild(item);
    }
  },

  renderTable(players, playerNames, myIndex) {
    const el = document.getElementById('table-area');
    el.innerHTML = '';
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const name = playerNames[i] ? playerNames[i].name : `Player ${i + 1}`;
      const zone = document.createElement('div');
      zone.className = 'player-zone' + (i === myIndex ? ' is-me' : '');

      const nameDiv = document.createElement('div');
      nameDiv.className = 'zone-name';
      nameDiv.textContent = name + (i === myIndex ? ' (あなた)' : '');

      const cardsDiv = document.createElement('div');
      cardsDiv.className = 'zone-cards';

      const statusDiv = document.createElement('div');
      statusDiv.className = 'zone-status';
      if (p.hasSubmitted) {
        statusDiv.style.color = '#4caf50';
        statusDiv.textContent = '提出済み';
      } else {
        statusDiv.innerHTML = '選択中<span class="waiting-dots"></span>';
      }
      cardsDiv.appendChild(statusDiv);

      zone.appendChild(nameDiv);
      zone.appendChild(cardsDiv);
      el.appendChild(zone);
    }
  },

  renderRoundResult(roundResult, playerNames, myIndex, onContinue) {
    const overlay = document.getElementById('result-overlay');
    const titleEl = document.getElementById('result-title');
    const gridEl = document.getElementById('result-grid');
    const stealInfoEl = document.getElementById('steal-info');
    const continueBtn = document.getElementById('result-continue-btn');
    const self = this;

    // Reset everything
    titleEl.textContent = '';
    titleEl.className = 'overlay-title';
    titleEl.style.visibility = 'hidden';
    gridEl.innerHTML = '';
    stealInfoEl.style.display = 'none';
    stealInfoEl.innerHTML = '';
    continueBtn.style.display = 'none';

    // Build rows - cards/sum hidden initially
    const rows = [];
    for (let i = 0; i < playerNames.length; i++) {
      const name = playerNames[i].name;
      const cards = roundResult.plays[i] || [];
      const sum = roundResult.sums[i];

      const row = document.createElement('div');
      row.className = 'result-row';

      const nameDiv = document.createElement('div');
      nameDiv.className = 'result-name';
      nameDiv.textContent = name + (i === myIndex ? ' (あなた)' : '');

      const cardsDiv = document.createElement('div');
      cardsDiv.className = 'result-cards';
      const hiddenSpan = document.createElement('span');
      hiddenSpan.className = 'card-hidden-text';
      hiddenSpan.textContent = '？？？';
      cardsDiv.appendChild(hiddenSpan);

      const sumDiv = document.createElement('div');
      sumDiv.className = 'result-sum';
      sumDiv.textContent = '';

      row.appendChild(nameDiv);
      row.appendChild(cardsDiv);
      row.appendChild(sumDiv);
      gridEl.appendChild(row);

      rows.push({ row, cardsDiv, sumDiv, cards, sum, index: i });
    }

    overlay.style.display = 'flex';

    // Sequentially reveal each player
    const REVEAL_DELAY = 800;

    function revealPlayer(r) {
      if (r >= rows.length) {
        showFinalResult();
        return;
      }
      const rData = rows[r];
      rData.cardsDiv.innerHTML = '';
      if (rData.cards.length > 0) {
        rData.cards.sort((a, b) => a - b).forEach(v => {
          rData.cardsDiv.appendChild(self.createCardElement(v, 'card-small reveal-card'));
        });
      } else {
        const noneSpan = document.createElement('span');
        noneSpan.style.color = '#666';
        noneSpan.textContent = 'なし';
        rData.cardsDiv.appendChild(noneSpan);
      }
      rData.sumDiv.textContent = rData.sum;
      rData.row.style.animation = 'revealRow 0.4s ease';

      setTimeout(() => revealPlayer(r + 1), REVEAL_DELAY);
    }

    function showFinalResult() {
      // Highlight winner/stealer rows
      for (const rData of rows) {
        if (rData.index === roundResult.winnerIndex) rData.row.classList.add('winner');
        if (rData.index === roundResult.stealerIndex) rData.row.classList.add('stealer');
      }

      // Show title
      if (roundResult.winnerIndex !== null) {
        const winnerName = playerNames[roundResult.winnerIndex].name;
        if (roundResult.winnerIndex === myIndex) {
          titleEl.textContent = 'あなたの勝ち！';
          titleEl.className = 'overlay-title win fade-in';
        } else {
          titleEl.textContent = `${winnerName} の勝ち！`;
          titleEl.className = 'overlay-title lose fade-in';
        }
      } else {
        titleEl.textContent = '引き分け（最大値が同数）';
        titleEl.className = 'overlay-title draw fade-in';
      }
      titleEl.style.visibility = 'visible';

      // Show steal info (random auto-steal)
      if (roundResult.stealerIndex !== null && roundResult.stolenCard !== null) {
        const stealerName = playerNames[roundResult.stealerIndex].name;
        const label = roundResult.stealerIndex === myIndex ? 'あなた' : stealerName;
        stealInfoEl.style.display = 'block';
        const p = document.createElement('p');
        p.style.cssText = 'color:#ffd700; margin:8px 0 4px;';
        p.className = 'fade-in';
        p.textContent = `🃏 ${label} がランダムで ${roundResult.stolenCard} を獲得！`;
        stealInfoEl.innerHTML = '';
        stealInfoEl.appendChild(p);
      }

      // Show continue button
      setTimeout(() => {
        continueBtn.style.display = 'inline-block';
        continueBtn.onclick = () => {
          self.hideResultOverlay();
          if (onContinue) onContinue();
        };
      }, 600);
    }

    // Start reveal sequence after initial pause
    setTimeout(() => revealPlayer(0), 500);
  },

  hideResultOverlay() {
    document.getElementById('result-overlay').style.display = 'none';
    document.getElementById('steal-info').style.display = 'none';
  },

  renderGameOver(winnerIndices, winnerNames, draw, wins, playerNames, myIndex) {
    const overlay = document.getElementById('gameover-overlay');
    const titleEl = document.getElementById('gameover-title');
    const scoresEl = document.getElementById('final-scores');

    if (draw) {
      titleEl.textContent = '引き分け！';
      titleEl.style.color = '#888';
    } else if (winnerIndices.includes(myIndex)) {
      titleEl.textContent = 'あなたの勝利！';
      titleEl.style.color = '#ffd700';
    } else if (winnerNames.length === 1) {
      titleEl.textContent = `${winnerNames[0]} の勝利！`;
      titleEl.style.color = '#e94560';
    } else {
      titleEl.textContent = `${winnerNames.join(' & ')} の勝利！`;
      titleEl.style.color = '#e94560';
    }

    scoresEl.innerHTML = '';
    for (let i = 0; i < playerNames.length; i++) {
      const row = document.createElement('div');
      row.className = 'final-score-row' +
        (winnerIndices.includes(i) ? ' winner' : '');

      const nameSpan = document.createElement('span');
      nameSpan.textContent = playerNames[i].name + (i === myIndex ? ' (あなた)' : '');

      const winsSpan = document.createElement('span');
      winsSpan.textContent = `${wins[i]} 勝`;

      row.appendChild(nameSpan);
      row.appendChild(winsSpan);
      scoresEl.appendChild(row);
    }

    overlay.style.display = 'flex';
  },

  hideGameOver() {
    document.getElementById('gameover-overlay').style.display = 'none';
  },

  showScreen(screenId) {
    document.getElementById('waiting-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'none';
    if (screenId === 'waiting') {
      document.getElementById('waiting-screen').style.display = '';
    } else if (screenId === 'game') {
      document.getElementById('game-screen').style.display = '';
    }
  }
};
