// Wallet connect stub for Phase 3 - Standalone Modal Popup
export function showWalletConnect() {
  let modal = document.getElementById('wallet-connect-panel');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'wallet-connect-panel';
    modal.className = 'screen hidden';
    modal.style.zIndex = '2100'; // Make sure it floats on top of everything
    document.body.appendChild(modal);
  }
  
  modal.innerHTML = `
    <div style="padding: 10px; color: white; font-family: inherit; text-align: center;">
      <h3 style="color: var(--neon-green); margin-bottom: 15px; font-size: 14px; letter-spacing: 1px;">🔗 CONNECT WALLET</h3>
      <p style="margin: 10px 0; font-size: 10px; line-height: 1.6; color: #ccc;">Stake $SMF tokens to unlock special abilities and temporary power-ups!</p>
      
      <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 15px; border-radius: 12px; margin: 15px 0; font-size: 10px; text-align: left; line-height: 1.8;">
        <p style="color: var(--neon-blue); font-weight: bold; margin-bottom: 5px; text-align: center;">🎮 POWER-UP FEATURES</p>
        <div style="color: #bbb; display: flex; flex-direction: column; gap: 4px;">
          <div>• Stake $SMF for temporary stat boosts</div>
          <div>• Connect Phantom / Backpack (coming soon)</div>
          <div>• Unlock premium characters and levels</div>
        </div>
      </div>
      
      <button class="premium-btn" onclick="window.hideWalletConnect()" style="margin-top: 10px; font-size: 10px; padding: 12px 20px; width: 100%;">
        CLOSE
      </button>
    </div>
  `;
  
  // Unhide modal
  modal.classList.remove('hidden');
}

export function hideWalletConnect() {
  const modal = document.getElementById('wallet-connect-panel');
  if (modal) {
    modal.classList.add('hidden');
  }
}
