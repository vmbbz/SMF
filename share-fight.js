// Shareable fight links - generate unique shareable URLs
const CANONICAL_SHARE_ORIGIN = 'https://sticklash.fun';

function getShareBaseUrl() {
  const configured = window.__SMF_PUBLIC_ORIGIN || window.__SMF_SHARE_ORIGIN;
  if (configured) {
    try { return new URL(configured).origin; } catch {}
  }
  return CANONICAL_SHARE_ORIGIN;
}

export function generateShareableFightLink(playerToken, opponentToken) {
  // Create unique fight ID from timestamps
  const fightId = Date.now().toString(36);
  
  // Build shareable URL with fight data
  const baseUrl = getShareBaseUrl();
  const shareUrl = `${baseUrl}/?fight=${fightId}&p1=${playerToken || 'player'}&p2=${opponentToken}`;
  
  return { fightId, shareUrl };
}

// Update UI to show share link after victory
export function showShareableLink(fightId) {
  const shareLink = `${getShareBaseUrl()}/?fight=${fightId}`;
  const statusDiv = document.getElementById('status');
  
  if (statusDiv) {
    statusDiv.innerHTML = `
      <div style="background: rgba(0,255,0,0.1); padding: 10px; border-radius: 8px; margin-top: 10px;">
        <strong>🔗 Share Fight Link:</strong><br>
        <a href="${shareLink}" target="_blank" style="color: #13ef95; text-decoration: none;">
          ${shareLink}
        </a><br>
        <small style="color: #ccc;">Anyone can click to watch your battle!</small>
      </div>
    `;
  }
}
