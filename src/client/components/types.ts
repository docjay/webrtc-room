export type RoomPhase =
  | 'start'
  | 'invitation'
  | 'checking'
  | 'pending-intent'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failure';

export type ActionTone = 'primary' | 'secondary' | 'danger';

export interface RoomAction {
  id: string;
  label: string;
  tone: ActionTone;
  disabled?: boolean;
  onClick: () => void;
}

export interface ParticipantSlot {
  label: string;
  state: string;
  tone: 'waiting' | 'ready' | 'connected' | 'disconnected' | 'error';
  detail?: string;
  current?: boolean;
}

export interface RoomSurfaceModel {
  phase: RoomPhase;
  title: string;
  status: string;
  detail?: string;
  roomCode?: string;
  invitationUrl?: string;
  invitationFeedback?: string;
  error?: string;
  diagnosticsProgress?: string;
  performanceSummary?: {
    status: string;
    results?: readonly string[];
  };
  participantSlots?: readonly ParticipantSlot[];
  messages?: readonly { id: string; author: string; text: string }[];
  messageDraft?: string;
  canSend?: boolean;
  roomCodeDraft?: string;
  actions: readonly RoomAction[];
}

export interface RoomSurfaceCallbacks {
  onRoomCodeChange: (value: string) => void;
  onCopyInvitation: () => void;
  onMessageDraftChange: (value: string) => void;
  onSendMessage: () => void;
  onOpenDiagnostics: () => void;
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  outcome: string;
  duration: string;
  detail?: string;
}

export interface DiagnosticMatrixRow {
  id: string;
  profile: string;
  outcome: string;
  queued: string;
  active: string;
  evidence: string;
}

export interface DiagnosticEvent {
  id: string;
  timestamp: string;
  text: string;
  outcome?: string;
}

export interface DiagnosticGroup {
  id: string;
  title: string;
  summary: string;
  checks?: readonly DiagnosticCheck[];
  matrix?: readonly DiagnosticMatrixRow[];
  events?: readonly DiagnosticEvent[];
  content?: ReactNode;
}

export interface PerformanceViewModel {
  preference: string;
  budget: string;
  status: string;
  automaticBandwidthEnabled: boolean;
  sampleDurationSeconds: number;
  maxDirectionMiB: number;
  restartAvailable: boolean;
  directions?: readonly { direction: string; result: string }[];
}

export interface ReportViewModel {
  runId: string;
  attemptId?: string;
  saveStatus: string;
  coverage: string;
  outcome: string;
  path: string;
  measurements: string;
  failures?: readonly string[];
}

export interface DiagnosticsViewModel {
  headline: string;
  progress: string;
  report: ReportViewModel;
  advancedSettings: {
    draft: string;
    turnAccessCode: string;
    turnStatus: string;
    error?: string;
    preview: string;
    applying?: boolean;
  };
  performance: PerformanceViewModel;
  groups: readonly DiagnosticGroup[];
}

export interface DiagnosticsCallbacks {
  onClose: () => void;
  onMobileModalChange?: (isModal: boolean) => void;
  onRecheckDevice: () => void;
  onAutomaticBandwidthEnabledChange: (enabled: boolean) => void;
  onPerformanceSampleDurationChange: (seconds: number) => void;
  onPerformanceMaxDirectionMiBChange: (mebibytes: number) => void;
  onRestartPerformance?: () => void;
  onAdvancedDraftChange: (value: string) => void;
  onTurnAccessCodeChange: (value: string) => void;
  onApplyAdvancedSettings: () => void;
  onCopyReport: () => void;
  onDownloadReport: () => void;
  onShowCompactReport: () => void;
  onCancelPerformance?: () => void;
}
import type { ReactNode } from 'react';
