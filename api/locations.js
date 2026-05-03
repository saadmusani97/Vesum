const { createClient } = require("@supabase/supabase-js");

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

function distanceLabel(meters) {
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`;
}

function offsetLatLng(lat, lng, dist, angle) {
  const R = 6378137;
  const φ1 = (lat * Math.PI) / 180, λ1 = (lng * Math.PI) / 180, δ = dist / R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(angle));
  const λ2 = λ1 + Math.atan2(Math.sin(angle) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [φ2 * (180 / Math.PI), λ2 * (180 / Math.PI)];
}

const societyNames = [
  "Shanti Vihar CHS","Gokul Residency","Sai Darshan Heights",
  "Lakeview CHS","Green Meadows Society","Palm Grove Apartments",
  "Lotus Enclave","Sunrise CHS",
];

function generateLocations(lat, lng) {
  const cLat = clamp(Number(lat) || 19.1197, -80, 80);
  const cLng = clamp(Number(lng) || 72.8468, -170, 170);
  return Array.from({ length: 8 }, (_, i) => {
    const dist = 240 + i * 150 + Math.random() * 350;
    const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.55;
    const [locLat, locLng] = offsetLatLng(cLat, cLng, dist, angle);
    return {
      id: `soc-${i + 1}`,
      name: societyNames[i % societyNames.length],
      slots: 6 + Math.floor(Math.random() * 24),
      distanceMeters: Math.round(dist),
      distanceLabel: distanceLabel(dist),
      ratePerHourInr: 60 + Math.floor(Math.random() * 170),
      latitude: Number(locLat.toFixed(6)),
      longitude: Number(locLng.toFixed(6)),
    };
  }).sort((a, b) => a.distanceMeters - b.distanceMeters);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

  if (supabase) {
    const { data, error } = await supabase
      .from("societies")
      .select("id, name, slots_available, rate_per_hour, latitude, longitude");

    if (!error && data?.length) {
      const userLat = clamp(Number(req.query.lat) || 19.1197, -80, 80);
      const userLng = clamp(Number(req.query.lng) || 72.8468, -170, 170);
      const locations = data.map((s) => {
        const dLat = (s.latitude - userLat) * 111320;
        const dLng = (s.longitude - userLng) * 111320 * Math.cos(userLat * Math.PI / 180);
        const dist = Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
        return { id: s.id, name: s.name, slots: s.slots_available, distanceMeters: dist, distanceLabel: distanceLabel(dist), ratePerHourInr: s.rate_per_hour, latitude: s.latitude, longitude: s.longitude };
      }).sort((a, b) => a.distanceMeters - b.distanceMeters);
      return res.json({ ok: true, locations });
    }
  }

  res.json({ ok: true, locations: generateLocations(req.query.lat, req.query.lng) });
};
