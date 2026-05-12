// Wallet connect stub for Phase 3
export function showWalletConnect() {
  const statusDiv = document.getElementById('status');
  
  if (statusDiv) {
    statusDiv.innerHTML = `
      <div style="background: rgba(0,255,0,0.1); padding: 15px; border-radius: 12px; color: white; font-family: sans-serif;">
        <h3>🔗 Connect Wallet for Power-Ups</h3>
        <p style="margin: 10px 0;">Stake $SMF tokens to unlock special abilities!</p>
        <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 8px; margin: 10px 0;">
          <p style="color: #ccc; font-size: 12px;">📱 Wallet connection coming soon...</p>
          <p style="color: #ccc;">This will connect to Phantom/Backpack</p>
          <p style="color: #ccc;">Stake $SMF for temporary power-ups</p>
        </div>
        <button onclick="hideWalletConnect()" style="margin-top: 10px; background: #13ef95; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">
          Close
        </button>
      </div>
    `;
  }
}

export function hideWalletConnect() {
  const statusDiv = document.getElementById('status');
  if (statusDiv) {
    statusDiv.innerHTML = '';
  }
}
