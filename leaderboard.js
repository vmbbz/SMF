// Simple persistent leaderboard for Phase 3
export class LeaderboardManager {
  constructor() {
    this.STORAGE_KEY = 'smf_leaderboard';
    this.MAX_ENTRIES = 10;
  }

  // Get leaderboard from localStorage
  getLeaderboard() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load leaderboard:', e);
      return [];
    }
  }

  // Save new fight result
  saveFight(winner, loser, winnerToken, loserToken) {
    const leaderboard = this.getLeaderboard();
    
    // Add or update player stats
    const updatePlayer = (token, isWinner) => {
      const existingEntry = leaderboard.find(entry => entry.token === token);
      
      if (existingEntry) {
        existingEntry.wins += isWinner ? 1 : 0;
        existingEntry.losses += isWinner ? 0 : 1;
        existingEntry.rating += isWinner ? 25 : -25;
      } else {
        leaderboard.push({
          token,
          wins: isWinner ? 1 : 0,
          losses: isWinner ? 0 : 1,
          rating: isWinner ? 1200 : 800,
          lastFight: new Date().toISOString()
        });
      }

      // Sort by rating (highest first) and keep top 10
      leaderboard.sort((a, b) => b.rating - a.rating);
      const topEntries = leaderboard.slice(0, this.MAX_ENTRIES);

      // Save to localStorage
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(topEntries));
      
      return topEntries;
    } catch (e) {
      console.error('Failed to save leaderboard:', e);
      return [];
    };
  }

  // Get top 10 players
  getTopPlayers() {
    return this.getLeaderboard();
  }

  // Clear leaderboard (for testing)
  clearLeaderboard() {
    localStorage.removeItem(this.STORAGE_KEY);
  }
}
