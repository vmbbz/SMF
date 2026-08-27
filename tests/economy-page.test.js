import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');

describe('Economy and Rewards public page', () => {
  test('is linked from the Help guide', () => {
    expect(html).toContain('id="btn-help-economy"');
    expect(html).toContain('ECONOMY &amp; REWARDS');
  });

  test('clearly separates approved design from live status', () => {
    expect(html).toContain('DESIGN APPROVED · TOKEN FLOWS NOT LIVE');
    expect(html).toContain('Wallet-bound public ranked matches, server-owned results, separate league ELO, and the three-charge Boosted cap are implemented.');
    expect(html).toContain('Boost purchases, creator-fee routing, $ANSEM actions, reward epochs, and token claims remain disabled.');
  });

  test('documents the exact creator fee and boost flows', () => {
    expect(html).toContain('50%<br>OPERATIONS');
    expect(html).toContain('50%<br>BUY $ANSEM');
    expect(html).toContain('100% GAME-TOKEN<br>REWARD RESERVE');
  });

  test('documents isolated skill and boosted leagues', () => {
    expect(html).toContain('Maximum 3 paid boost charges per player per match');
    expect(html).toContain('70% SKILL CHAMPIONSHIP');
    expect(html).toContain('30% BOOSTED');
  });

  test('states that USDC has no target role', () => {
    expect(html).toContain('USDC has no target role');
  });

  test('explains the complete earning journey without implying live payouts', () => {
    expect(html).toContain('Connect a Solana wallet, sign the free StickLash sign-in message');
    expect(html).toContain('Public matchmaking pairs online players.');
    expect(html).toContain('There is no token payment per win.');
    expect(html).toContain('It does not earn, accrue, reserve, or promise tokens.');
  });

  test('limits future reward candidates to public ranked human fights', () => {
    expect(html).toContain('Public Ranked · Skill');
    expect(html).toContain('Public Ranked · Boosted');
    expect(html).toContain('Private friend room');
    expect(html).toContain('AI, LLM, token, Endless, or waiting-room practice');
    expect(html).toContain('Chosen opponents make farming and collusion too easy');
  });

  test('separates implemented integrity from pending value paths', () => {
    expect(html).toContain('COMPETITIVE INTEGRITY IMPLEMENTED');
    expect(html).toContain('STILL REQUIRED BEFORE TOKEN REWARDS GO LIVE');
    expect(html).toContain('Server-owned final results and immutable ranked metadata');
    expect(html).toContain('Audited, explicit wallet claim path');
  });
});
