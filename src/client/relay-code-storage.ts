export const TURN_CODE_STORAGE_KEY = 'webrtc-room.turn-access-code';
type CodeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type StorageResult<T> = { ok: true; value: T } | { ok: false; error: string };
const browserStorage = () => window.localStorage;

export function readSavedTurnCode(
  storage: () => CodeStorage = browserStorage,
): StorageResult<string> {
  try {
    return { ok: true, value: storage().getItem(TURN_CODE_STORAGE_KEY) ?? '' };
  } catch {
    return {
      ok: false,
      error: 'Could not load the saved TURN code. You can still enter a code for this tab.',
    };
  }
}

export function saveTurnCode(
  code: string,
  storage: () => CodeStorage = browserStorage,
): StorageResult<undefined> {
  try {
    if (code.trim()) storage().setItem(TURN_CODE_STORAGE_KEY, code);
    else storage().removeItem(TURN_CODE_STORAGE_KEY);
    return { ok: true, value: undefined };
  } catch {
    return {
      ok: false,
      error: code.trim()
        ? 'Could not save the TURN code in this browser. It is only set for this tab.'
        : "Could not remove the saved TURN code. Clear this site's browser data to forget it.",
    };
  }
}
