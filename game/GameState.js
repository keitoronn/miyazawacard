const { INITIAL_HAND, WINS_TO_WIN } = require('./constants');

class GameState {
  constructor(playerCount) {
    this.phase = 'SELECTING';
    this.playerCount = playerCount;
    this.hands = {};
    this.submissions = {};
    this.roundNumber = 1;
    this.wins = {};
    this.roundHistory = [];

    for (let i = 0; i < playerCount; i++) {
      this.hands[i] = [...INITIAL_HAND];
      this.submissions[i] = null;
      this.wins[i] = 0;
    }
  }

  submitCards(playerIndex, cards) {
    if (this.phase !== 'SELECTING') {
      return { error: 'Not in selecting phase' };
    }
    if (this.submissions[playerIndex] !== null) {
      return { error: 'Already submitted' };
    }

    // Validate cards are in hand
    const handCopy = [...this.hands[playerIndex]];
    for (const card of cards) {
      const idx = handCopy.indexOf(card);
      if (idx === -1) {
        return { error: `Card ${card} not in hand` };
      }
      handCopy.splice(idx, 1);
    }

    this.submissions[playerIndex] = cards;

    const allSubmitted = Object.values(this.submissions).every(s => s !== null);
    return { allSubmitted };
  }

  resolveRound() {
    const plays = {};
    const sums = {};

    for (let i = 0; i < this.playerCount; i++) {
      plays[i] = [...this.submissions[i]];
      sums[i] = this.submissions[i].reduce((a, b) => a + b, 0);
    }

    // Remove played cards from hands
    for (let i = 0; i < this.playerCount; i++) {
      for (const card of this.submissions[i]) {
        const idx = this.hands[i].indexOf(card);
        if (idx !== -1) {
          this.hands[i].splice(idx, 1);
        }
      }
    }

    // Determine winner (unique highest sum)
    const maxSum = Math.max(...Object.values(sums));
    const topPlayers = [];
    for (let i = 0; i < this.playerCount; i++) {
      if (sums[i] === maxSum) topPlayers.push(i);
    }

    let winnerIndex = null;
    if (topPlayers.length === 1) {
      winnerIndex = topPlayers[0];
      this.wins[winnerIndex] += 1;
    }

    // Determine stealer (unique 2nd place) - only when there IS a winner
    const uniqueSums = [...new Set(Object.values(sums))].sort((a, b) => b - a);
    let stealerIndex = null;
    let stolenCard = null;
    if (winnerIndex !== null && uniqueSums.length >= 2) {
      const secondSum = uniqueSums[1];
      const secondPlayers = [];
      for (let i = 0; i < this.playerCount; i++) {
        if (sums[i] === secondSum) secondPlayers.push(i);
      }
      if (secondPlayers.length === 1) {
        stealerIndex = secondPlayers[0];
      }
    }

    // Auto-steal: random card from ALL played cards
    if (stealerIndex !== null) {
      const allPlayedCards = [];
      for (let i = 0; i < this.playerCount; i++) {
        allPlayedCards.push(...plays[i]);
      }
      if (allPlayedCards.length > 0) {
        const randomIdx = Math.floor(Math.random() * allPlayedCards.length);
        stolenCard = allPlayedCards[randomIdx];
        this.hands[stealerIndex].push(stolenCard);
      }
    }

    const roundResult = {
      round: this.roundNumber,
      plays,
      sums,
      winnerIndex,
      stealerIndex,
      stolenCard
    };

    this.roundHistory.push(roundResult);

    // Check 3-win game over
    const gameWinner = this.checkGameOver();
    if (gameWinner !== null) {
      this.phase = 'GAME_OVER';
      return { roundResult, gameOver: true, gameWinner };
    }

    // Check if all hands are empty
    if (this.allHandsEmpty()) {
      this.phase = 'GAME_OVER';
      const emptyResult = this.getHandsEmptyResult();
      return { roundResult, gameOver: true, gameWinners: emptyResult.winners, draw: emptyResult.draw };
    }

    // Advance to next round
    this.advanceToNextRound();
    return { roundResult, nextRound: true };
  }

  advanceToNextRound() {
    this.roundNumber++;
    this.phase = 'SELECTING';
    for (let i = 0; i < this.playerCount; i++) {
      this.submissions[i] = null;
    }
  }

  checkGameOver() {
    for (let i = 0; i < this.playerCount; i++) {
      if (this.wins[i] >= WINS_TO_WIN) {
        return i;
      }
    }
    return null;
  }

  getHandsEmptyResult() {
    const maxWins = Math.max(...Object.values(this.wins));
    const winners = [];
    for (let i = 0; i < this.playerCount; i++) {
      if (this.wins[i] === maxWins) winners.push(i);
    }
    if (maxWins === 0) {
      return { winners: [], draw: true };
    }
    return { winners, draw: false };
  }

  allHandsEmpty() {
    for (let i = 0; i < this.playerCount; i++) {
      if (this.hands[i].length > 0) return false;
    }
    return true;
  }

  getViewForPlayer(playerIndex) {
    const players = [];
    for (let i = 0; i < this.playerCount; i++) {
      players.push({
        wins: this.wins[i],
        handSize: this.hands[i].length,
        hasSubmitted: this.submissions[i] !== null
      });
    }

    return {
      phase: this.phase,
      myIndex: playerIndex,
      myHand: [...this.hands[playerIndex]],
      roundNumber: this.roundNumber,
      players,
      roundHistory: this.roundHistory
    };
  }
}

module.exports = GameState;
