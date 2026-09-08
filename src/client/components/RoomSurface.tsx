import type { FormEvent, KeyboardEvent } from 'react';
import type { RoomSurfaceCallbacks, RoomSurfaceModel } from './types.js';

export interface RoomSurfaceProps {
  model: RoomSurfaceModel;
  callbacks: RoomSurfaceCallbacks;
}

function submitMessage(event: FormEvent<HTMLFormElement>, onSend: () => void) {
  event.preventDefault();
  onSend();
}

function submitRoomCode(event: KeyboardEvent<HTMLInputElement>, action?: () => void) {
  if (event.key === 'Enter' && action) {
    event.preventDefault();
    action();
  }
}

export function RoomSurface({ model, callbacks }: RoomSurfaceProps) {
  const joinAction = model.actions.find((action) => action.id === 'join');
  const isConnected = model.phase === 'connected';
  const showRoomCode =
    model.phase === 'start' ||
    model.phase === 'invitation' ||
    model.phase === 'checking' ||
    model.phase === 'pending-intent';

  return (
    <main className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="WebRTC Room home">
          WebRTC Room
        </a>
        <a className="admin-link" href="/admin">
          Admin
        </a>
      </header>

      <section className={`room-surface room-surface--${model.phase}`} aria-labelledby="room-title">
        <div className="room-surface__eyebrow">Connect two devices</div>
        <h1 id="room-title">{model.title}</h1>
        <p className="room-surface__status" aria-live="polite">
          {model.status}
        </p>
        {model.detail && <p className="room-surface__detail">{model.detail}</p>}
        {model.error && (
          <p className="notice notice--error" role="alert">
            {model.error}
          </p>
        )}

        {showRoomCode && (
          <label className="field room-code-field">
            <span>Room code</span>
            <input
              value={model.roomCodeDraft ?? ''}
              onChange={(event) => callbacks.onRoomCodeChange(event.target.value.toUpperCase())}
              onKeyDown={(event) => submitRoomCode(event, joinAction?.onClick)}
              autoComplete="off"
              inputMode="text"
              maxLength={10}
              placeholder="ABC 123"
              aria-describedby="room-code-help"
            />
            <small id="room-code-help">Enter a code from an invitation to join.</small>
          </label>
        )}

        {model.roomCode && !showRoomCode && (
          <div className="invitation-card">
            <span className="invitation-card__label">Room code</span>
            <strong>{model.roomCode}</strong>
            {model.invitationUrl && (
              <span className="invitation-card__url">{model.invitationUrl}</span>
            )}
            <button
              className="button button--secondary"
              type="button"
              onClick={callbacks.onCopyInvitation}
            >
              Copy invitation
            </button>
            {model.invitationFeedback && (
              <span className="copy-feedback" role="status">
                {model.invitationFeedback}
              </span>
            )}
          </div>
        )}

        {model.participantSlots && (
          <div className="participant-slots" aria-label="Participants">
            {model.participantSlots.map((slot) => (
              <article
                className={`participant-slot participant-slot--${slot.tone}`}
                key={slot.label}
              >
                <span className="participant-slot__marker" aria-hidden="true" />
                <div>
                  <strong>{slot.label}</strong>
                  <p>{slot.state}</p>
                  {slot.detail && <small>{slot.detail}</small>}
                </div>
                {slot.current && <span className="tag">This device</span>}
              </article>
            ))}
          </div>
        )}

        <div className="room-actions" aria-label="Room actions">
          {model.actions.map((action) => (
            <button
              className={`button button--${action.tone}`}
              disabled={action.disabled}
              key={action.id}
              onClick={action.onClick}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>

        {model.diagnosticsProgress && (
          <p className="diagnostic-indicator">
            <span aria-hidden="true">◌</span> {model.diagnosticsProgress}
          </p>
        )}

        {model.performanceSummary && (
          <section className="room-performance" aria-labelledby="room-performance-title">
            <h2 id="room-performance-title">Connection speed check</h2>
            <p aria-live="polite">{model.performanceSummary.status}</p>
            {model.performanceSummary.results && (
              <ul>
                {model.performanceSummary.results.map((result) => (
                  <li key={result}>{result}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {isConnected && (
          <section className="message-composer" aria-labelledby="messages-title">
            <div className="message-composer__heading">
              <div>
                <h2 id="messages-title">Messages</h2>
                <p>Keep talking while network checks continue.</p>
              </div>
              <button
                className="button button--quiet"
                onClick={callbacks.onOpenDiagnostics}
                type="button"
              >
                Diagnostics
              </button>
            </div>
            <div className="message-list" aria-live="polite" aria-relevant="additions text">
              {model.messages?.length ? (
                model.messages.map((message) => (
                  <p className="message" key={message.id}>
                    <strong>{message.author}</strong> {message.text}
                  </p>
                ))
              ) : (
                <p className="message-list__empty">Your messages will appear here.</p>
              )}
            </div>
            <form
              className="message-form"
              onSubmit={(event) => submitMessage(event, callbacks.onSendMessage)}
            >
              <label className="sr-only" htmlFor="message-draft">
                Write a message
              </label>
              <input
                id="message-draft"
                onChange={(event) => callbacks.onMessageDraftChange(event.target.value)}
                placeholder="Write a message…"
                value={model.messageDraft ?? ''}
              />
              <button className="button button--primary" disabled={!model.canSend} type="submit">
                Send
              </button>
            </form>
          </section>
        )}

        {!isConnected && (
          <button
            className="button button--quiet diagnostics-launch"
            onClick={callbacks.onOpenDiagnostics}
            type="button"
          >
            View diagnostics
          </button>
        )}
      </section>
    </main>
  );
}
