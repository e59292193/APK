/**
 * Converts a UTC date string from Supabase to a local formatted string.
 * @param {string} utcString - The UTC string (e.g., "2026-06-08T14:07:00Z")
 * @returns {string} Formatted local date string "YYYY/MM/DD"
 */
export function formatLocalDate(utcString) {
  if (!utcString) return '';
  const date = new Date(utcString);
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}/${m}/${d}`;
}

/**
 * Converts a UTC date string from Supabase to a local formatted time string.
 * @param {string} utcString
 * @returns {string} Formatted local time string "HH:mm"
 */
export function formatLocalTime(utcString) {
  if (!utcString) return '';
  const date = new Date(utcString);
  const h = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${min}`;
}

/**
 * Converts a UTC date string to full local date and time.
 * Optimized: parses Date only once instead of delegating to formatLocalDate + formatLocalTime.
 * @param {string} utcString
 * @returns {string} "YYYY/MM/DD HH:mm"
 */
export function formatLocalDateTime(utcString) {
  if (!utcString) return '';
  const date = new Date(utcString);
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  const h = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  return `${y}/${m}/${d} ${h}:${min}`;
}

/**
 * Calculates countdown parts from a UTC target string.
 * @param {string} targetUtcString
 * @returns {string|null} Countdown string or null if already reached
 */
export function getCountdown(targetUtcString) {
  if (!targetUtcString) return null;
  const now = Date.now();
  const target = new Date(targetUtcString).getTime();
  let diff = target - now;

  if (diff <= 0) return null;

  const days = Math.floor(diff / 86400000);
  diff %= 86400000;
  const hours = Math.floor(diff / 3600000);
  diff %= 3600000;
  const minutes = Math.floor(diff / 60000);
  diff %= 60000;
  const seconds = Math.floor(diff / 1000);

  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  parts.push(`${String(hours).padStart(2, '0')}时`);
  parts.push(`${String(minutes).padStart(2, '0')}分`);
  parts.push(`${String(seconds).padStart(2, '0')}秒`);
  return parts.join(' ');
}
