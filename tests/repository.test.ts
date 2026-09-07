import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Repository } from '../src/server/repository.js';
import { sqliteD1 } from './sqlite-d1.js';
const schema = (
  await Promise.all(
    ['0001_initial.sql', '0002_integrity_and_quotas.sql'].map((name) =>
      readFile(new URL(`../src/server/migrations/${name}`, import.meta.url), 'utf8'),
    ),
  )
).join('\n');
async function fixture(now = 1_000) {
  const db = await sqliteD1(schema);
  return new Repository(db, () => now);
}
describe('D1 repository (SQLite-compatible sql.js test adapter)', () => {
  it('atomically admits one concurrent guest and expires rooms', async () => {
    const repo = await fixture();
    await repo.createRoom('ABC234', 'pt_hostaaaaaaaa', 'hash');
    const results = await Promise.all([
      repo.claimGuest('ABC234', 'pt_guestaabbcc', 'a'),
      repo.claimGuest('ABC234', 'pt_guestbbccdd', 'b'),
    ]);
    expect(results.filter((x) => x === 'ok')).toHaveLength(1);
    expect(results).toContain('full');
  });
  it('orders isolated signals and preserves duplicate idempotency', async () => {
    const repo = await fixture();
    await repo.createRoom('ABC234', 'pt_hostaaaaaaaa', 'hash');
    await repo.claimGuest('ABC234', 'pt_guestaabbcc', 'hash2');
    expect(
      await repo.appendSignal(
        'ABC234',
        1,
        'prb_abcdefghijkl',
        'pt_hostaaaaaaaa',
        'pt_guestaabbcc',
        'message-0001',
        '{}',
      ),
    ).toBe(true);
    expect(
      await repo.appendSignal(
        'ABC234',
        1,
        'prb_abcdefghijkl',
        'pt_hostaaaaaaaa',
        'pt_guestaabbcc',
        'message-0001',
        '{}',
      ),
    ).toBe(false);
    expect(await repo.pollSignals('pt_guestaabbcc', 1, 'prb_abcdefghijkl', 0)).toHaveLength(1);
    expect(await repo.pollSignals('pt_guestaabbcc', 2, 'prb_abcdefghijkl', 0)).toHaveLength(0);
  });
  it('bounds append-only events and retention cleanup', async () => {
    const repo = await fixture();
    await repo.createRoom('ABC234', 'pt_hostaaaaaaaa', 'hash');
    await repo.registerRun('run_abcdefghijkl', 'pt_hostaaaaaaaa', null);
    const out = await repo.appendEvents(
      'run_abcdefghijkl',
      Array.from({ length: 100 }, (_, sequence) => ({ sequence, body: 'x'.repeat(30_000) })),
    );
    expect(out.accepted).toBeLessThan(100);
    expect(out.truncated).toBeGreaterThan(0);
  });
  it('removes guest state atomically so another guest can claim the slot', async () => {
    const repo = await fixture();
    await repo.createRoom('ABC234', 'pt_hostaaaaaaaa', 'host');
    await repo.claimGuest('ABC234', 'pt_guestaabbcc', 'old');
    const old = await repo.participant('pt_guestaabbcc', 'old');
    await repo.saveCapabilities(old!, '[]');
    expect(await repo.leaveRoom(old!)).toBe(true);
    expect(await repo.participant('pt_guestaabbcc', 'old')).toBeNull();
    expect(await repo.claimGuest('ABC234', 'pt_guestbbccdd', 'new')).toBe('ok');
    expect(await repo.participant('pt_guestbbccdd', 'new')).toMatchObject({ slot: 2 });
  });
  it('accounts concurrent unique events exactly without exceeding quotas', async () => {
    const repo = await fixture();
    await repo.createRoom('ABC234', 'pt_hostaaaaaaaa', 'hash');
    await repo.registerRun('run_abcdefghijkl', 'pt_hostaaaaaaaa', null);
    await Promise.all(
      Array.from({ length: 4 }, (_, worker) =>
        repo.appendEvents(
          'run_abcdefghijkl',
          Array.from({ length: 100 }, (_, index) => ({
            sequence: worker * 100 + index,
            body: 'x'.repeat(1_000),
          })),
        ),
      ),
    );
    const exported = (await repo.exportRuns())[0]!;
    const detail = await repo.runDetail('run_abcdefghijkl');
    expect(exported.event_count).toBe(detail!.events.length);
    expect(exported.event_bytes).toBe(detail!.events.length * 1_000);
    expect(exported.event_count).toBeLessThanOrEqual(5_000);
    expect(exported.event_bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  });
  it('cleans expired room and retention children without foreign-key failures', async () => {
    const db = await sqliteD1(schema);
    const repo = new Repository(db, () => 1_000);
    await repo.createRoom('ABC234', 'pt_hostaaaaaaaa', 'hash');
    await repo.claimGuest('ABC234', 'pt_guestaabbcc', 'guest');
    const issued = await repo.issueAttempt('ABC234', '[]', null);
    await repo.registerRun('run_abcdefghijkl', 'pt_hostaaaaaaaa', issued.id);
    await repo.appendEvents('run_abcdefghijkl', [{ sequence: 1, body: 'event' }]);
    const later = new Repository(db, () => 40 * 86_400_000);
    await later.cleanup();
    expect(await later.room('ABC234')).toBeNull();
    expect(await later.runDetail('run_abcdefghijkl')).toBeNull();
  });
  it('keeps a server-issued manifest stable until both room members acknowledge it', async () => {
    const repo = await fixture();
    await repo.createRoom('ABC234', 'pt_hostaaaaaaaa', 'host-hash');
    await repo.claimGuest('ABC234', 'pt_guestaabbcc', 'guest-hash');
    const issued = await repo.issueAttempt('ABC234', '[{"id":"profile-direct"}]', null);
    const attempt = await repo.attempt(issued.id);
    const host = await repo.participant('pt_hostaaaaaaaa', 'host-hash');
    const guest = await repo.participant('pt_guestaabbcc', 'guest-hash');
    expect(attempt).not.toBeNull();
    expect(host).not.toBeNull();
    expect(guest).not.toBeNull();
    await expect(repo.acknowledgeAttempt(attempt!, host!, '[{"id":"different"}]')).rejects.toThrow(
      'invalid acknowledgement',
    );
    expect(await repo.acknowledgeAttempt(attempt!, host!, attempt!.manifest_json)).toEqual({
      acknowledged: 1,
      paired: false,
    });
    expect(await repo.acknowledgeAttempt(attempt!, host!, attempt!.manifest_json)).toEqual({
      acknowledged: 1,
      paired: false,
    });
    expect(await repo.acknowledgeAttempt(attempt!, guest!, attempt!.manifest_json)).toEqual({
      acknowledged: 2,
      paired: true,
    });
  });
  it('issues one canonical live generation under concurrent host requests and links retries', async () => {
    const repo = await fixture();
    await repo.createRoom('ABC234', 'pt_hostaaaaaaaa', 'host-hash');
    await repo.claimGuest('ABC234', 'pt_guestaabbcc', 'guest-hash');
    const issued = await Promise.all(
      Array.from({ length: 4 }, () =>
        repo.issueAttempt('ABC234', '[{"id":"profile-direct"}]', null),
      ),
    );
    expect(new Set(issued.map((value) => value.id)).size).toBe(1);
    const retries = await Promise.all(
      Array.from({ length: 2 }, () =>
        repo.issueAttempt('ABC234', '[{"id":"profile-direct"}]', issued[0]!.id),
      ),
    );
    expect(new Set(retries.map((value) => value.id)).size).toBe(1);
    expect(retries[0]!.generation).toBe(2);
    expect((await repo.attempt(retries[0]!.id))?.previous_id).toBe(issued[0]!.id);
  });
});
