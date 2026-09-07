import type { ReportViewModel } from './types.js';

export interface CompactReportProps {
  report: ReportViewModel;
  onClose: () => void;
}

export function CompactReport({ report, onClose }: CompactReportProps) {
  return (
    <section className="compact-report" aria-labelledby="compact-report-title">
      <header className="compact-report__header">
        <div>
          <span className="compact-report__eyebrow">WebRTC Room report</span>
          <h2 id="compact-report-title">Connection summary</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          type="button"
          aria-label="Close compact report"
        >
          ×
        </button>
      </header>
      <dl className="compact-report__facts">
        <div>
          <dt>Run</dt>
          <dd>{report.runId}</dd>
        </div>
        {report.attemptId && (
          <div>
            <dt>Attempt</dt>
            <dd>{report.attemptId}</dd>
          </div>
        )}
        <div>
          <dt>Outcome</dt>
          <dd>{report.outcome}</dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd>{report.path}</dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>{report.coverage}</dd>
        </div>
        <div>
          <dt>Measurements</dt>
          <dd>{report.measurements}</dd>
        </div>
        <div>
          <dt>Saved</dt>
          <dd>{report.saveStatus}</dd>
        </div>
      </dl>
      {report.failures && report.failures.length > 0 && (
        <section className="compact-report__failures" aria-labelledby="compact-failures">
          <h3 id="compact-failures">Recorded issues</h3>
          <ul>
            {report.failures.slice(0, 4).map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
          {report.failures.length > 4 && (
            <p>{report.failures.length - 4} additional issues are retained in the full report.</p>
          )}
        </section>
      )}
    </section>
  );
}
