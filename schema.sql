-- ─────────────────────────────────────────────
-- VESUM — Supabase Schema
-- Run this once in your Supabase SQL editor
-- ─────────────────────────────────────────────

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ── Societies (parking locations) ────────────
create table if not exists societies (
  id               text primary key,
  name             text not null,
  slots_total      int  not null default 20,
  slots_available  int  not null default 20,
  rate_per_hour    int  not null default 120,   -- INR
  latitude         numeric(10,6),
  longitude        numeric(10,6),
  created_at       timestamptz default now()
);

-- ── OTP Challenges ────────────────────────────
create table if not exists otp_challenges (
  challenge_id   uuid primary key default gen_random_uuid(),
  phone          text not null,
  otp_hash       text not null,
  sent_at        timestamptz not null default now(),
  expires_at     timestamptz not null,
  attempts       int not null default 0,
  used           boolean not null default false
);

-- Auto-delete expired OTPs after 10 minutes (optional, via pg_cron or just let server clean up)
create index if not exists idx_otp_phone on otp_challenges(phone);

-- ── Bookings ──────────────────────────────────
create table if not exists bookings (
  id             uuid primary key default gen_random_uuid(),
  phone          text not null,
  society_id     text references societies(id),
  society_name   text,
  amount_paid    int  not null default 0,       -- INR
  status         text not null default 'confirmed',  -- confirmed | cancelled | completed
  challenge_id   uuid,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists idx_bookings_phone  on bookings(phone);
create index if not exists idx_bookings_status on bookings(status);

-- ── Seed a few societies ──────────────────────
insert into societies (id, name, slots_total, slots_available, rate_per_hour, latitude, longitude)
values
  ('soc-1', 'Shanti Vihar CHS',      30, 18, 120, 19.1210, 72.8480),
  ('soc-2', 'Gokul Residency',        20, 12, 100, 19.1185, 72.8455),
  ('soc-3', 'Sai Darshan Heights',    25, 20,  80, 19.1220, 72.8500),
  ('soc-4', 'Lakeview CHS',           15,  8, 150, 19.1175, 72.8470),
  ('soc-5', 'Green Meadows Society',  40, 30,  90, 19.1230, 72.8440),
  ('soc-6', 'Palm Grove Apartments',  18,  5, 130, 19.1160, 72.8490),
  ('soc-7', 'Lotus Enclave',          22, 15, 110, 19.1200, 72.8510),
  ('soc-8', 'Sunrise CHS',            35, 25,  70, 19.1190, 72.8460)
on conflict (id) do nothing;
