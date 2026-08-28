export const GAMEPLAY_PAUSE_EVENT = 'smf_gameplay_pause';
export const WALLET_ACTION_PAUSE_EVENT = 'smf_wallet_action_pause';

const DEFAULT_PAUSE_COPY = Object.freeze({
  status: 'COMPLETE WALLET ACTION',
  detail: 'Complete or cancel the open wallet flow to resume.',
});

const PAUSE_COPY_BY_REASON = Object.freeze({
  help_modal: Object.freeze({
    status: 'CLOSE HELP TO RESUME',
    detail: 'Fight state held safely while Help is open.',
  }),
  manual_pause: Object.freeze({
    status: 'FIGHT HELD',
    detail: 'Tap RESUME in the live-market bar to continue.',
  }),
  economy_page: Object.freeze({
    status: 'CLOSE REWARDS TO RESUME',
    detail: 'Fight state held while Rewards is open.',
  }),
  arena_status_page: Object.freeze({
    status: 'CLOSE ARENA STATUS TO RESUME',
    detail: 'Fight state held while Arena Status is open.',
  }),
  token_switch_confirm: Object.freeze({
    status: 'CONFIRM OR CANCEL TOKEN SWITCH',
    detail: 'Confirm the switch or cancel to resume.',
  }),
  boost_refill_required: Object.freeze({
    status: 'REFILL BOOSTS TO RESUME',
    detail: 'Complete or cancel the boost refill flow to resume.',
  }),
  purchase_boost_pack: Object.freeze({
    status: 'COMPLETE OR CANCEL BOOST PURCHASE',
    detail: 'Finish or cancel the purchase to resume.',
  }),
  wallet_connect: Object.freeze({
    status: 'CONNECT OR CLOSE WALLET',
    detail: 'Finish or cancel wallet connection to resume.',
  }),
  wallet_security_signin: Object.freeze({
    status: 'COMPLETE OR CANCEL SECURE SIGN-IN',
    detail: 'Sign or cancel the wallet request to resume.',
  }),
  wallet_security_required: Object.freeze({
    status: 'SECURE WALLET TO RESUME',
    detail: 'Complete or cancel the required wallet security flow.',
  }),
  wallet_modal: Object.freeze({
    status: 'CLOSE WALLET PANEL TO RESUME',
    detail: 'Complete or cancel the open wallet flow to resume.',
  }),
});

export function dispatchGameplayPause(paused, reason, target = window) {
  if (!target || typeof target.dispatchEvent !== 'function') return false;

  const CustomEventConstructor = target.CustomEvent || globalThis.CustomEvent;
  if (typeof CustomEventConstructor !== 'function') return false;

  target.dispatchEvent(new CustomEventConstructor(GAMEPLAY_PAUSE_EVENT, {
    detail: {
      paused: Boolean(paused),
      reason: String(reason || 'ui_overlay'),
    },
  }));
  return true;
}

export function getGameplayPauseCopy(reason) {
  return PAUSE_COPY_BY_REASON[String(reason || '')] || DEFAULT_PAUSE_COPY;
}

export function isManualPauseOnly(reasons) {
  return reasons instanceof Set
    && reasons.size === 1
    && reasons.has('manual_pause');
}
