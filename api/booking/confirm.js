const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { phone, societyId, societyName, amountPaid, challengeId } = req.body || {};
  if (!phone || !societyName) return res.status(400).json({ ok: false, error: "phone and societyName required" });

  const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

  if (supabase) {
    const { data, error } = await supabase
      .from("bookings")
      .insert({ phone: String(phone), society_id: societyId || null, society_name: String(societyName), amount_paid: Number(amountPaid) || 0, challenge_id: challengeId || null, status: "confirmed" })
      .select("id, created_at")
      .single();

    if (error) return res.status(500).json({ ok: false, error: "Could not save booking" });
    return res.json({ ok: true, bookingId: data.id, createdAt: data.created_at });
  }

  return res.json({ ok: true, bookingId: crypto.randomUUID(), createdAt: new Date().toISOString() });
};
