import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

describe('LitRes checkout guidance', () => {
  it('keeps the browser-platform skill strict about SBP defaults', async () => {
    const skill = await readRepoFile('openclaw/skill-template/SKILL.md');

    expect(skill).toContain('запрещено продолжать через `СБП` / `SBP`, если пользователь явно не просил `СБП`');
    expect(skill).toContain('default-выбор `СБП` считается блокирующим состоянием');
    expect(skill).toContain('LitRes pre-submit guard');
    expect(skill).toContain('paymentContext.paymentMethod=sbp');
    expect(skill).toContain('paymentContext.paymentSystem=sbersbp');
    expect(skill).toContain('Для обычных задач покупки на LitRes, где пользователь не просил `СБП`');
    expect(skill).not.toContain('prioritize the `SberPay` branch unless the user explicitly asks for `СБП`');
  });

  it('keeps browser-platform JSON handling safe for OpenClaw exec', async () => {
    const skill = await readRepoFile('openclaw/skill-template/SKILL.md');

    expect(skill).toContain('Do not pipe `browser-platform --json` output');
    expect(skill).toContain('never use `browser-platform ... --json | python3 - <<');
    expect(skill).toContain('Do not rerun `session open` only to extract `sessionId`');
    expect(skill).toContain('open the search URL directly');
  });

  it('keeps LitRes pack notes aligned with the hard SBP guard', async () => {
    const checkout = await readRepoFile('site-packs/litres/checkout.md');
    const instructions = await readRepoFile('site-packs/litres/instructions.md');

    for (const content of [checkout, instructions]) {
      expect(content).toContain('если пользователь явно не просил `СБП`');
      expect(content).toContain('default-выбор `СБП` считается блокирующим состоянием');
      expect(content).toContain('LitRes pre-submit guard');
      expect(content).toContain('paymentContext.paymentMethod=sbp');
      expect(content).toContain('paymentContext.paymentSystem=sbersbp');
      expect(content).not.toContain('prioritize the `SberPay` branch unless the user explicitly asks for `СБП`');
    }
  });
});
