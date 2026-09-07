import type { D1Database } from './db/types.js';
export type Room = {
  code: string;
  host_id: string;
  guest_id: string | null;
  expires_at: number;
  generation: number;
};
export type Participant = { id: string; room_code: string; slot: number };
export type Attempt = {
  id: string;
  room_code: string;
  generation: number;
  previous_id: string | null;
  manifest_json: string;
  created_at: number;
};
export class Repository {
  public constructor(
    private readonly db: D1Database,
    private readonly now: () => number = Date.now,
  ) {}
  async createRoom(code: string, participantId: string, tokenHash: string): Promise<void> {
    const now = this.now();
    await this.db.batch([
      this.db
        .prepare(
          'INSERT INTO rooms(code,created_at,updated_at,expires_at,host_id) VALUES(?,?,?,?,?)',
        )
        .bind(code, now, now, now + 900_000, participantId),
      this.db
        .prepare(
          'INSERT INTO participants(id,room_code,slot,token_hash,created_at) VALUES(?,?,?,?,?)',
        )
        .bind(participantId, code, 1, tokenHash, now),
    ]);
  }
  async room(code: string): Promise<Room | null> {
    return this.db
      .prepare('SELECT code,host_id,guest_id,expires_at,generation FROM rooms WHERE code=?')
      .bind(code)
      .first<Room>();
  }
  async roomStatus(code: string): Promise<{
    code: string;
    host_id: string;
    guest_id: string | null;
    generation: number;
    expires_at: number;
  } | null> {
    const room = await this.room(code);
    return room && room.expires_at > this.now() ? room : null;
  }
  async saveCapabilities(participant: Participant, endpoints: string): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO room_capabilities(room_code,participant_id,endpoints_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(room_code,participant_id) DO UPDATE SET endpoints_json=excluded.endpoints_json,updated_at=excluded.updated_at',
      )
      .bind(participant.room_code, participant.id, endpoints, this.now())
      .run();
  }
  async capabilities(
    code: string,
  ): Promise<Array<{ participant_id: string; endpoints_json: string }>> {
    return (
      await this.db
        .prepare('SELECT participant_id,endpoints_json FROM room_capabilities WHERE room_code=?')
        .bind(code)
        .all<{ participant_id: string; endpoints_json: string }>()
    ).results;
  }
  async claimGuest(
    code: string,
    participantId: string,
    tokenHash: string,
  ): Promise<'ok' | 'missing' | 'expired' | 'full'> {
    const now = this.now();
    // D1 batch is atomic.  Remove stale slot-2 state only while the room is
    // vacant, then claim and insert conditionally in the same batch.
    const changes = await this.db.batch([
      this.db
        .prepare(
          'DELETE FROM attempt_acks WHERE participant_id IN (SELECT id FROM participants WHERE room_code=? AND slot=2) AND EXISTS (SELECT 1 FROM rooms WHERE code=? AND guest_id IS NULL)',
        )
        .bind(code, code),
      this.db
        .prepare(
          'DELETE FROM room_capabilities WHERE room_code=? AND participant_id IN (SELECT id FROM participants WHERE room_code=? AND slot=2) AND EXISTS (SELECT 1 FROM rooms WHERE code=? AND guest_id IS NULL)',
        )
        .bind(code, code, code),
      this.db
        .prepare(
          'DELETE FROM signals WHERE room_code=? AND EXISTS (SELECT 1 FROM rooms WHERE code=? AND guest_id IS NULL)',
        )
        .bind(code, code),
      this.db
        .prepare(
          'DELETE FROM participants WHERE room_code=? AND slot=2 AND EXISTS (SELECT 1 FROM rooms WHERE code=? AND guest_id IS NULL)',
        )
        .bind(code, code),
      this.db
        .prepare(
          'UPDATE rooms SET guest_id=?,updated_at=?,expires_at=? WHERE code=? AND guest_id IS NULL AND expires_at>?',
        )
        .bind(participantId, now, now + 900_000, code, now),
      this.db
        .prepare(
          'INSERT INTO participants(id,room_code,slot,token_hash,created_at) SELECT ?,code,2,?,? FROM rooms WHERE code=? AND guest_id=?',
        )
        .bind(participantId, tokenHash, now, code, participantId),
    ]);
    if ((changes[5]?.meta.changes ?? 0) === 1) {
      return 'ok';
    }
    const room = await this.room(code);
    return !room ? 'missing' : room.expires_at <= now ? 'expired' : 'full';
  }
  async participant(id: string, hash: string): Promise<Participant | null> {
    return this.db
      .prepare('SELECT id,room_code,slot FROM participants WHERE id=? AND token_hash=?')
      .bind(id, hash)
      .first<Participant>();
  }
  async leaveRoom(participant: Participant): Promise<boolean> {
    const room = await this.room(participant.room_code);
    if (!room) return false;
    const now = this.now();
    if (participant.slot === 2) {
      const results = await this.db.batch([
        this.db.prepare('DELETE FROM attempt_acks WHERE participant_id=?').bind(participant.id),
        this.db
          .prepare('DELETE FROM room_capabilities WHERE participant_id=?')
          .bind(participant.id),
        this.db
          .prepare('DELETE FROM signals WHERE room_code=? AND (sender_id=? OR recipient_id=?)')
          .bind(room.code, participant.id, participant.id),
        this.db
          .prepare('DELETE FROM participants WHERE id=? AND room_code=? AND slot=2')
          .bind(participant.id, room.code),
        this.db
          .prepare(
            'UPDATE rooms SET guest_id=NULL,updated_at=?,expires_at=? WHERE code=? AND guest_id=?',
          )
          .bind(now, now + 900_000, room.code, participant.id),
      ]);
      return (results[4]?.meta.changes ?? 0) === 1;
    }
    await this.db
      .prepare('UPDATE rooms SET updated_at=?,expires_at=? WHERE code=?')
      .bind(now, now, room.code)
      .run();
    return true;
  }
  async issueAttempt(
    code: string,
    manifest: string,
    previous: string | null,
  ): Promise<{ id: string; generation: number; manifest: unknown }> {
    const room = await this.room(code);
    if (!room || room.expires_at <= this.now() || !room.guest_id)
      throw new Error('room is not paired');
    const current = room.generation ? await this.attemptForGeneration(code, room.generation) : null;
    // The ordinary endpoint is idempotent: concurrent host requests receive
    // the one canonical live generation rather than advancing it twice.
    if (!previous && current)
      return {
        id: current.id,
        generation: current.generation,
        manifest: JSON.parse(current.manifest_json),
      };
    if (previous) {
      const previousAttempt = await this.attempt(previous);
      if (
        !previousAttempt ||
        previousAttempt.room_code !== code ||
        previousAttempt.generation !== room.generation
      )
        throw new Error('invalid previous attempt');
    }
    const generation = room.generation + 1;
    const id = `att_${crypto.randomUUID().replaceAll('-', '')}`;
    const now = this.now();
    const claimed = await this.db
      .prepare(
        'UPDATE rooms SET generation=?,updated_at=?,expires_at=? WHERE code=? AND generation=? AND expires_at>?',
      )
      .bind(generation, now, now + 900_000, code, room.generation, now)
      .run();
    if ((claimed.meta.changes ?? 0) !== 1) {
      const canonical = await this.room(code);
      const attempt = canonical
        ? await this.attemptForGeneration(code, canonical.generation)
        : null;
      if (!previous && attempt)
        return {
          id: attempt.id,
          generation: attempt.generation,
          manifest: JSON.parse(attempt.manifest_json),
        };
      throw new Error('attempt generation conflict');
    }
    await this.db
      .prepare(
        'INSERT INTO attempts(id,room_code,generation,previous_id,manifest_json,created_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(id, code, generation, previous, manifest, now)
      .run();
    return { id, generation, manifest: JSON.parse(manifest) };
  }
  async attempt(id: string): Promise<Attempt | null> {
    return this.db
      .prepare(
        'SELECT id,room_code,generation,previous_id,manifest_json,created_at FROM attempts WHERE id=?',
      )
      .bind(id)
      .first<Attempt>();
  }
  async attemptForGeneration(code: string, generation: number): Promise<Attempt | null> {
    return this.db
      .prepare(
        'SELECT id,room_code,generation,previous_id,manifest_json,created_at FROM attempts WHERE room_code=? AND generation=?',
      )
      .bind(code, generation)
      .first<Attempt>();
  }
  async acknowledgeAttempt(
    attempt: Attempt,
    participant: Participant,
    manifest: string,
  ): Promise<{ acknowledged: number; paired: boolean }> {
    if (attempt.room_code !== participant.room_code || manifest !== attempt.manifest_json)
      throw new Error('invalid acknowledgement');
    await this.db
      .prepare(
        'INSERT OR IGNORE INTO attempt_acks(attempt_id,participant_id,manifest_json,acknowledged_at) VALUES(?,?,?,?)',
      )
      .bind(attempt.id, participant.id, manifest, this.now())
      .run();
    const count = await this.db
      .prepare('SELECT COUNT(*) AS count FROM attempt_acks WHERE attempt_id=?')
      .bind(attempt.id)
      .first<{ count: number }>();
    return { acknowledged: count?.count ?? 0, paired: (count?.count ?? 0) === 2 };
  }
  async attemptStatus(attempt: Attempt): Promise<{
    id: string;
    generation: number;
    previousAttemptId: string | null;
    manifest: unknown;
    acknowledged: number;
    paired: boolean;
  }> {
    const count = await this.db
      .prepare('SELECT COUNT(*) AS count FROM attempt_acks WHERE attempt_id=?')
      .bind(attempt.id)
      .first<{ count: number }>();
    const acknowledged = count?.count ?? 0;
    return {
      id: attempt.id,
      generation: attempt.generation,
      previousAttemptId: attempt.previous_id,
      manifest: JSON.parse(attempt.manifest_json),
      acknowledged,
      paired: acknowledged === 2,
    };
  }
  async appendSignal(
    room: string,
    generation: number,
    probe: string,
    sender: string,
    recipient: string,
    messageId: string,
    body: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        'INSERT OR IGNORE INTO signals(room_code,generation,probe_id,sender_id,recipient_id,client_message_id,body,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        room,
        generation,
        probe,
        sender,
        recipient,
        messageId,
        body,
        this.now(),
        this.now() + 120_000,
      )
      .run();
    return (result.meta.changes ?? 0) === 1;
  }
  async pollSignals(
    recipient: string,
    generation: number,
    probe: string,
    cursor: number,
  ): Promise<Array<{ id: number; body: string }>> {
    const result = await this.db
      .prepare(
        'SELECT id,body FROM signals WHERE recipient_id=? AND generation=? AND probe_id=? AND id>? AND expires_at>? ORDER BY id ASC LIMIT 100',
      )
      .bind(recipient, generation, probe, cursor, this.now())
      .all<{ id: number; body: string }>();
    return result.results;
  }
  async registerRun(run: string, participant: string, attempt: string | null): Promise<void> {
    const now = this.now();
    await this.db
      .prepare(
        'INSERT OR IGNORE INTO runs(id,participant_id,attempt_id,created_at,updated_at) VALUES(?,?,?,?,?)',
      )
      .bind(run, participant, attempt, now, now)
      .run();
    if (attempt)
      await this.db
        .prepare(
          'UPDATE runs SET attempt_id=COALESCE(attempt_id,?),updated_at=? WHERE id=? AND participant_id=?',
        )
        .bind(attempt, now, run, participant)
        .run();
  }
  async ownsRun(run: string, participant: string): Promise<boolean> {
    return Boolean(
      await this.db
        .prepare('SELECT id FROM runs WHERE id=? AND participant_id=?')
        .bind(run, participant)
        .first<{ id: string }>(),
    );
  }
  async listRuns(): Promise<Array<{ id: string; attempt_id: string | null; updated_at: number }>> {
    return (
      await this.db
        .prepare(
          'SELECT id,attempt_id,updated_at FROM runs ORDER BY updated_at DESC,id DESC LIMIT 100',
        )
        .all<{ id: string; attempt_id: string | null; updated_at: number }>()
    ).results;
  }
  async listAttemptReports(): Promise<
    Array<{
      id: string;
      generation: number;
      previous_id: string | null;
      created_at: number;
      run_count: number;
    }>
  > {
    return (
      await this.db
        .prepare(
          'SELECT a.id,a.generation,a.previous_id,a.created_at,COUNT(r.id) AS run_count FROM attempts a LEFT JOIN runs r ON r.attempt_id=a.id GROUP BY a.id,a.generation,a.previous_id,a.created_at ORDER BY a.created_at DESC,a.id DESC LIMIT 100',
        )
        .all<{
          id: string;
          generation: number;
          previous_id: string | null;
          created_at: number;
          run_count: number;
        }>()
    ).results;
  }
  async attemptReport(id: string): Promise<{
    id: string;
    generation: number;
    previousAttemptId: string | null;
    runs: Array<{
      id: string;
      events: Array<{ sequence: number; body: string; received_at: number }>;
    }>;
  } | null> {
    const attempt = await this.attempt(id);
    if (!attempt) return null;
    const runs = (
      await this.db
        .prepare('SELECT id FROM runs WHERE attempt_id=? ORDER BY updated_at DESC,id DESC')
        .bind(id)
        .all<{ id: string }>()
    ).results;
    return {
      id: attempt.id,
      generation: attempt.generation,
      previousAttemptId: attempt.previous_id,
      runs: (await Promise.all(runs.map((run) => this.runDetail(run.id)))).filter(
        (run): run is NonNullable<typeof run> => Boolean(run),
      ),
    };
  }
  async runDetail(run: string): Promise<{
    id: string;
    events: Array<{ sequence: number; body: string; received_at: number }>;
  } | null> {
    const record = await this.db
      .prepare('SELECT id FROM runs WHERE id=?')
      .bind(run)
      .first<{ id: string }>();
    if (!record) return null;
    const events = (
      await this.db
        .prepare(
          'SELECT sequence,body,received_at FROM diagnostic_events WHERE run_id=? ORDER BY sequence ASC',
        )
        .bind(run)
        .all<{ sequence: number; body: string; received_at: number }>()
    ).results;
    return { id: record.id, events };
  }
  async appendEvents(
    run: string,
    events: Array<{ sequence: number; body: string }>,
  ): Promise<{ accepted: number; truncated: number }> {
    if (
      !(await this.db.prepare('SELECT id FROM runs WHERE id=?').bind(run).first<{ id: string }>())
    )
      throw new Error('unknown run');
    let accepted = 0;
    let truncated = 0;
    for (const event of events) {
      const size = new TextEncoder().encode(event.body).length;
      // One conditional INSERT is serialized by D1/SQLite with its accounting
      // trigger, so concurrent writers observe the newest quota counters.
      const inserted = await this.db
        .prepare(
          'INSERT OR IGNORE INTO diagnostic_events(run_id,sequence,body,received_at,byte_size) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM runs WHERE id=? AND event_count<5000 AND event_bytes+?<=?)',
        )
        .bind(run, event.sequence, event.body, this.now(), size, run, size, 2 * 1024 * 1024)
        .run();
      if ((inserted.meta.changes ?? 0) === 1) {
        accepted++;
      } else if (
        !(await this.db
          .prepare('SELECT sequence FROM diagnostic_events WHERE run_id=? AND sequence=?')
          .bind(run, event.sequence)
          .first<{ sequence: number }>())
      ) {
        truncated++;
      }
    }
    if (truncated)
      await this.db
        .prepare('UPDATE runs SET truncated_count=truncated_count+?,updated_at=? WHERE id=?')
        .bind(truncated, this.now(), run)
        .run();
    return { accepted, truncated };
  }
  async exportRuns(): Promise<
    Array<{
      id: string;
      participant_id: string;
      attempt_id: string | null;
      event_count: number;
      event_bytes: number;
      truncated_count: number;
      created_at: number;
      updated_at: number;
    }>
  > {
    return (
      await this.db
        .prepare(
          'SELECT id,participant_id,attempt_id,event_count,event_bytes,truncated_count,created_at,updated_at FROM runs ORDER BY updated_at DESC,id DESC LIMIT 100',
        )
        .all<{
          id: string;
          participant_id: string;
          attempt_id: string | null;
          event_count: number;
          event_bytes: number;
          truncated_count: number;
          created_at: number;
          updated_at: number;
        }>()
    ).results;
  }
  async cleanup(): Promise<void> {
    const now = this.now(),
      retention = now - 30 * 86_400_000;
    // Every statement is bounded.  Dependency order makes this safe for
    // existing D1 databases whose original foreign keys did not cascade.
    await this.db.batch([
      this.db
        .prepare(
          'DELETE FROM signals WHERE id IN (SELECT id FROM signals WHERE expires_at<? LIMIT 100)',
        )
        .bind(now),
      this.db
        .prepare(
          'DELETE FROM attempt_acks WHERE attempt_id IN (SELECT id FROM attempts WHERE room_code IN (SELECT code FROM rooms WHERE expires_at<?) LIMIT 100)',
        )
        .bind(now),
      this.db
        .prepare(
          'DELETE FROM room_capabilities WHERE room_code IN (SELECT code FROM rooms WHERE expires_at<? LIMIT 100)',
        )
        .bind(now),
      this.db
        .prepare(
          'DELETE FROM attempts WHERE id IN (SELECT a.id FROM attempts a WHERE a.room_code IN (SELECT code FROM rooms WHERE expires_at<?) AND NOT EXISTS (SELECT 1 FROM attempt_acks x WHERE x.attempt_id=a.id) LIMIT 100)',
        )
        .bind(now),
      this.db
        .prepare(
          'DELETE FROM participants WHERE id IN (SELECT id FROM participants WHERE room_code IN (SELECT code FROM rooms WHERE expires_at<?) LIMIT 100)',
        )
        .bind(now),
      this.db
        .prepare(
          'DELETE FROM rooms WHERE code IN (SELECT r.code FROM rooms r WHERE r.expires_at<? AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.room_code=r.code) AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.room_code=r.code) LIMIT 100)',
        )
        .bind(now),
      this.db
        .prepare(
          'DELETE FROM diagnostic_events WHERE rowid IN (SELECT e.rowid FROM diagnostic_events e JOIN runs r ON r.id=e.run_id WHERE r.updated_at<? LIMIT 100)',
        )
        .bind(retention),
      this.db
        .prepare(
          'DELETE FROM runs WHERE id IN (SELECT r.id FROM runs r WHERE r.updated_at<? AND NOT EXISTS (SELECT 1 FROM diagnostic_events e WHERE e.run_id=r.id) LIMIT 100)',
        )
        .bind(retention),
    ]);
  }
}
