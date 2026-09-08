/// <reference types="vite/client" />

interface Window {
  __WEBRTC_TEST_PERF_LIMITS__?: {
    maxDirectionBytes?: number;
    targetDirectionBytes?: number;
    minSampleDurationMs?: number;
    maxDurationMs?: number;
    pingTimeoutMs?: number;
  };
}
