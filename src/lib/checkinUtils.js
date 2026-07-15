/**
 * Shared checkin utility functions.
 * Ensures consistent today-count logic across all screens.
 */

import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';

/**
 * Get the ISO string boundaries for "today" in the user's local timezone.
 * Returns { todayStart, todayEnd } as ISO strings.
 */
export function getTodayRange() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
  return { todayStart, todayEnd };
}

/**
 * Query Supabase for the number of checkin records created today (local timezone)
 * for a given theme_id, filtered by a SPECIFIC user.
 * This is the single source of truth for personal daily counts.
 *
 * @param {string} themeId - The checkin theme ID
 * @param {string} userId - The specific user ID to count for
 * @returns {Promise<number>} The count of today's records for this user (0 if none)
 */
export async function fetchTodayCount(themeId, userId) {
  const { todayStart, todayEnd } = getTodayRange();

  let query = supabase
    .from('checkin_records')
    .select('*', { count: 'exact', head: true })
    .eq('theme_id', themeId)
    .gte('created_at', todayStart)
    .lte('created_at', todayEnd);

  // If userId is provided, filter to only that user's records
  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { count, error } = await fetchWithTimeout(() => query);

  if (error) {
    console.error('Error fetching today count:', error);
    return 0;
  }

  return count || 0;
}
