let debugEnabled = false;

export function setDebugEnabled(value) {
  debugEnabled = value === true;
}

export function isDebugEnabled() {
  return debugEnabled;
}

export function debugLog(...args) {
  if (debugEnabled) console.debug(...args);
}
