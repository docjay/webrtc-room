import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createId,
  iceConfigSchema,
  iceProfileLabel,
  sanitizeIceConfig,
  selectEligibleProfile,
  type DiagnosticEvent,
  type IceConfig,
  type Profile,
} from '../shared/domain.js';
import { ApiClient, type Credentials, type IssuedAttempt } from './api.js';
import { ReportBuffer, copyReport, downloadReport } from './report.js';
import { DeviceCheckController, type DeviceCheckSnapshot } from './device-checks.js';
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer.js';
import { RoomSurface } from './components/RoomSurface.js';
import type { DiagnosticsViewModel, RoomSurfaceModel } from './components/types.js';
import { PAIRED_PROBE_DEADLINE_MS, runPairedProbe } from './webrtc.js';
import {
  CoordinatedPerformance,
  PERFORMANCE_DEFAULTS,
  summarizeRtt,
  type DirectionResult,
} from './performance.js';
import './styles.css';

const defaults = ['stun:stun.cloudflare.com:3478'];
const defaultStunSummary = 'Default STUN discovery server: stun.cloudflare.com:3478';
type MatrixRow = Profile & {
  outcome?: string;
  detail?: string;
  queuedMs?: number;
  activeMs?: number;
  deadlineAt?: number;
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
  useEffect(() => {
    if (local) return;
    void fetch('/api/session')
      .then((response) => response.json() as Promise<{ authenticated?: unknown }>)
      .then((session) =>
        setState(
          session.authenticated
            ? 'Signed in. Load attempts to verify owner access.'
            : 'Signed out. Sign in with ChatGPT to access owner diagnostics.',
        ),
      )
      .catch(() => setState('Unable to verify sign-in state.'));
  }, [local]);
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
  const [draftIceText, setDraftIceText] = useState('');
  const [appliedIceText, setAppliedIceText] = useState('');
  const [configurationVersion, setConfigurationVersion] = useState(0);
  const [roomCode, setRoomCode] = useState(
    () => new URLSearchParams(location.search).get('room') ?? '',
  );
  const invitation = Boolean(new URLSearchParams(location.search).get('room'));
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [attempt, setAttempt] = useState<IssuedAttempt | null>(null);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [messages, setMessages] = useState<Array<{ id: string; author: string; text: string }>>([]);
  const [draft, setDraft] = useState('');
  const [main, setMain] = useState('Checking this device');
  const [error, setError] = useState('');
  const [intent, setIntent] = useState<'create' | 'join' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [invitationFeedback, setInvitationFeedback] = useState('');
  const [automaticBandwidthEnabled, setAutomaticBandwidthEnabled] = useState(true);
  const [performanceSampleDurationSeconds, setPerformanceSampleDurationSeconds] = useState(3);
  const [performanceMaxDirectionMiB, setPerformanceMaxDirectionMiB] = useState(100);
  const [performance, setPerformance] = useState('Not started');
  const [performanceDirections, setPerformanceDirections] = useState<DirectionResult[]>([]);
  const [performanceDeadlineAt, setPerformanceDeadlineAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [uploadStatus, setUploadStatus] = useState<
    'pending' | 'saved' | 'upload-failed' | 'truncated'
  >('pending');
  const appliedConfig = useMemo<IceConfig>(() => {
    const custom = appliedIceText.trim()
      ? iceConfigSchema.parse(JSON.parse(appliedIceText) as unknown)
      : { iceServers: [] };
    return iceConfigSchema.parse({
      iceServers: [...defaults.map((urls) => ({ urls })), ...custom.iceServers],
    });
  }, [appliedIceText]);
  const draftPreview = useMemo(() => {
    try {
      const custom = draftIceText.trim()
        ? iceConfigSchema.parse(JSON.parse(draftIceText) as unknown)
        : { iceServers: [] };
      const customServers = sanitizeIceConfig(custom);
      if (!customServers.length) return defaultStunSummary;
      const customSummary = customServers
        .map((server) =>
          server.kind === 'turn'
            ? `TURN relay over ${server.transports.join('/')}`
            : `STUN discovery over ${server.transports.join('/')}`,
        )
        .join(', ');
      return `${defaultStunSummary} + ${customSummary}`;
    } catch {
      return 'Fix the JSON before applying';
    }
  }, [draftIceText]);
  const checkController = useRef<DeviceCheckController | null>(null);
  if (!checkController.current) {
    checkController.current = new DeviceCheckController({
      checkSignaling: async ({ signal }) => {
        const response = await fetch('/api/health', { signal });
        if (!response.ok) throw new Error('signaling unavailable');
      },
    });
  }
  const [deviceChecks, setDeviceChecks] = useState<DeviceCheckSnapshot>(
    () => checkController.current!.current,
  );
  const deviceCheckTiming = useRef({ generation: deviceChecks.generation, startedAt: Date.now() });
  if (deviceCheckTiming.current.generation !== deviceChecks.generation)
    deviceCheckTiming.current = { generation: deviceChecks.generation, startedAt: Date.now() };
  const mainChannel = useRef<RTCDataChannel | null>(null);
  const credentialsRef = useRef<Credentials | null>(null);
  const reportRef = useRef(report);
  credentialsRef.current = credentials;
  const cleanups = useRef<Array<() => void>>([]);
  const started = useRef(false);
  const coordinating = useRef(false);
  const cancelled = useRef(false);
  const activePerformance = useRef<CoordinatedPerformance | null>(null);
  const performanceHost = useRef(false);
  const performanceSettings = useRef({
    sampleDurationSeconds: performanceSampleDurationSeconds,
    maxDirectionMiB: performanceMaxDirectionMiB,
  });
  performanceSettings.current = {
    sampleDurationSeconds: performanceSampleDurationSeconds,
    maxDirectionMiB: performanceMaxDirectionMiB,
  };
  const automaticBandwidthEnabledRef = useRef(automaticBandwidthEnabled);
  automaticBandwidthEnabledRef.current = automaticBandwidthEnabled;
  const pendingEvents = useRef<DiagnosticEvent[]>([]);
  const uploadRunning = useRef(false);
  const uploadTimer = useRef<number | undefined>(undefined);
  const uploadAttempts = useRef(0);
  const suiteGeneration = useRef(0);
  const retryPreviousAttempt = useRef<string | null>(null);
  const checksVersion = String(configurationVersion);

  const scheduleUpload = useCallback(() => {
    if (!credentials || uploadTimer.current !== undefined) return;
    const delay = Math.min(30_000, 200 * 2 ** uploadAttempts.current);
    uploadTimer.current = window.setTimeout(() => {
      uploadTimer.current = undefined;
      void flushUploads();
    }, delay);
    // flushUploads reads current React state and is deliberately invoked after a bounded delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials]);
  const record = useCallback(
    (message: string, outcome: DiagnosticEvent['outcome'] = 'info') => {
      const event = report.record('summary', outcome, message, 0, attempt?.id);
      if (!event) {
        setUploadStatus('truncated');
        return;
      }
      pendingEvents.current.push(event);
      setUploadStatus('pending');
      scheduleUpload();
    },
    [attempt?.id, report, scheduleUpload],
  );
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
        `Report upload failed. You can still download it locally: ${uploadError instanceof Error ? uploadError.message : 'unknown error'}`,
      );
    } finally {
      uploadRunning.current = false;
      if (pendingEvents.current.length) scheduleUpload();
    }
  };

  useEffect(() => checkController.current!.subscribe(setDeviceChecks), []);
  useEffect(() => {
    void checkController.current!.start({
      configuration: appliedConfig,
      configurationVersion: checksVersion,
    });
  }, [appliedConfig, checksVersion]);
  useEffect(() => {
    const network = (
      navigator as Navigator & {
        connection?: {
          addEventListener: (type: 'change', listener: () => void) => void;
          removeEventListener: (type: 'change', listener: () => void) => void;
        };
      }
    ).connection;
    const checkChangedNetwork = () => {
      void checkController.current!.recheck({
        configuration: appliedConfig,
        configurationVersion: checksVersion,
      });
      record('detected network change; device checks restarted', 'start');
      if (credentials)
        setError(
          'The network changed. Device checks restarted without interrupting the room; use Recheck device if the connection needs a coordinated retry.',
        );
    };
    window.addEventListener('online', checkChangedNetwork);
    network?.addEventListener('change', checkChangedNetwork);
    return () => {
      window.removeEventListener('online', checkChangedNetwork);
      network?.removeEventListener('change', checkChangedNetwork);
    };
  }, [appliedConfig, checksVersion, credentials, record]);
  useEffect(() => {
    scheduleUpload();
    const interval = window.setInterval(() => void flushUploads(), 5_000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials, scheduleUpload]);
  useEffect(() => {
    const countingDown =
      deviceChecks.phase === 'checking' ||
      matrix.some((row) => row.status !== 'terminal') ||
      performanceDeadlineAt !== null;
    if (!countingDown) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [deviceChecks.phase, matrix, performanceDeadlineAt]);
  useEffect(() => {
    const reportBuffer = reportRef.current;
    const events = pendingEvents.current;
    return () => {
      cancelled.current = true;
      checkController.current?.cancel();
      if (uploadTimer.current !== undefined) window.clearTimeout(uploadTimer.current);
      cleanups.current.forEach((close) => close());
      if (credentialsRef.current && events.length)
        void api
          .uploadEvents(credentialsRef.current, reportBuffer.runId, events.slice(0, 100))
          .catch(() => undefined);
    };
  }, []);

  const tearDownAttempt = useCallback(
    (forRetry: boolean) => {
      if (forRetry && attempt) retryPreviousAttempt.current = attempt.id;
      suiteGeneration.current++;
      cancelled.current = true;
      activePerformance.current?.cancel();
      cleanups.current.forEach((close) => close());
      cleanups.current = [];
      mainChannel.current = null;
      setAttempt(null);
      setMatrix([]);
      setPerformance('Not started');
      setPerformanceDirections([]);
      setPerformanceDeadlineAt(null);
      started.current = false;
      cancelled.current = false;
    },
    [attempt],
  );

  const startChecks = useCallback(
    (disruptActive: boolean) => {
      if (disruptActive) tearDownAttempt(true);
      setError('');
      setMain('Checking this device');
      void checkController.current!.recheck({
        configuration: appliedConfig,
        configurationVersion: checksVersion,
      });
      record('device checks started', 'start');
    },
    [appliedConfig, checksVersion, record, tearDownAttempt],
  );
  const recheck = useCallback(() => {
    if (
      credentials &&
      !window.confirm(
        'Rechecking may interrupt the active connection and start a new diagnostic attempt. Continue?',
      )
    )
      return;
    startChecks(Boolean(credentials));
  }, [credentials, startChecks]);
  const applySettings = useCallback(() => {
    let parsed: IceConfig;
    try {
      parsed = draftIceText.trim()
        ? iceConfigSchema.parse(JSON.parse(draftIceText) as unknown)
        : { iceServers: [] };
    } catch (applyError) {
      setFieldError(
        applyError instanceof Error ? applyError.message : 'Enter valid ICE server JSON.',
      );
      return;
    }
    void parsed;
    if (
      credentials &&
      !window.confirm(
        'Applying network settings may interrupt the active connection and start a new diagnostic attempt. Continue?',
      )
    )
      return;
    if (credentials) tearDownAttempt(true);
    setFieldError('');
    setMain('Checking this device');
    setAppliedIceText(draftIceText);
    setConfigurationVersion((value) => value + 1);
    setError('');
  }, [credentials, draftIceText, tearDownAttempt]);

  const createRoom = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const value = await api.createRoom();
      setCredentials(value);
      await api.registerRun(value, report.runId);
      setRoomCode(value.roomCode);
      history.replaceState(null, '', `?room=${value.roomCode}`);
      setMain('Waiting for the other device');
      record('room created', 'success');
    } catch (createError) {
      setError(
        `Unable to create a room. Check signaling and try again: ${createError instanceof Error ? createError.message : 'unknown error'}`,
      );
    } finally {
      setSubmitting(false);
    }
  };
  const joinRoom = async () => {
    if (submitting || !roomCode) return;
    setSubmitting(true);
    try {
      const value = await api.joinRoom(roomCode);
      setCredentials(value);
      await api.registerRun(value, report.runId);
      setRoomCode(value.roomCode);
      setMain('Waiting for the other device');
      record('room joined', 'success');
    } catch (joinError) {
      setError(
        `Unable to join this room. Check the code or ask for a new invitation: ${joinError instanceof Error ? joinError.message : 'unknown error'}`,
      );
    } finally {
      setSubmitting(false);
    }
  };
  const chooseIntent = (next: 'create' | 'join') => {
    if (next === 'join' && !roomCode) {
      setError('Enter a room code to join.');
      return;
    }
    setError('');
    setIntent(next);
  };
  useEffect(() => {
    if (!intent || credentials || submitting || deviceChecks.phase === 'checking') return;
    if (!deviceChecks.ready || deviceChecks.configurationVersion !== checksVersion) return;
    void Promise.resolve().then(() => {
      if (
        checkController.current?.current.ready &&
        checkController.current.current.configurationVersion === checksVersion
      ) {
        setIntent(null);
        void (intent === 'create' ? createRoom() : joinRoom());
      }
    });
    // The ready snapshot is the gate; callbacks intentionally execute the captured explicit intent once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    checksVersion,
    credentials,
    deviceChecks.configurationVersion,
    deviceChecks.phase,
    deviceChecks.ready,
    intent,
    submitting,
  ]);

  async function coordinate() {
    if (!credentials || coordinating.current) return;
    coordinating.current = true;
    try {
      await api.submitCapabilities(credentials, sanitizeIceConfig(appliedConfig));
      const room = await api.status(credentials);
      if (!room.guestPresent || !room.capabilitiesReady) {
        setMain('Waiting for the other device');
        return;
      }
      let currentAttempt = attempt;
      if (started.current) {
        if (!room.attemptId || room.attemptId === currentAttempt?.id) return;
        tearDownAttempt(false);
        currentAttempt = null;
        setMain('Connecting devices');
      }
      let issued: IssuedAttempt | null = currentAttempt;
      if (retryPreviousAttempt.current) {
        issued = await api.retry(credentials, retryPreviousAttempt.current);
        retryPreviousAttempt.current = null;
      } else if (!room.attemptId && credentials.participantId === room.hostParticipantId)
        issued = await api.createAttempt(credentials);
      else if (room.attemptId) issued = await api.attempt(credentials, room.attemptId);
      if (!issued) return;
      setAttempt(issued);
      const ack = await api.acknowledge(credentials, issued);
      if (!ack.paired) {
        setMain('Waiting for the other device to confirm diagnostics');
        return;
      }
      started.current = true;
      setMain('Connecting devices');
      await runMatrix(issued, room, suiteGeneration.current);
    } catch (coordinateError) {
      const message = coordinateError instanceof Error ? coordinateError.message : 'unknown error';
      if (/forbidden|expired|not found/i.test(message)) {
        tearDownAttempt(false);
        setCredentials(null);
        setMain('Disconnected');
        setError(
          'This room expired or this device no longer has access. Create a new room or enter a current invitation code.',
        );
        return;
      }
      setError(`Connection setup needs attention. Recheck this device or try again: ${message}`);
      setMain('Unable to connect');
    } finally {
      coordinating.current = false;
    }
  }
  useEffect(() => {
    if (!credentials || !deviceChecks.ready || deviceChecks.configurationVersion !== checksVersion)
      return;
    const first = window.setTimeout(() => void coordinate(), 10);
    const timer = window.setInterval(() => void coordinate(), 500);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    credentials,
    deviceChecks.ready,
    deviceChecks.configurationVersion,
    checksVersion,
    appliedConfig,
    attempt?.id,
  ]);
  function installChat(channel: RTCDataChannel, suite: number) {
    channel.addEventListener('message', ({ data }) => {
      if (typeof data === 'string' && data.startsWith('chat:'))
        setMessages((items) => [
          ...items,
          { id: createId('message'), author: 'Other device', text: data.slice(5) },
        ]);
      else if (
        typeof data === 'string' &&
        data.startsWith('perf-restart:') &&
        !activePerformance.current
      ) {
        const [, durationText, maxMiBText] = data.split(':');
        const duration = Math.max(1, Math.min(10, Number(durationText) || 3));
        const maxMiB = Math.max(8, Math.min(256, Number(maxMiBText) || 100));
        performanceSettings.current = {
          sampleDurationSeconds: duration,
          maxDirectionMiB: maxMiB,
        };
        setPerformanceSampleDurationSeconds(duration);
        setPerformanceMaxDirectionMiB(maxMiB);
        void runPerformance(channel, performanceHost.current);
      }
    });
    const disconnected = () => {
      if (mainChannel.current !== channel || suite !== suiteGeneration.current) return;
      mainChannel.current = null;
      setMain('Disconnected');
      setError('The other device disconnected. Recheck this device to start a new attempt.');
    };
    channel.addEventListener('close', disconnected, { once: true });
    channel.addEventListener('error', disconnected, { once: true });
  }
  async function runMatrix(
    issued: IssuedAttempt,
    room: Awaited<ReturnType<ApiClient['status']>>,
    suite: number,
  ) {
    const activeCredentials = credentials;
    if (!activeCredentials) return;
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
    let selectedConnection:
      { row: MatrixRow; channel: RTCDataChannel; close: () => void } | undefined;
    const activateEligibleConnection = () => {
      if (selectedConnection || suite !== suiteGeneration.current) return;
      const eligible = selectEligibleProfile(
        profiles.map(
          (profile) =>
            completed.get(profile.id) ?? {
              ...profile,
              status: 'queued' as const,
              outcome: 'queued',
            },
        ),
      );
      const connection = eligible ? retained.get(eligible.tier) : undefined;
      if (!eligible || !connection) return;
      selectedConnection = connection;
      mainChannel.current = connection.channel;
      cleanups.current.push(connection.close);
      installChat(connection.channel, suite);
      setMain('Connected');
      record(
        `selected path ${iceProfileLabel(eligible.a, appliedConfig)} → ${iceProfileLabel(eligible.b, appliedConfig)}`,
        'success',
      );
    };
    await Promise.all(
      Array.from({ length: Math.min(3, profiles.length) }, async () => {
        for (;;) {
          const current = index++;
          if (current >= profiles.length) return;
          const profile = profiles[current]!;
          const startedAt = window.performance.now();
          setMatrix((rows) =>
            rows.map((row) =>
              row.id === profile.id
                ? {
                    ...row,
                    status: 'running',
                    outcome: 'running',
                    queuedMs: Math.round(startedAt - (queuedAt.get(profile.id) ?? startedAt)),
                    deadlineAt: Date.now() + PAIRED_PROBE_DEADLINE_MS,
                  }
                : row,
            ),
          );
          const result = await runPairedProbe({
            api,
            credentials: activeCredentials,
            attempt: issued,
            profile,
            probeId: `prb_${issued.id.slice(4, 24)}${String(current).padStart(2, '0')}`,
            peerId:
              activeCredentials.participantId === room.hostParticipantId
                ? room.guestParticipantId!
                : room.hostParticipantId,
            host: activeCredentials.participantId === room.hostParticipantId,
            config: appliedConfig,
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
          activateEligibleConnection();
          setMatrix((rows) => rows.map((value) => (value.id === profile.id ? row : value)));
          record(
            `${iceProfileLabel(profile.a, appliedConfig)} → ${iceProfileLabel(profile.b, appliedConfig)}: ${result.outcome} (${result.detail})`,
            result.outcome === 'pass'
              ? 'success'
              : result.outcome === 'timeout'
                ? 'timeout'
                : 'info',
          );
        }
      }),
    );
    const terminalRows = profiles.map(
      (profile) =>
        completed.get(profile.id) ?? {
          ...profile,
          status: 'terminal' as const,
          outcome: 'cancelled',
        },
    );
    const selected = selectEligibleProfile(terminalRows);
    for (const [tier, connection] of retained) if (tier !== selected?.tier) connection.close();
    if (selectedConnection && selected) {
      performanceHost.current = activeCredentials.participantId === room.hostParticipantId;
      void runPerformance(selectedConnection.channel, performanceHost.current);
    } else {
      setMain('Unable to connect');
      setError(
        'No verified connection path was available. Recheck the device or ask the other device to retry.',
      );
      setPerformance('Not run: no verified connection');
    }
    record('matrix diagnostics complete', 'success');
  }
  async function runPerformance(channel: RTCDataChannel, host: boolean) {
    if (activePerformance.current) return;
    setPerformanceDirections([]);
    setPerformance('Confirming both participants allow the connection speed check');
    const configuredMaxBytes = performanceSettings.current.maxDirectionMiB * 1024 * 1024;
    const limits = {
      ...PERFORMANCE_DEFAULTS,
      minSampleDurationMs: performanceSettings.current.sampleDurationSeconds * 1_000,
      maxDurationMs: Math.max(
        PERFORMANCE_DEFAULTS.maxDurationMs,
        performanceSettings.current.sampleDurationSeconds * 1_000,
      ),
      maxDirectionBytes: configuredMaxBytes,
      maxTotalBytes: configuredMaxBytes * 2,
      ...window.__WEBRTC_TEST_PERF_LIMITS__,
    };
    const maximumDurationMs =
      3_000 +
      Math.max(0, limits.pingCount - 1) * limits.pingIntervalMs +
      limits.pingTimeoutMs +
      2 * (limits.maxDurationMs + 2_000);
    setPerformanceDeadlineAt(Date.now() + maximumDurationMs);
    const protocol = new CoordinatedPerformance(
      channel,
      host,
      limits,
      undefined,
      automaticBandwidthEnabledRef.current,
    );
    activePerformance.current = protocol;
    const result = await protocol.run(
      (directionResult) =>
        setPerformanceDirections((rows) => [
          ...rows.filter((row) => row.direction !== directionResult.direction),
          directionResult,
        ]),
      (progress) => setPerformance(progress.label),
    );
    activePerformance.current = null;
    setPerformanceDeadlineAt(null);
    protocol.dispose();
    if (result.cancelled) {
      setPerformance('Connection speed check stopped');
      return;
    }
    if (result.skippedReason) {
      setPerformance(result.skippedReason);
      return;
    }
    const rtt = summarizeRtt(result.rtts, result.unanswered);
    setPerformanceDirections(result.directions);
    setPerformance(
      `Complete: RTT min/median/p95/max ${rtt.min ?? '—'}/${rtt.median ?? '—'}/${rtt.p95 ?? '—'}/${rtt.max ?? '—'} ms; ${rtt.count}/20 answered. Short data-channel goodput is not ISP bandwidth.`,
    );
    record(
      `performance complete (${rtt.count}/20 RTT; ${result.directions.length} receiver results)`,
      'success',
    );
  }
  function restartPerformance() {
    const channel = mainChannel.current;
    if (!channel || channel.readyState !== 'open' || activePerformance.current) return;
    channel.send(
      `perf-restart:${performanceSettings.current.sampleDurationSeconds}:${performanceSettings.current.maxDirectionMiB}`,
    );
    void runPerformance(channel, performanceHost.current);
  }
  async function leave() {
    tearDownAttempt(false);
    await (credentials ? api.leave(credentials) : Promise.resolve()).catch(() => undefined);
    setCredentials(null);
    setMessages([]);
    setMain('Disconnected');
    setError('');
    setIntent(null);
  }
  function send() {
    if (!draft.trim() || mainChannel.current?.readyState !== 'open') return;
    mainChannel.current.send(`chat:${draft}`);
    setMessages((items) => [...items, { id: createId('message'), author: 'You', text: draft }]);
    record('chat message sent');
    setDraft('');
  }
  const copyInvitation = async () => {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}${location.pathname}?room=${roomCode}`,
      );
      setInvitationFeedback('Invitation copied.');
    } catch {
      setInvitationFeedback('Could not copy the invitation. Copy the room code instead.');
    }
  };
  const completeSnapshot = () =>
    report.completeSnapshot({
      attemptId: attempt?.id,
      configurationVersion: checksVersion,
      deviceChecks,
      matrix: matrix.map((row) => ({
        ...row,
        a: iceProfileLabel(row.a, appliedConfig),
        b: iceProfileLabel(row.b, appliedConfig),
      })),
      performance: {
        automaticBandwidthEnabled,
        status: performance,
        directions: performanceDirections,
      },
      outcome: main,
      uploadStatus,
    });
  const copyCompleteReport = async () => {
    try {
      await copyReport(completeSnapshot());
      setInvitationFeedback('Diagnostic report copied.');
    } catch {
      setError('Could not copy the report. Download it instead.');
    }
  };
  const counts = matrix.reduce<Record<string, number>>(
    (all, row) => ({ ...all, [row.status]: (all[row.status] ?? 0) + 1 }),
    {},
  );
  const formatRemaining = (milliseconds: number) => {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };
  const deviceRemainingMs =
    deviceChecks.phase === 'checking'
      ? Math.max(
          0,
          Math.ceil(deviceChecks.progress.total / deviceChecks.limits.concurrency) *
            deviceChecks.limits.probeDeadlineMs -
            (clockNow - deviceCheckTiming.current.startedAt),
        )
      : 0;
  const runningMatrix = matrix.filter((row) => row.status === 'running');
  const queuedMatrix = matrix.filter((row) => row.status === 'queued');
  const matrixRemainingMs = matrix.some((row) => row.status !== 'terminal')
    ? Math.max(0, ...runningMatrix.map((row) => (row.deadlineAt ?? clockNow) - clockNow)) +
      Math.ceil(queuedMatrix.length / 3) * PAIRED_PROBE_DEADLINE_MS
    : 0;
  const performanceRemainingMs = performanceDeadlineAt
    ? Math.max(0, performanceDeadlineAt - clockNow)
    : 0;
  const surfaceStatus = credentials
    ? main
    : deviceChecks.phase === 'checking'
      ? 'Checking this device'
      : deviceChecks.ready
        ? 'This device is ready'
        : 'Unable to prepare this device';
  const roomPhase: RoomSurfaceModel['phase'] =
    error && !credentials
      ? 'failure'
      : main === 'Connected'
        ? 'connected'
        : credentials
          ? main.includes('Waiting')
            ? 'waiting'
            : main === 'Disconnected'
              ? 'disconnected'
              : main === 'Unable to connect'
                ? 'failure'
                : 'connecting'
          : deviceChecks.phase === 'checking'
            ? intent
              ? 'pending-intent'
              : invitation
                ? 'invitation'
                : 'checking'
            : invitation
              ? 'invitation'
              : 'start';
  const blocker = deviceChecks.blockingPrerequisites[0];
  const roomModel: RoomSurfaceModel = {
    phase: roomPhase,
    title:
      roomPhase === 'connected'
        ? 'Connected'
        : roomPhase === 'waiting'
          ? 'Waiting for the other device'
          : invitation
            ? `Join room ${roomCode}`
            : 'Connect two devices',
    status: surfaceStatus,
    detail:
      roomPhase === 'connected'
        ? 'Messages are ready while network checks continue.'
        : (blocker ??
          (deviceChecks.phase === 'checking'
            ? invitation
              ? 'Join when ready. We will wait for the current device checks before using the room.'
              : 'You can choose Create or Join now. We will wait for the current device checks.'
            : `The automatic connection speed check is ${automaticBandwidthEnabled ? 'on' : 'off'}. It runs only after connection-path checks finish.`)),
    ...(credentials
      ? {
          roomCode,
          invitationUrl: `${location.origin}${location.pathname}?room=${roomCode}`,
        }
      : {}),
    invitationFeedback,
    error,
    ...(deviceChecks.phase === 'checking'
      ? {
          diagnosticsProgress: `Checking device: ${deviceChecks.progress.completed} of ${deviceChecks.progress.total} · up to ${formatRemaining(deviceRemainingMs)} remaining`,
        }
      : matrix.length
        ? {
            diagnosticsProgress: `Network checks: ${counts.terminal ?? 0} of ${matrix.length} complete${matrixRemainingMs ? ` · up to ${formatRemaining(matrixRemainingMs)} remaining` : ''}`,
          }
        : {}),
    ...(credentials && (main === 'Connected' || performance !== 'Not started')
      ? {
          performanceSummary: {
            status: `${performance}${performanceRemainingMs ? ` · up to ${formatRemaining(performanceRemainingMs)} remaining` : ''}`,
            ...(performanceDirections.length
              ? {
                  results: performanceDirections.map(
                    (result) =>
                      `${result.direction}: ${result.mbps?.toFixed(2) ?? '—'} Mbps over ${(result.bytes / (1024 * 1024)).toFixed(1)} MiB in ${(result.elapsedMs / 1_000).toFixed(2)} s (${result.reason})`,
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(credentials
      ? {
          participantSlots: [
            {
              label: 'This device',
              state: main === 'Connected' ? 'Connected' : deviceChecks.ready ? 'Ready' : 'Checking',
              tone:
                main === 'Connected'
                  ? 'connected'
                  : main === 'Disconnected'
                    ? 'disconnected'
                    : deviceChecks.ready
                      ? 'ready'
                      : 'waiting',
              current: true,
            },
            {
              label: 'Other device',
              state:
                main === 'Connected'
                  ? 'Connected'
                  : main.includes('Waiting')
                    ? 'Waiting'
                    : main === 'Disconnected'
                      ? 'Disconnected'
                      : 'Connecting',
              tone:
                main === 'Connected'
                  ? 'connected'
                  : main === 'Disconnected'
                    ? 'disconnected'
                    : main === 'Unable to connect'
                      ? 'error'
                      : 'waiting',
            },
          ],
        }
      : {}),
    messages,
    messageDraft: draft,
    canSend: mainChannel.current?.readyState === 'open',
    roomCodeDraft: roomCode,
    actions: credentials
      ? [
          { id: 'leave', label: 'Leave room', tone: 'danger', onClick: () => void leave() },
          ...(main === 'Unable to connect' || main === 'Disconnected'
            ? [{ id: 'retry', label: 'Recheck device', tone: 'primary' as const, onClick: recheck }]
            : []),
        ]
      : intent
        ? [
            ...(blocker
              ? [
                  {
                    id: 'recheck',
                    label: 'Recheck device',
                    tone: 'primary' as const,
                    onClick: recheck,
                  },
                ]
              : []),
            {
              id: 'withdraw',
              label: 'Cancel pending action',
              tone: 'secondary',
              onClick: () => setIntent(null),
            },
          ]
        : [
            {
              id: 'join',
              label: 'Join room',
              tone: invitation ? 'primary' : 'secondary',
              disabled: submitting || Boolean(blocker) || !roomCode,
              onClick: () => chooseIntent('join'),
            },
            {
              id: 'create',
              label: 'Create a room',
              tone: invitation ? 'secondary' : 'primary',
              disabled: submitting || Boolean(blocker),
              onClick: () => chooseIntent('create'),
            },
            {
              id: 'bandwidth',
              label: automaticBandwidthEnabled
                ? 'Connection speed check: on'
                : 'Connection speed check: off',
              tone: 'secondary',
              onClick: () => setAutomaticBandwidthEnabled((value) => !value),
            },
            ...(blocker
              ? [
                  {
                    id: 'recheck',
                    label: 'Recheck device',
                    tone: 'secondary' as const,
                    onClick: recheck,
                  },
                ]
              : []),
          ],
  };
  const diagnosticsModel: DiagnosticsViewModel = {
    headline: deviceChecks.phase === 'complete' ? 'Checks complete' : 'Checking this device',
    progress: `${deviceChecks.progress.completed} of ${deviceChecks.progress.total} device checks; ${matrix.length ? `${counts.terminal ?? 0} of ${matrix.length} connection paths complete` : 'connection paths wait for a peer'}`,
    report: {
      runId: report.runId,
      ...(attempt ? { attemptId: attempt.id } : {}),
      saveStatus: uploadStatus,
      coverage: `${deviceChecks.results.length} device checks, ${matrix.length} paths`,
      outcome: surfaceStatus,
      path: matrix.find((row) => row.outcome === 'pass')?.selected ?? 'No selected path yet',
      measurements: performanceDirections.length
        ? `${performanceDirections.length} direction measurements`
        : 'Not measured',
      failures: [
        ...deviceChecks.blockingPrerequisites,
        ...matrix
          .filter(
            (row) =>
              row.outcome &&
              row.outcome !== 'pass' &&
              row.outcome !== 'queued' &&
              row.outcome !== 'running',
          )
          .map(
            (row) =>
              `${iceProfileLabel(row.a, appliedConfig)} → ${iceProfileLabel(row.b, appliedConfig)}: ${row.detail ?? row.outcome}`,
          ),
      ],
    },
    advancedSettings: {
      draft: draftIceText,
      error: fieldError,
      preview: draftPreview,
      applying: false,
    },
    performance: {
      preference: automaticBandwidthEnabled
        ? 'On for this device; either participant can turn it off'
        : 'Off for this device; no automatic speed traffic will run',
      budget: `Up to ${performanceMaxDirectionMiB} MiB per direction and ${performanceMaxDirectionMiB * 2} MiB total; configured for ${performanceSampleDurationSeconds} seconds per direction`,
      status: `${performance}${performanceRemainingMs ? ` · up to ${formatRemaining(performanceRemainingMs)} remaining` : ''}`,
      automaticBandwidthEnabled,
      sampleDurationSeconds: performanceSampleDurationSeconds,
      maxDirectionMiB: performanceMaxDirectionMiB,
      restartAvailable:
        mainChannel.current?.readyState === 'open' &&
        performanceDeadlineAt === null &&
        performance !== 'Not started',
      directions: performanceDirections.map((result) => ({
        direction: result.direction,
        result: `${result.mbps?.toFixed(2) ?? '—'} Mbps, ${(result.bytes / (1024 * 1024)).toFixed(1)} MiB in ${(result.elapsedMs / 1_000).toFixed(2)} s (${result.reason})`,
      })),
    },
    groups: [
      {
        id: 'device',
        title: 'Device checks',
        summary: deviceChecks.phase,
        checks: deviceChecks.results.map((result) => {
          const detail = [
            result.detail,
            result.candidateTypes?.length
              ? `Observed candidates: ${result.candidateTypes.join(', ')}`
              : undefined,
          ]
            .filter((value): value is string => Boolean(value))
            .join(' · ');
          return {
            id: result.id,
            label: result.label,
            outcome: result.outcome,
            duration: `${result.elapsedMs} ms`,
            ...(detail ? { detail } : {}),
          };
        }),
      },
      {
        id: 'paths',
        title: 'Connection paths',
        summary: matrix.length
          ? `${counts.terminal ?? 0} of ${matrix.length} complete`
          : 'Waiting for peer',
        matrix: matrix.map((row) => ({
          id: row.id,
          profile: `${iceProfileLabel(row.a, appliedConfig)} → ${iceProfileLabel(row.b, appliedConfig)}`,
          outcome: row.outcome ?? 'queued',
          queued: `${row.queuedMs ?? 0} ms`,
          active: `${row.activeMs ?? 0} ms`,
          evidence: row.detail ?? row.selected ?? 'pending',
        })),
      },
      {
        id: 'events',
        title: 'Event log and timing',
        summary: `${report.snapshot().events.length} retained`,
        events: report
          .snapshot()
          .events.slice(-50)
          .map((event) => ({
            id: event.spanId,
            timestamp: event.clientTime,
            text: event.payload.message ?? event.type,
            outcome: event.outcome,
          })),
      },
    ],
  };
  const diagnosticsOpener = useRef<HTMLElement>(null);
  const mobileModalChange = useCallback((isModal: boolean) => {
    const shell = document.querySelector<HTMLElement>('.app-shell');
    if (shell) shell.inert = isModal;
  }, []);
  return (
    <>
      <RoomSurface
        model={roomModel}
        callbacks={{
          onRoomCodeChange: setRoomCode,
          onCopyInvitation: () => void copyInvitation(),
          onMessageDraftChange: setDraft,
          onSendMessage: send,
          onOpenDiagnostics: () => {
            diagnosticsOpener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setDrawerOpen(true);
          },
        }}
      />
      <DiagnosticsDrawer
        open={drawerOpen}
        model={diagnosticsModel}
        openerRef={diagnosticsOpener}
        callbacks={{
          onClose: () => setDrawerOpen(false),
          onMobileModalChange: mobileModalChange,
          onRecheckDevice: recheck,
          onAutomaticBandwidthEnabledChange: setAutomaticBandwidthEnabled,
          onPerformanceSampleDurationChange: setPerformanceSampleDurationSeconds,
          onPerformanceMaxDirectionMiBChange: setPerformanceMaxDirectionMiB,
          onRestartPerformance: restartPerformance,
          onAdvancedDraftChange: (value) => {
            setDraftIceText(value);
            setFieldError('');
          },
          onApplyAdvancedSettings: applySettings,
          onCopyReport: () => void copyCompleteReport(),
          onDownloadReport: () => downloadReport(completeSnapshot()),
          onShowCompactReport: () => undefined,
          ...(performanceDeadlineAt !== null
            ? {
                onCancelPerformance: () => {
                  activePerformance.current?.cancel();
                  setPerformance('Stopping connection speed check');
                },
              }
            : {}),
        }}
      />
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  location.pathname === '/admin' || location.pathname === '/admin/' ? <Admin /> : <App />,
);
