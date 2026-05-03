const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL || "";

// Service role key — full access, used server-side only (never expose to browser)
const serviceKey  = process.env.SUPABASE_SERVICE_KEY || "";

// Publishable/anon key — safe for browser, used as fallback if no service key
const anonKey     = process.env.SUPABASE_ANON_KEY || "";

const activeKey = serviceKey || anonKey;

if (!supabaseUrl) {
  console.warn("[DB] SUPABASE_URL not set — database features disabled.");
} else if (!activeKey) {
  console.warn("[DB] No Supabase key set — database features disabled.");
}

const supabase = (supabaseUrl && activeKey)
  ? createClient(supabaseUrl, activeKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

if (supabase) {
  const keyType = serviceKey ? "service_role" : "anon/publishable";
  console.log(`[DB] Supabase connected → ${supabaseUrl} (${keyType})`);
}

module.exports = { supabase };
