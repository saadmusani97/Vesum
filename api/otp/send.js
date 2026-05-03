const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 45 * 1000;

function isPhoneValid(p) { return /^\+[1-9]\d{8,14}$/.test(p); }
function generateOtp() { return String(crypto.randomInt(100000, 1000000)); }
function hashOtp(phone, otp) { return crypto.createHash("sha256").update(`${phone}:${otp}`).digest("hex"); }

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { phone, locationName } = req.body || {};
  const normalizedPhone = String(phone || "").trim();
  const normalizedLocation = String(locationName || "Selected location").trim();

  if (!isPhoneValid(normalizedPhone))
    return res.status(400).json({ ok: false, error: "Phone must be in E.164 format like +919876543210" });

  const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

  const now = Date.now();
  const otp = generateOtp();
  const otpHash = hashOtp(normalizedPhone, otp);
  const expiresAt = new Date(now + OTP_TTL_MS).toISOString();
  let challengeId = crypto.randomUUID();

  if (supabase) {
    // Check cooldown
    const { data: existing } = await supabase
      .from("otp_challenges")
      .select("challenge_id, sent_at")
      .eq("phone", normalizedPhone)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const sentAt = new Date(existing.sent_at).getTime();
      if (now - sentAt < OTP_RESEND_COOLDOWN_MS) {
        return res.status(429).json({ ok: false, error: "Please wait before requesting a new OTP", retryAfterMs: OTP_RESEND_COOLDOWN_MS - (now - sentAt) });
      }
      await supabase.from("otp_challenges").update({ used: true }).eq("challenge_id", existing.challenge_id);
    }

    const { data: inserted, error } = await supabase
      .from("otp_challenges")
      .insert({ phone: normalizedPhone, otp_hash: otpHash, expires_at: expiresAt })
      .select("challenge_id")
      .single();

    if (error || !inserted) return res.status(500).json({ ok: false, error: "Could not create OTP session" });
    challengeId = inserted.challenge_id;
  }

  // Twilio SMS
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_FROM_NUMBER;
  let delivery = "dev";

  if (twilioSid && twilioToken && twilioFrom) {
    try {
      const twilio = require("twilio")(twilioSid, twilioToken);
      await twilio.messages.create({
        body: `VESUM OTP ${otp}. Booking at ${normalizedLocation}. Expires in 5 minutes.`,
        from: twilioFrom,
        to: normalizedPhone,
      });
      delivery = "sms";
    } catch {
      return res.status(502).json({ ok: false, error: "Failed to send SMS" });
    }
  } else {
    console.log(`[DEV OTP] ${normalizedPhone}: ${otp}`);
  }

  const response = { ok: true, challengeId, delivery, expiresInSec: 300 };
  if (delivery !== "sms") response.devOtp = otp;
  return res.json(response);
};
