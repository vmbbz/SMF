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
    expect(html).toContain('Boost purchases, creator-fee routing, $ANSEM actions, reward epochs, and token claims remain disabled');
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
});
