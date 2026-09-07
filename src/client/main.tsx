import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  iceConfigSchema,
  sanitizeIceConfig,
  selectEligibleProfile,
  type DiagnosticEvent,
  type IceConfig,
  type Profile,
} from '../shared/domain.js';
import { ApiClient, type Credentials, type IssuedAttempt } from './api.js';
import { ReportBuffer, downloadReport } from './report.js';
import { probeIce, runPairedProbe, type ProbeResult } from './webrtc.js';
import { CoordinatedPerformance, summarizeRtt, type DirectionResult } from './performance.js';
import './styles.css';

const defaults = ['stun:stun.azure.com:3478', 'stun:stun.l.google.com:19302'];
type MatrixRow = Profile & {
  outcome?: string;
  detail?: string;
  queuedMs?: number;
  activeMs?: number;
  selected?: string;
};
const api = new ApiClient();
const loopback = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

function Admin() {
  const [identity, setIdentity] = useState('');
  const local = loopback();
  const [state, setState] = useState(
      'Signed out: supply the explicitly configured local owner ID on loopback.',
    ),
    [attempts, setAttempts] = useState<
      Array<{ id: string; generation: number; run_count: number }>
    >([]),
    [filter, setFilter] = useState(''),
    [detail, setDetail] = useState<unknown>(null);
  const request = async (path: string) => {
    const headers = new Headers();
    if (identity && loopback()) headers.set('x-dev-identity', identity);
    const response = await fetch(path, { headers });
    const body: unknown = await response.json();
    if (!response.ok)
      throw new Error(response.status === 403 ? 'Forbidden' : `HTTP ${response.status}`);
    return body;
  };
  const load = async () => {
    try {
      const response = (await request('/api/admin/attempts')) as {
        attempts: Array<{ id: string; generation: number; run_count: number }>;
      };
      setAttempts(response.attempts);
      setState(`Owner access granted; ${response.attempts.length} attempts loaded.`);
    } catch (loadError) {
      setState(loadError instanceof Error ? loadError.message : 'Forbidden');
      setAttempts([]);
    }
  };
  return (
    <main>
      <header>
        <h1>Owner diagnostic review</h1>
        <p aria-live="polite">{state}</p>
      </header>
      <section>
        <h2>Owner identity</h2>
        {local ? (
          <>
            <p>
              Production authentication is platform-owned and fail-closed. This development header
              is sent only for an explicitly entered identity on loopback.
            </p>
            <label>
              Local owner ID{' '}
              <input value={identity} onChange={(event) => setIdentity(event.target.value)} />
            </label>
          </>
        ) : (
          <p>
            Sign in with ChatGPT to access owner diagnostics. Public room diagnostics do not require
            sign-in.{' '}
            <a href="/signin-with-chatgpt?return_to=/admin" target="_top">
              Sign in with ChatGPT
            </a>{' '}
            ·{' '}
            <a href="/signout-with-chatgpt?return_to=/admin" target="_top">
              Sign out
            </a>
          </p>
        )}
        <button onClick={() => void load()}>Load attempts</button>
      </section>
      <section>
        <h2>Attempts</h2>
        <label>
          Filter <input value={filter} onChange={(event) => setFilter(event.target.value)} />
        </label>
        <ul>
          {attempts
            .filter((attempt) => attempt.id.includes(filter))
            .map((attempt) => (
              <li key={attempt.id}>
                <button
                  onClick={() =>
                    void request(`/api/admin/attempts/${attempt.id}`)
                      .then(setDetail)
                      .catch((error: unknown) =>
                        setState(error instanceof Error ? error.message : 'Failed'),
                      )
                  }
                >
                  {attempt.id}
                </button>{' '}
                generation {attempt.generation}; {attempt.run_count} device reports
              </li>
            ))}
        </ul>
      </section>
      <section>
        <h2>Merged attempt-linked reports</h2>
        <pre>{detail ? JSON.stringify(detail, null, 2) : 'Select an attempt.'}</pre>
        <button
          onClick={() =>
            void request('/api/admin/export')
              .then((data) => downloadReport(data))
              .catch((exportError: unknown) =>
                setState(exportError instanceof Error ? exportError.message : 'Export failed'),
              )
          }
        >
          Download export
        </button>
      </section>
    </main>
    // Event uploads are intentionally retried in bounded batches; the exit
    // flush above remains best-effort because browsers may terminate a page.
  );
}
function App() {
  const report = useMemo(() => new ReportBuffer(), []);
  const [iceText, setIceText] = useState(''),
    [preflight, setPreflight] = useState<ProbeResult[]>([]);
  const [preflightState, setPreflightState] = useState<
    'required' | 'running' | 'complete' | 'invalid'
  >('required');
  const [credentials, setCredentials] = useState<Credentials | null>(null),
    [roomCode, setRoomCode] = useState(new URLSearchParams(location.search).get('room') ?? '');
  const [status, setStatus] = useState('Checking signaling…'),
    [main, setMain] = useState('Not ready'),
    [attempt, setAttempt] = useState<IssuedAttempt | null>(null);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]),
    [messages, setMessages] = useState<string[]>([]),
    [draft, setDraft] = useState('');
  const [performance, setPerformance] = useState('Awaiting diagnostics completion'),
    [performanceDirections, setPerformanceDirections] = useState<DirectionResult[]>([]);
  const [error, setError] = useState(''),
    [compact, setCompact] = useState(false),
    [uploadStatus, setUploadStatus] = useState<'pending' | 'saved' | 'upload-failed' | 'truncated'>(
      'pending',
    );
  const mainChannel = useRef<RTCDataChannel | null>(null),
    cleanups = useRef<Array<() => void>>([]),
    started = useRef(false),
    cancelled = useRef(false),
    activePerformance = useRef<CoordinatedPerformance | null>(null),
    pendingEvents = useRef<DiagnosticEvent[]>([]),
    uploadRunning = useRef(false),
    uploadTimer = useRef<number | undefined>(undefined),
    uploadAttempts = useRef(0),
    suiteGeneration = useRef(0),
    retryPreviousAttempt = useRef<string | null>(null);
  const config = useMemo<IceConfig | null>(() => {
    try {
      const custom = iceText.trim()
        ? iceConfigSchema.parse(JSON.parse(iceText) as unknown)
        : { iceServers: [] };
      return iceConfigSchema.parse({
        iceServers: [...defaults.map((urls) => ({ urls })), ...custom.iceServers],
      });
    } catch {
      return null;
    }
  }, [iceText]);
  const ready = preflightState === 'complete' && Boolean(config);
  useEffect(() => {
    void fetch('/api/health')
      .then((r) => setStatus(r.ok ? 'Signaling available' : 'Signaling unavailable'))
      .catch(() => setStatus('Signaling unavailable'));
  }, []);
  useEffect(
    () => () => {
      cancelled.current = true;
      cleanups.current.forEach((close) => close());
      if (credentials && pendingEvents.current.length)
        void api
          .uploadEvents(credentials, report.runId, pendingEvents.current.slice(0, 100))
          .catch(() => setUploadStatus('upload-failed'));
    },
    // This is unmount-only cleanup; credential updates must not close active RTC.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const record = (
    message: string,
    outcome: 'start' | 'end' | 'success' | 'failure' | 'timeout' | 'cancelled' | 'info' = 'info',
  ) => {
    const event = report.record('summary', outcome, message, 0, attempt?.id);
    if (!event) {
      setUploadStatus('truncated');
      return;
    }
    pendingEvents.current.push(event);
    setUploadStatus('pending');
    scheduleUpload();
  };
  const scheduleUpload = () => {
    if (!credentials || uploadTimer.current !== undefined) return;
    const delay = Math.min(30_000, 200 * 2 ** uploadAttempts.current);
    uploadTimer.current = window.setTimeout(() => {
      uploadTimer.current = undefined;
      void flushUploads();
    }, delay);
  };
  const flushUploads = async () => {
    if (!credentials || uploadRunning.current || !pendingEvents.current.length) return;
    uploadRunning.current = true;
    const batch = pendingEvents.current.slice(0, 100);
    try {
      const result = await api.uploadEvents(credentials, report.runId, batch);
      pendingEvents.current.splice(0, batch.length);
      uploadAttempts.current = 0;
      setUploadStatus(
        result.truncated || report.dropped
          ? 'truncated'
          : pendingEvents.current.length
            ? 'pending'
            : 'saved',
      );
    } catch (uploadError) {
      uploadAttempts.current++;
      setUploadStatus('upload-failed');
      setError(
        `Report upload failed: ${uploadError instanceof Error ? uploadError.message : 'unknown error'}`,
      );
    } finally {
      uploadRunning.current = false;
      if (pendingEvents.current.length) scheduleUpload();
    }
  };
  useEffect(() => {
    scheduleUpload();
    const interval = window.setInterval(() => void flushUploads(), 5_000);
    return () => window.clearInterval(interval);
    // Upload functions intentionally use current render credentials.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials]);
  async function runPreflight() {
    if (!config) {
      setPreflightState('invalid');
      return;
    }
    setPreflightState('running');
    setError('');
    record('preflight started', 'start');
    const urls = config.iceServers.flatMap((item) =>
      typeof item.urls === 'string' ? [item.urls] : item.urls,
    );
    const results = await Promise.all(urls.map((url) => probeIce(url)));
    setPreflight(results);
    setPreflightState('complete');
    record(`preflight completed (${results.length} endpoint probes)`, 'success');
  }
  async function create() {
    try {
      const value = await api.createRoom();
      setCredentials(value);
      await api.registerRun(value, report.runId);
      setRoomCode(value.roomCode);
      history.replaceState(null, '', `?room=${value.roomCode}`);
      setMain('Waiting for guest');
    } catch (e) {
      setError(String(e));
    }
  }
  async function join() {
    try {
      const value = await api.joinRoom(roomCode);
      setCredentials(value);
      await api.registerRun(value, report.runId);
      setRoomCode(value.roomCode);
      setMain('Waiting for host');
    } catch (e) {
      setError(String(e));
    }
  }
  async function coordinate() {
    if (!credentials || !config || started.current) return;
    try {
      await api.submitCapabilities(credentials, sanitizeIceConfig(config));
      const room = await api.status(credentials);
      if (!room.guestPresent || !room.capabilitiesReady) {
        setMain('Waiting for peer diagnostics');
        return;
      }
      let issued: IssuedAttempt | null = attempt;
      if (retryPreviousAttempt.current && credentials.participantId === room.hostParticipantId) {
        issued = await api.retry(credentials, retryPreviousAttempt.current);
        retryPreviousAttempt.current = null;
      } else if (!room.attemptId && credentials.participantId === room.hostParticipantId)
        issued = await api.createAttempt(credentials);
      else if (room.attemptId) issued = await api.attempt(credentials, room.attemptId);
      if (!issued) return;
      if (!attempt || attempt.id !== issued.id) {
        setAttempt(issued);
        setMain(`Attempt ${issued.id}: acknowledging manifest`);
      }
      await api.registerRun(credentials, report.runId, issued.id);
      const ack = await api.acknowledge(credentials, issued);
      if (!ack.paired) {
        setMain(`Attempt ${issued.id}: waiting for manifest acknowledgement`);
        return;
      }
      started.current = true;
      setAttempt(issued);
      setMain(`Attempt ${issued.id}: diagnostics running`);
      await runMatrix(issued, room, suiteGeneration.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'coordination failed');
    }
  }
  useEffect(() => {
    if (!credentials || !ready) return;
    const first = window.setTimeout(() => void coordinate(), 10);
    const timer = window.setInterval(() => void coordinate(), 500);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
    // configVersion is represented by `ready`; user edits reset readiness below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials, ready, config]);
  function installChat(channel: RTCDataChannel) {
    channel.addEventListener('message', ({ data }) => {
      if (typeof data === 'string' && data.startsWith('chat:'))
        setMessages((items) => [...items, `Peer: ${data.slice(5)}`]);
    });
  }
  async function runMatrix(
    issued: IssuedAttempt,
    room: Awaited<ReturnType<ApiClient['status']>>,
    suite: number,
  ) {
    if (!config) return;
    const profiles = [...(issued.manifest as unknown as Profile[])].sort(
      (left, right) => left.tier - right.tier || left.id.localeCompare(right.id),
    );
    setMatrix(profiles.map((row) => ({ ...row, status: 'queued', outcome: 'queued' })));
    const queuedAt = new Map(profiles.map((profile) => [profile.id, window.performance.now()]));
    let index = 0;
    const retained = new Map<
      number,
      { row: MatrixRow; channel: RTCDataChannel; close: () => void }
    >();
    const completed = new Map<string, MatrixRow>();
    const runners = Array.from({ length: Math.min(3, profiles.length) }, async () => {
      for (;;) {
        const current = index++;
        if (current >= profiles.length) return;
        const profile = profiles[current];
        if (!profile) return;
        const startedAt = window.performance.now();
        setMatrix((rows) =>
          rows.map((row) =>
            row.id === profile.id
              ? {
                  ...row,
                  status: 'running',
                  outcome: 'running',
                  queuedMs: Math.round(startedAt - (queuedAt.get(profile.id) ?? startedAt)),
                }
              : row,
          ),
        );
        const probeId = `prb_${issued.id.slice(4, 24)}${String(current).padStart(2, '0')}`;
        const result = await runPairedProbe({
          api,
          credentials: credentials!,
          attempt: issued,
          profile,
          probeId,
          peerId:
            credentials!.participantId === room.hostParticipantId
              ? room.guestParticipantId!
              : room.hostParticipantId,
          host: credentials!.participantId === room.hostParticipantId,
          config,
          cancelled: () => cancelled.current || suite !== suiteGeneration.current,
        });
        if (suite !== suiteGeneration.current) {
          result.close();
          return;
        }
        const row: MatrixRow = {
          ...profile,
          status: 'terminal',
          outcome: result.outcome,
          detail: result.detail,
          ...(result.selected ? { selected: result.selected } : {}),
          activeMs: Math.round(result.elapsedMs),
        };
        if (result.outcome === 'pass' && result.channel) {
          const existing = retained.get(profile.tier);
          if (!existing || row.id.localeCompare(existing.row.id) < 0) {
            existing?.close();
            retained.set(profile.tier, { row, channel: result.channel, close: result.close });
          } else result.close();
        } else result.close();
        completed.set(profile.id, row);
        setMatrix((rows) => rows.map((value) => (value.id === profile.id ? row : value)));
        record(
          `${profile.id}: ${result.outcome} (${result.detail})`,
          result.outcome === 'pass' ? 'success' : result.outcome === 'timeout' ? 'timeout' : 'info',
        );
      }
    });
    await Promise.all(runners);
    const terminalRows = profiles.map(
      (profile) =>
        completed.get(profile.id) ?? {
          ...profile,
          status: 'terminal' as const,
          outcome: 'cancelled',
        },
    );
    const selected = selectEligibleProfile(terminalRows);
    const selectedConnection = selected ? retained.get(selected.tier) : undefined;
    for (const [tier, connection] of retained) if (tier !== selected?.tier) connection.close();
    if (selectedConnection && selected) {
      mainChannel.current = selectedConnection.channel;
      cleanups.current.push(selectedConnection.close);
      installChat(selectedConnection.channel);
      setMain(`Main ready: ${selected.id} (${selected.selected ?? 'pair evidence unavailable'})`);
      await runPerformance(
        selectedConnection.channel,
        credentials!.participantId === room.hostParticipantId,
      );
    } else {
      setMain('No verified eligible connection; diagnostics complete');
      setPerformance('Not run: no verified main connection');
    }
    record('matrix diagnostics complete', 'success');
  }
  async function runPerformance(channel: RTCDataChannel, host: boolean) {
    setPerformance(
      'Performance: host-coordinated RTT and sequential receiver-measured goodput running',
    );
    const testLimits = window.__WEBRTC_TEST_PERF_LIMITS__;
    const protocol = new CoordinatedPerformance(channel, host, testLimits);
    activePerformance.current = protocol;
    const result = await protocol.run((directionResult) =>
      setPerformanceDirections((rows) => [
        ...rows.filter((row) => row.direction !== directionResult.direction),
        directionResult,
      ]),
    );
    activePerformance.current = null;
    protocol.dispose();
    if (result.cancelled) {
      setPerformance('Performance cancelled');
      return;
    }
    const rtt = summarizeRtt(result.rtts, result.unanswered);
    setPerformanceDirections(result.directions);
    setPerformance(
      `Complete: RTT min/median/p95/max ${rtt.min ?? '—'}/${rtt.median ?? '—'}/${rtt.p95 ?? '—'}/${rtt.max ?? '—'} ms; ${rtt.count}/20 answered, ${rtt.unanswered} unanswered. Receiver metrics below; short data-channel goodput, not ISP bandwidth.`,
    );
    record(
      `performance complete (${rtt.count}/20 RTT; ${result.directions.length} receiver results)`,
      'success',
    );
  }
  async function leave() {
    suiteGeneration.current++;
    cancelled.current = true;
    activePerformance.current?.cancel();
    cleanups.current.forEach((close) => close());
    cleanups.current = [];
    mainChannel.current = null;
    await (credentials ? api.leave(credentials) : Promise.resolve()).catch(() => undefined);
    setCredentials(null);
    setAttempt(null);
    setMatrix([]);
    started.current = false;
    cancelled.current = false;
    setMain('Left; rerun preflight before retry');
    setPreflightState('required');
  }
  function invalidateConfiguration() {
    if (attempt) retryPreviousAttempt.current = attempt.id;
    suiteGeneration.current++;
    cancelled.current = true;
    activePerformance.current?.cancel();
    cleanups.current.forEach((close) => close());
    cleanups.current = [];
    mainChannel.current = null;
    setAttempt(null);
    setMatrix([]);
    started.current = false;
    setMain('Configuration changed; diagnostics cancelled. Rerun preflight to retry.');
    setPreflight([]);
    setPreflightState('required');
    // New suites use a distinct generation; old callbacks retain their captured one.
    cancelled.current = false;
  }
  function send() {
    if (!draft.trim() || mainChannel.current?.readyState !== 'open') return;
    mainChannel.current.send(`chat:${draft}`);
    setMessages((items) => [...items, `You: ${draft}`]);
    record('chat message sent');
    setDraft('');
  }
  const counts = matrix.reduce<Record<string, number>>(
    (all, row) => ({ ...all, [row.status]: (all[row.status] ?? 0) + 1 }),
    {},
  );
  return (
    <main className={compact ? 'compact' : ''}>
      <header>
        <h1>WebRTC Room diagnostics</h1>
        <p aria-live="polite">
          {status} · {main}
        </p>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="RoomControls">
        <h2>Room controls</h2>
        <p>Run diagnostics on both devices before creating or joining.</p>
        <div className="row">
          <button onClick={() => void create()} disabled={!ready}>
            Create room
          </button>
          <label>
            Room code{' '}
            <input
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={10}
            />
          </label>
          <button onClick={() => void join()} disabled={!ready || !roomCode}>
            Join room
          </button>
          <button onClick={() => void leave()} disabled={!credentials}>
            Leave
          </button>
        </div>
        {credentials && (
          <p>
            Code: <strong>{roomCode}</strong> · Link: {location.origin}
            {location.pathname}?room={roomCode} · Visible attempt:{' '}
            <strong>{attempt?.id ?? `local ${report.runId}`}</strong>
          </p>
        )}
      </section>
      <section className="IceConfiguration">
        <h2>ICE configuration</h2>
        <label>
          TURN JSON{' '}
          <textarea
            value={iceText}
            onChange={(e) => {
              setIceText(e.target.value);
              invalidateConfiguration();
            }}
            placeholder='{"iceServers":[{"urls":"turn:relay.example:3478","username":"user","credential":"password"}]}'
          />
        </label>
        <p>
          Preview:{' '}
          {config
            ? sanitizeIceConfig(config)
                .map((server) => `${server.kind} (${server.transports.join(', ')})`)
                .join(', ')
            : 'Invalid ICE configuration'}
        </p>
        <button onClick={() => void runPreflight()} disabled={preflightState === 'running'}>
          Run diagnostics
        </button>
      </section>
      <section className="PreflightResults">
        <h2>Preflight results</h2>
        <p aria-live="polite">
          {preflightState}. Completion unlocks valid configuration even if endpoint checks fail.
        </p>
        <ul>
          {preflight.map((result) => (
            <li key={result.url}>
              {result.url}: <strong>{result.outcome}</strong> ({result.elapsedMs} ms;{' '}
              {result.candidates.length} candidates)
            </li>
          ))}
        </ul>
      </section>
      <section className="ConnectionStatus">
        <h2>Connection status</h2>
        <p>
          Main ready: {main}. Diagnostics complete:{' '}
          {matrix.length
            ? `${counts.terminal ?? 0}/${matrix.length}; ${counts.running ?? 0} active, ${counts.queued ?? 0} queued`
            : 'not started'}
          .
        </p>
      </section>
      <details open>
        <summary>Diagnostics detail</summary>
        <section className="CandidateTable">
          <h2>Candidate table</h2>
          <p>
            Address values are intentionally not retained; mDNS/browser omissions are reported as
            unavailable.
          </p>
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Outcome</th>
                <th>Candidates</th>
              </tr>
            </thead>
            <tbody>
              {preflight.map((r) => (
                <tr key={r.url}>
                  <td>{r.url}</td>
                  <td>{r.outcome}</td>
                  <td>
                    {r.candidates
                      .map((c) => `${c.type}/${c.protocol}/${c.addressFamily}`)
                      .join(', ') || 'none'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="Matrix">
          <h2>Connectivity matrix</h2>
          <table>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Status</th>
                <th>Queue / active</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.a} → {r.b}
                  </td>
                  <td>{r.outcome}</td>
                  <td>
                    {r.queuedMs ?? 0} / {r.activeMs ?? 0} ms
                  </td>
                  <td>{r.detail ?? r.selected ?? 'pending'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="DiagnosticTimeline">
          <h2>Diagnostic timeline</h2>
          <pre>{report.text() || 'No events yet.'}</pre>
        </section>
        <section className="PerformancePanel">
          <h2>Performance panel</h2>
          <p>{performance}</p>
          <button
            onClick={() => {
              cancelled.current = true;
              activePerformance.current?.cancel();
              setPerformance('Cancellation requested');
            }}
          >
            Cancel performance
          </button>
          <ul aria-label="Receiver measured directions">
            {performanceDirections.map((direction) => (
              <li key={direction.direction}>
                {direction.direction}: receiver {direction.mbps?.toFixed(2) ?? '—'} Mbps,{' '}
                {direction.bytes} bytes, {Math.round(direction.elapsedMs)} ms ({direction.reason})
              </li>
            ))}
          </ul>
        </section>
      </details>
      <section className="TextDemo">
        <h2>Text demo</h2>
        <div className="messages" aria-live="polite">
          {messages.map((message, i) => (
            <p key={`${message}-${i}`}>{message}</p>
          ))}
        </div>
        <label>
          Message{' '}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
          />
        </label>
        <button onClick={send} disabled={mainChannel.current?.readyState !== 'open'}>
          Send
        </button>
      </section>
      <section className="ReportExport">
        <h2>Report export</h2>
        <p>
          Upload: {uploadStatus};{' '}
          {report.dropped ? `Truncated: ${report.dropped}` : 'Not truncated'}.
        </p>
        <button onClick={() => void navigator.clipboard.writeText(report.text())}>
          Copy text report
        </button>
        <button
          onClick={() =>
            downloadReport({ ...report.snapshot(), attemptId: attempt?.id, preflight, matrix })
          }
        >
          Download JSON
        </button>
        <button onClick={() => setCompact((value) => !value)}>Compact view</button>
      </section>
      <section className="OwnerAttemptList">
        <h2>Owner attempt list</h2>
        <p>
          Owner review is available at <code>/admin</code> through fail-closed server identity
          checks.
        </p>
      </section>
      <section className="OwnerAttemptDetail">
        <h2>Owner attempt detail</h2>
        <p>
          Local dev identity may be configured only on loopback; hosted ChatGPT identity is verified
          during Codex deployment.
        </p>
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  location.pathname === '/admin' ? <Admin /> : <App />,
);
