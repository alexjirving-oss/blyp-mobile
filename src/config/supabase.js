import AsyncStorage from '@react-native-async-storage/async-storage';

// SUPABASE CONFIGURATION
// Values should be provided via env; anon key is public but do not hard-code in repo
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let _supabase = null;

// Lazy initializer to avoid static dependency on @supabase/supabase-js when unused
export async function getSupabase() {
  if (_supabase) return _supabase;
  const pkg = '@supabase/' + 'supabase-js';
  const { createClient } = await import(pkg);
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  _supabase = client;
  return _supabase;
}

// Compatibility no-op exports (kept to prevent import crashes if referenced accidentally)
export const supabase = null; // Use getSupabase() instead
export const auth = null;
export const db = null;
export const storage = null;
