const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const MAX_VERIFY_ATTEMPTS = 5;

function isPhoneValid(p) { return /^\+[1-9]\d{8,14}$/.test(p); }
function hashOtp(phone, otp) { return crypto.createHash("sha256").update(`${phone}:${otp}`).digest("hex"); }
function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a), "hex"), bb = Buffer.from(String(b), "hex");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { phone, otp, challengeId } = req.body || {};
  const normalizedPhone = String(phone || "").trim();
  const normalizedOtp = String(otp || "").trim();
  const normalizedChallengeId = String(challengeId || "").trim();

  if (!isPhoneValid(normalizedPhone)) return res.status(400).json({ ok: false, error: "Invalid phone format" });
  if (!normalizedChallengeId) return res.status(400).json({ ok: false, error: "OTP challenge missing" });
  if (!/^\d{6}$/.test(normalizedOtp)) return res.status(400).json({ ok: false, error: "OTP must be 6 digits" });

  const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

  if (supabase) {
    const { data: record } = await supabase
      .from("otp_challenges")
      .select("*")
      .eq("challenge_id", normalizedChallengeId)
      .maybeSingle();

    if (!record) return res.status(400).json({ ok: false, error: "No active OTP session" });
    if (record.phone !== normalizedPhone) return res.status(400).json({ ok: false, error: "Session mismatch" });
    if (record.used) return res.status(400).json({ ok: false, error: "OTP already used" });
    if (new Date(record.expires_at).getTime() < Date.now()) return res.status(400).json({ ok: false, error: "OTP expired" });
    if (record.attempts >= MAX_VERIFY_ATTEMPTS) return res.status(429).json({ ok: false, error: "Too many attempts" });

    if (!safeEqualHex(hashOtp(normalizedPhone, normalizedOtp), record.otp_hash)) {
      await supabase.from("otp_challenges").update({ attempts: record.attempts + 1 }).eq("challenge_id", normalizedChallengeId);
      return res.status(400).json({ ok: false, error: "Incorrect OTP" });
    }

    await supabase.from("otp_challenges").update({ used: true }).eq("challenge_id", normalizedChallengeId);
    return res.json({ ok: true, message: "OTP verified. Booking unlocked." });
  }

  // No DB fallback — accept any 6-digit OTP in dev
  return res.json({ ok: true, message: "OTP verified (dev mode)." });
};
