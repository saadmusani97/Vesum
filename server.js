const crypto = require("crypto");
const path   = require("path");
const express = require("express");
const dotenv  = require("dotenv");

dotenv.config();

const { supabase } = require("./db");
const app  = express();
const port = Number(process.env.PORT || 4173);

app.use(express.json());
app.use(express.static(path.resolve(__dirname)));

// ── Twilio ────────────────────────────────────────────────────────
const twilioSid     = process.env.TWILIO_ACCOUNT_SID  || "";
const twilioToken   = process.env.TWILIO_AUTH_TOKEN   || "";
const twilioFrom    = process.env.TWILIO_FROM_NUMBER  || "";
const twilioEnabled = Boolean(twilioSid && twilioToken && twilioFrom);
const twilioClient  = twilioEnabled ? require("twilio")(twilioSid, twilioToken) : null;

// ── Constants ─────────────────────────────────────────────────────
const OTP_TTL_MS             = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 45 * 1000;
const MAX_VERIFY_ATTEMPTS    = 5;

// ── Helpers ───────────────────────────────────────────────────────
function isPhoneValid(phone) {
  return /^\+[1-9]\d{8,14}$/.test(phone);
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(phone, otp) {
  return crypto.createHash("sha256").update(`${phone}:${otp}`).digest("hex");
}

function safeEqualHex(hexA, hexB) {
  const a = Buffer.from(String(hexA), "hex");
  const b = Buffer.from(String(hexB), "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

function distanceLabel(meters) {
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`;
}

function offsetLatLng(lat, lng, distanceMeters, angleRadians) {
  const R  = 6378137;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const δ  = distanceMeters / R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(angleRadians));
  const λ2 = λ1 + Math.atan2(Math.sin(angleRadians) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [φ2 * (180 / Math.PI), λ2 * (180 / Math.PI)];
}

const societyNames = [
  "Shanti Vihar CHS", "Gokul Residency", "Sai Darshan Heights",
  "Lakeview CHS", "Green Meadows Society", "Palm Grove Apartments",
  "Lotus Enclave", "Sunrise CHS",
];

function generateLocations(lat, lng) {
  const cLat = clamp(Number(lat) || 19.1197, -80, 80);
  const cLng = clamp(Number(lng) || 72.8468, -170, 170);
  return Array.from({ length: 8 }, (_, i) => {
    const dist  = 240 + i * 150 + Math.random() * 350;
    const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.55;
    const [locLat, locLng] = offsetLatLng(cLat, cLng, dist, angle);
    return {
      id: `soc-${i + 1}`,
      name: societyNames[i % societyNames.length],
      slots: 6 + Math.floor(Math.random() * 24),
      distanceMeters: Math.round(dist),
      distanceLabel: distanceLabel(dist),
      ratePerHourInr: 60 + Math.floor(Math.random() * 170),
      latitude:  Number(locLat.toFixed(6)),
      longitude: Number(locLng.toFixed(6)),
    };
  }).sort((a, b) => a.distanceMeters - b.distanceMeters);
}

// ── In-memory fallback (when Supabase not configured) ─────────────
const memOtpStore       = new Map();
const memPhoneSessionIdx = new Map();

// ── API: Locations ────────────────────────────────────────────────
app.get("/api/locations", async (req, res) => {
  // Try to pull from Supabase societies table first
  if (supabase) {
    const { data, error } = await supabase
      .from("societies")
      .select("id, name, slots_available, rate_per_hour, latitude, longitude");

    if (!error && data?.length) {
      const userLat = clamp(Number(req.query.lat) || 19.1197, -80, 80);
      const userLng = clamp(Number(req.query.lng) || 72.8468, -170, 170);

      const locations = data.map((s) => {
        const dLat = (s.latitude  - userLat) * 111320;
        const dLng = (s.longitude - userLng) * 111320 * Math.cos(userLat * Math.PI / 180);
        const dist = Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
        return {
          id:             s.id,
          name:           s.name,
          slots:          s.slots_available,
          distanceMeters: dist,
          distanceLabel:  distanceLabel(dist),
          ratePerHourInr: s.rate_per_hour,
          latitude:       s.latitude,
          longitude:      s.longitude,
        };
      }).sort((a, b) => a.distanceMeters - b.distanceMeters);

      return res.json({ ok: true, locations });
    }
  }

  // Fallback: generate dynamically
  res.json({ ok: true, locations: generateLocations(req.query.lat, req.query.lng) });
});

// ── API: Send OTP ─────────────────────────────────────────────────
app.post("/api/otp/send", async (req, res) => {
  const { phone, locationName } = req.body || {};
  const normalizedPhone    = String(phone        || "").trim();
  const normalizedLocation = String(locationName || "Selected location").trim();

  if (!isPhoneValid(normalizedPhone)) {
    return res.status(400).json({ ok: false, error: "Phone must be in E.164 format like +919876543210" });
  }

  const now = Date.now();

  // ── Supabase path ──
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
        return res.status(429).json({
          ok: false,
          error: "Please wait before requesting a new OTP",
          retryAfterMs: OTP_RESEND_COOLDOWN_MS - (now - sentAt),
        });
      }
      // Invalidate old challenge
      await supabase.from("otp_challenges").update({ used: true }).eq("challenge_id", existing.challenge_id);
    }

    const otp         = generateOtp();
    const otpHash     = hashOtp(normalizedPhone, otp);
    const expiresAt   = new Date(now + OTP_TTL_MS).toISOString();

    const { data: inserted, error: insertErr } = await supabase
      .from("otp_challenges")
      .insert({ phone: normalizedPhone, otp_hash: otpHash, expires_at: expiresAt })
      .select("challenge_id")
      .single();

    if (insertErr || !inserted) {
      console.error("[OTP] Insert error:", insertErr);
      return res.status(500).json({ ok: false, error: "Could not create OTP session" });
    }

    return await sendOtpAndRespond(res, normalizedPhone, normalizedLocation, otp, inserted.challenge_id);
  }

  // ── In-memory fallback ──
  const activeChallenge = memPhoneSessionIdx.get(normalizedPhone);
  if (activeChallenge) {
    const record = memOtpStore.get(activeChallenge);
    if (record && now - record.sentAt < OTP_RESEND_COOLDOWN_MS) {
      return res.status(429).json({ ok: false, error: "Please wait before requesting a new OTP", retryAfterMs: OTP_RESEND_COOLDOWN_MS - (now - record.sentAt) });
    }
    memOtpStore.delete(activeChallenge);
  }

  const otp         = generateOtp();
  const challengeId = crypto.randomUUID();
  memOtpStore.set(challengeId, { phone: normalizedPhone, otpHash: hashOtp(normalizedPhone, otp), sentAt: now, expiresAt: now + OTP_TTL_MS, attempts: 0, used: false });
  memPhoneSessionIdx.set(normalizedPhone, challengeId);

  return await sendOtpAndRespond(res, normalizedPhone, normalizedLocation, otp, challengeId);
});

async function sendOtpAndRespond(res, phone, locationName, otp, challengeId) {
  const messageBody = `VESUM OTP ${otp}. Use this code to continue booking at ${locationName}. Expires in 5 minutes.`;
  let delivery = "dev";

  if (twilioEnabled && twilioClient) {
    try {
      await twilioClient.messages.create({ body: messageBody, from: twilioFrom, to: phone });
      delivery = "sms";
    } catch (err) {
      return res.status(502).json({ ok: false, error: "Failed to send SMS. Check Twilio credentials." });
    }
  } else {
    console.log(`[DEV OTP] ${phone}: ${otp}`);
  }

  const response = { ok: true, challengeId, delivery, expiresInSec: 300, message: delivery === "sms" ? "OTP sent" : "Dev mode OTP" };
  if (delivery !== "sms") response.devOtp = otp;
  return res.json(response);
}

// ── API: Verify OTP ───────────────────────────────────────────────
app.post("/api/otp/verify", async (req, res) => {
  const { phone, otp, challengeId } = req.body || {};
  const normalizedPhone       = String(phone       || "").trim();
  const normalizedOtp         = String(otp         || "").trim();
  const normalizedChallengeId = String(challengeId || "").trim();

  if (!isPhoneValid(normalizedPhone))    return res.status(400).json({ ok: false, error: "Invalid phone format" });
  if (!normalizedChallengeId)            return res.status(400).json({ ok: false, error: "OTP challenge missing" });
  if (!/^\d{6}$/.test(normalizedOtp))   return res.status(400).json({ ok: false, error: "OTP must be 6 digits" });

  // ── Supabase path ──
  if (supabase) {
    const { data: record, error } = await supabase
      .from("otp_challenges")
      .select("*")
      .eq("challenge_id", normalizedChallengeId)
      .maybeSingle();

    if (error || !record) return res.status(400).json({ ok: false, error: "No active OTP session" });
    if (record.phone !== normalizedPhone) return res.status(400).json({ ok: false, error: "Session mismatch" });
    if (record.used)  return res.status(400).json({ ok: false, error: "OTP already used. Request a new one." });
    if (new Date(record.expires_at).getTime() < Date.now()) return res.status(400).json({ ok: false, error: "OTP expired. Request a new one." });
    if (record.attempts >= MAX_VERIFY_ATTEMPTS) return res.status(429).json({ ok: false, error: "Too many attempts. Request a new OTP." });

    if (!safeEqualHex(hashOtp(normalizedPhone, normalizedOtp), record.otp_hash)) {
      await supabase.from("otp_challenges").update({ attempts: record.attempts + 1 }).eq("challenge_id", normalizedChallengeId);
      return res.status(400).json({ ok: false, error: "Incorrect OTP" });
    }

    await supabase.from("otp_challenges").update({ used: true }).eq("challenge_id", normalizedChallengeId);
    return res.json({ ok: true, message: "OTP verified. Booking unlocked." });
  }

  // ── In-memory fallback ──
  const record = memOtpStore.get(normalizedChallengeId);
  if (!record) return res.status(400).json({ ok: false, error: "No active OTP session" });
  if (record.phone !== normalizedPhone) return res.status(400).json({ ok: false, error: "Session mismatch" });
  if (record.used)  { memOtpStore.delete(normalizedChallengeId); return res.status(400).json({ ok: false, error: "OTP already used" }); }
  if (Date.now() > record.expiresAt) { memOtpStore.delete(normalizedChallengeId); return res.status(400).json({ ok: false, error: "OTP expired" }); }
  if (record.attempts >= MAX_VERIFY_ATTEMPTS) { memOtpStore.delete(normalizedChallengeId); return res.status(429).json({ ok: false, error: "Too many attempts" }); }

  if (!safeEqualHex(hashOtp(normalizedPhone, normalizedOtp), record.otpHash)) {
    record.attempts += 1;
    return res.status(400).json({ ok: false, error: "Incorrect OTP" });
  }

  record.used = true;
  memOtpStore.delete(normalizedChallengeId);
  memPhoneSessionIdx.delete(normalizedPhone);
  return res.json({ ok: true, message: "OTP verified. Booking unlocked." });
});

// ── API: Confirm Booking ──────────────────────────────────────────
app.post("/api/booking/confirm", async (req, res) => {
  const { phone, societyId, societyName, amountPaid, challengeId } = req.body || {};

  if (!phone || !societyName) {
    return res.status(400).json({ ok: false, error: "phone and societyName are required" });
  }

  if (supabase) {
    const { data, error } = await supabase
      .from("bookings")
      .insert({
        phone:        String(phone),
        society_id:   societyId   || null,
        society_name: String(societyName),
        amount_paid:  Number(amountPaid) || 0,
        challenge_id: challengeId || null,
        status:       "confirmed",
      })
      .select("id, created_at")
      .single();

    if (error) {
      console.error("[Booking] Insert error:", error);
      return res.status(500).json({ ok: false, error: "Could not save booking" });
    }

    return res.json({ ok: true, bookingId: data.id, createdAt: data.created_at });
  }

  // Fallback — no DB
  return res.json({ ok: true, bookingId: crypto.randomUUID(), createdAt: new Date().toISOString() });
});

// ── API: Get Bookings for a phone ─────────────────────────────────
app.get("/api/bookings", async (req, res) => {
  const phone = String(req.query.phone || "").trim();
  if (!isPhoneValid(phone)) return res.status(400).json({ ok: false, error: "Invalid phone" });

  if (supabase) {
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("phone", phone)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ ok: false, error: "Could not fetch bookings" });
    return res.json({ ok: true, bookings: data });
  }

  return res.json({ ok: true, bookings: [] });
});

// ── Health ────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, twilioEnabled, supabaseEnabled: Boolean(supabase) });
});

// ── SPA fallback ──────────────────────────────────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`VESUM server → http://127.0.0.1:${port}`);
  console.log(`  Twilio:   ${twilioEnabled ? "✓ enabled" : "✗ dev mode"}`);
  console.log(`  Supabase: ${supabase      ? "✓ connected" : "✗ in-memory fallback"}`);
});
