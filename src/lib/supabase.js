import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = 'https://kotakqdxwvienrmbcrnk.supabase.co';
const supabaseAnonKey = 'sb_publishable_F4akwhacBs2bpKHC2kXpDQ_IVXy4u_9';

// Singleton pattern: prevent multiple GoTrueClient instances
let supabaseInstance = null;

function getSupabaseClient() {
  if (!supabaseInstance) {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
      // Reduce default timeout for faster failure detection on mobile
      db: {
        schema: 'public',
      },
    });
  }
  return supabaseInstance;
}

export const supabase = getSupabaseClient();
