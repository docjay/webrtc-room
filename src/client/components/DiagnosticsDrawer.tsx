import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { CompactReport } from './CompactReport.js';
import type { DiagnosticGroup, DiagnosticsCallbacks, DiagnosticsViewModel } from './types.js';

export interface DiagnosticsDrawerProps {
  open: boolean;
  model: DiagnosticsViewModel;
  callbacks: DiagnosticsCallbacks;
  openerRef?: RefObject<HTMLElement | null>;
}

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.hasAttribute('hidden'),
  );
}

function DrawerGroup({ group }: { group: DiagnosticGroup }) {
  const [showPairDetails, setShowPairDetails] = useState(false);
  const [visibleEvents, setVisibleEvents] = useState(50);
  return (
    <details className="diagnostic-group">
      <summary>
        <span>{group.title}</span>
        <small>{group.summary}</small>
      </summary>
      <div className="diagnostic-group__content">
        {group.checks && (
          <ul className="check-list">
            {group.checks.map((check) => (
              <li key={check.id}>
                <strong>{check.label}</strong>
                <span>{check.outcome}</span>
                <small>
                  {check.duration}
                  {check.detail ? ` · ${check.detail}` : ''}
                </small>
              </li>
            ))}
          </ul>
        )}
        {group.matrix && (
          <>
            <p className="capability-help">
              Five capability checks, not every endpoint combination. Alternate endpoints are tried
              only if needed; details show the configured pairs and what actually ran.
            </p>
            <div className="capability-view" role="group" aria-label="Connection checks view">
              <button
                className="button button--secondary"
                type="button"
                aria-pressed={!showPairDetails}
                onClick={() => setShowPairDetails(false)}
              >
                Summary
              </button>
              <button
                className="button button--secondary"
                type="button"
                aria-pressed={showPairDetails}
                onClick={() => setShowPairDetails(true)}
              >
                Pair details
              </button>
            </div>
            <ul className="capability-list">
              {group.matrix.map((row) => (
                <li className="capability-card" key={row.id}>
                  <div className="capability-card__heading">
                    <strong>{row.profile}</strong>
                    <span className="tag" role="status">
                      {row.outcome}
                    </span>
                  </div>
                  <p>{row.evidence}</p>
                  {row.id === 'stun-assisted' && (
                    <p className="capability-help">
                      Tests mapped-address connectivity without signaling local host candidates.
                      Address discovery is reported separately in Device checks; a connectivity
                      timeout does not mean the STUN server failed.
                    </p>
                  )}
                  <small>
                    Queued: {row.queued} · Active: {row.active}
                  </small>
                  {showPairDetails &&
                    (row.details?.length ? (
                      <div
                        className="table-scroll"
                        role="region"
                        aria-label={`${row.profile} pair evidence`}
                        tabIndex={0}
                      >
                        <table aria-label={`${row.profile} pair details`}>
                          <thead>
                            <tr>
                              <th>Requested endpoints (A → B)</th>
                              <th>Status</th>
                              <th>Queued / active</th>
                              <th>Observed pair and evidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.details.map((pair) => (
                              <tr key={pair.id}>
                                <td>{pair.endpoints}</td>
                                <td>{pair.status}</td>
                                <td>
                                  {pair.queued} / {pair.active}
                                </td>
                                <td>{pair.evidence}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p>No endpoints configured for this check.</p>
                    ))}
                </li>
              ))}
            </ul>
          </>
        )}
        {group.events && (
          <>
            <p className="capability-help">
              Candidate IP addresses and mDNS names are included in this log, copied/downloaded
              reports, and server-saved diagnostics. Review them before sharing.
            </p>
            {group.events.length > visibleEvents && (
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setVisibleEvents((count) => count + 50)}
              >
                Show earlier events ({group.events.length - visibleEvents} remaining)
              </button>
            )}
            <ol className="event-list">
              {group.events.slice(-visibleEvents).map((event) => (
                <li key={event.id}>
                  <time>{event.timestamp}</time>
                  <span>{event.text}</span>
                </li>
              ))}
            </ol>
          </>
        )}
        {group.content}
      </div>
    </details>
  );
}

export function DiagnosticsDrawer({ open, model, callbacks, openerRef }: DiagnosticsDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(open);
  const headingId = useId();
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 600px)').matches);
  const [compact, setCompact] = useState(false);
  const onMobileModalChange = callbacks.onMobileModalChange;

  useEffect(() => {
    const query = window.matchMedia('(max-width: 600px)');
    const updateViewport = () => setIsMobile(query.matches);
    query.addEventListener('change', updateViewport);
    return () => query.removeEventListener('change', updateViewport);
  }, []);

  useEffect(() => {
    onMobileModalChange?.(open && isMobile);
    if (open && isMobile) closeButtonRef.current?.focus();
    return () => {
      onMobileModalChange?.(false);
    };
  }, [isMobile, onMobileModalChange, open]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      openerRef?.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open, openerRef]);

  const close = () => {
    setCompact(false);
    callbacks.onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || !isMobile) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const elements = focusableElements(drawer);
    const first = elements[0];
    const last = elements.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return (
    <aside
      aria-labelledby={headingId}
      aria-modal={isMobile ? true : undefined}
      className={`diagnostics-drawer ${isMobile ? 'diagnostics-drawer--modal' : ''}`}
      onKeyDown={onKeyDown}
      ref={drawerRef}
      role={isMobile ? 'dialog' : 'region'}
    >
      <header className="diagnostics-drawer__header">
        <div>
          <p className="drawer-eyebrow">Diagnostics</p>
          <h2 id={headingId}>{model.headline}</h2>
          <p aria-live="polite">{model.progress}</p>
        </div>
        <div className="drawer-header-actions">
          <button
            className="button button--secondary"
            onClick={callbacks.onRecheckDevice}
            type="button"
          >
            Recheck device
          </button>
          <button
            className="icon-button"
            onClick={close}
            ref={closeButtonRef}
            type="button"
            aria-label="Close diagnostics"
          >
            ×
          </button>
        </div>
      </header>

      <div className="diagnostics-drawer__body">
        <section className="drawer-summary" aria-label="Diagnostic summary">
          <span>
            {model.report.attemptId
              ? `Attempt ${model.report.attemptId}`
              : `Run ${model.report.runId}`}
          </span>
          <strong>{model.report.saveStatus}</strong>
        </section>

        {model.groups.map((group) => (
          <DrawerGroup group={group} key={group.id} />
        ))}

        <details className="diagnostic-group">
          <summary>
            <span>Connection speed check</span>
            <small>{model.performance.status}</small>
          </summary>
          <div className="diagnostic-group__content">
            <p>
              <strong>Automatic check:</strong> {model.performance.preference}
            </p>
            <p>
              <strong>Maximum traffic:</strong> {model.performance.budget}
            </p>
            <label className="preference-toggle">
              <input
                checked={model.performance.automaticBandwidthEnabled}
                onChange={(event) =>
                  callbacks.onAutomaticBandwidthEnabledChange(event.target.checked)
                }
                type="checkbox"
              />
              <span>Measure this connection automatically after the connection-path checks</span>
            </label>
            <div className="performance-settings">
              <label className="field">
                <span>Test length (seconds)</span>
                <input
                  min="1"
                  max="10"
                  step="1"
                  type="number"
                  value={model.performance.sampleDurationSeconds}
                  onChange={(event) =>
                    callbacks.onPerformanceSampleDurationChange(
                      Math.max(1, Math.min(10, Number(event.target.value) || 1)),
                    )
                  }
                />
              </label>
              <label className="field">
                <span>Maximum per direction (MiB)</span>
                <input
                  min="8"
                  max="256"
                  step="1"
                  type="number"
                  value={model.performance.maxDirectionMiB}
                  onChange={(event) =>
                    callbacks.onPerformanceMaxDirectionMiBChange(
                      Math.max(8, Math.min(256, Number(event.target.value) || 8)),
                    )
                  }
                />
              </label>
            </div>
            <p>A fast connection may finish sooner if it reaches the traffic limit.</p>
            {model.performance.directions && (
              <ul className="check-list">
                {model.performance.directions.map((direction) => (
                  <li key={direction.direction}>
                    <strong>{direction.direction}</strong>
                    <span>{direction.result}</span>
                  </li>
                ))}
              </ul>
            )}
            {callbacks.onCancelPerformance && (
              <button
                className="button button--secondary"
                onClick={callbacks.onCancelPerformance}
                type="button"
              >
                Stop speed check
              </button>
            )}
            {callbacks.onRestartPerformance && model.performance.restartAvailable && (
              <button
                className="button button--secondary"
                onClick={callbacks.onRestartPerformance}
                type="button"
              >
                Restart speed check
              </button>
            )}
          </div>
        </details>

        <details className="diagnostic-group">
          <summary>
            <span>Advanced network settings</span>
            <small>{model.advancedSettings.preview}</small>
          </summary>
          <div className="diagnostic-group__content">
            <label className="field">
              <span>Optional STUN/TURN server JSON</span>
              <textarea
                aria-describedby={
                  model.advancedSettings.error
                    ? 'ice-settings-help ice-settings-error'
                    : 'ice-settings-help'
                }
                onChange={(event) => callbacks.onAdvancedDraftChange(event.target.value)}
                placeholder={`{
  "iceServers": [
    {
      "urls": [
        "turn:relay.example.com:3478?transport=udp",
        "turn:relay.example.com:3478?transport=tcp",
        "turns:relay.example.com:443?transport=tcp"
      ],
      "username": "your-username",
      "credential": "your-password"
    }
  ]
}`}
                spellCheck={false}
                value={model.advancedSettings.draft}
              />
            </label>
            <p id="ice-settings-help">
              Optional. STUN discovers public network addresses. TURN relays the connection when a
              direct path is unavailable. Credentials stay in this tab and are excluded from
              reports.
            </p>
            {model.advancedSettings.error && (
              <p className="field-error" id="ice-settings-error" role="alert">
                {model.advancedSettings.error}
              </p>
            )}
            <button
              className="button button--primary"
              disabled={model.advancedSettings.applying}
              onClick={callbacks.onApplyAdvancedSettings}
              type="button"
            >
              Apply settings
            </button>
          </div>
        </details>
      </div>

      <footer className="diagnostics-drawer__footer">
        <button className="button button--secondary" onClick={callbacks.onCopyReport} type="button">
          Copy report
        </button>
        <button
          className="button button--secondary"
          onClick={callbacks.onDownloadReport}
          type="button"
        >
          Download report
        </button>
        <button
          className="button button--quiet"
          onClick={() => {
            setCompact(true);
            callbacks.onShowCompactReport();
          }}
          type="button"
        >
          Compact report
        </button>
      </footer>
      {compact && <CompactReport onClose={() => setCompact(false)} report={model.report} />}
    </aside>
  );
}
