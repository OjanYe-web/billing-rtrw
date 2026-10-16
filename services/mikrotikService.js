'use strict';
/**
 * MODUL 2 - Integrasi MikroTik RouterOS API (port standar 8728) via `routeros-client`.
 *
 * - Konfigurasi koneksi dibaca per tenant dari tenants.json (lihat tenantConfig.js).
 * - Jika `mikrotik.enabled` bernilai false, semua fungsi berjalan sebagai SIMULASI
 *   (tidak ada koneksi keluar) dan mengembalikan { simulated: true }.
 * - Semua fungsi publik TIDAK PERNAH melempar error: hasilnya selalu objek
 *   { success, simulated, ... } agar tidak mengganggu alur request Express.
 * - Operasi per tenant diserialisasi (antrian) supaya tidak membuka banyak sesi API
 *   paralel ke router yang sama.
 */
const { RouterOSClient } = require('routeros-client');
const tenantConfig = require('./tenantConfig');

const PPP_SECRET = '/ppp secret';
const PPP_ACTIVE = '/ppp active';
const PPP_PROFILE = '/ppp profile';

const log = (...args) => console.log('[mikrotik]', ...args);

// ---------------------------------------------------------------------------
// Antrian per tenant
// ---------------------------------------------------------------------------
const queues = new Map();
function enqueue(tenantId, task) {
  const key = tenantId || 'default';
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(task);
  queues.set(key, run.catch(() => {}));
  return run;
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------
function errorMessage(err) {
  if (!err) return 'Kesalahan tidak diketahui';
  const raw = String(err.message || err);
  // errno numerik (mis. -4078 di Windows) tidak informatif; gunakan err.code / err.errno bila berupa teks.
  const hay = [err.code, typeof err.errno === 'string' ? err.errno : '', err.name, raw].filter(Boolean).join(' ');
  if (/ECONNREFUSED|-4078|-111/i.test(hay)) return 'Koneksi ditolak: pastikan service API RouterOS aktif (IP > Services > api, port 8728).';
  if (/ETIMEDOUT|SOCKTMOUT|timed? ?out/i.test(hay)) return 'Timeout: router tidak merespons. Periksa IP, port, dan firewall.';
  if (/EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN/i.test(hay)) return 'Router tidak dapat dijangkau dari server billing.';
  if (/cannot log in|invalid user name or password|Username or password is invalid/i.test(hay)) return 'Login ditolak: username/password MikroTik salah.';
  if (/input does not match any value of profile/i.test(hay)) return 'Profile PPP tidak ditemukan di router (periksa nama profile paket & ISOLIR_PROFILE).';
  return raw;
}

function generatePassword(length = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const crypto = require('crypto');
  let out = '';
  for (let i = 0; i < length; i++) out += chars[crypto.randomInt(0, chars.length)];
  return out;
}

const simulatedResult = (extra = {}) => ({
  success: true,
  simulated: true,
  message: 'Mode simulasi: koneksi MikroTik untuk tenant ini belum diaktifkan (tenants.json > mikrotik.enabled).',
  ...extra
});

/**
 * Buka koneksi, jalankan `fn(menu, cfg)`, lalu selalu tutup koneksi.
 * `override` dipakai untuk tes koneksi dengan kredensial dari form.
 */
async function withRouter(tenantId, fn, override = null) {
  const cfg = override
    ? tenantConfig.normalizeMikrotik({ ...override, enabled: true })
    : tenantConfig.getMikrotikConfig(tenantId);

  if (!tenantConfig.isMikrotikLive(cfg)) return { __simulated: true };

  const api = new RouterOSClient({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.pass,
    timeout: cfg.timeout
  });
  // Cegah 'error' event yang tidak tertangani mematikan proses Node.
  api.on('error', (e) => log(`error koneksi ${cfg.host}:`, errorMessage(e)));

  let connected = false;
  try {
    const menu = await api.connect();
    connected = true;
    return await fn(menu, cfg);
  } finally {
    if (connected) {
      try { await api.close(); } catch (_) { /* abaikan */ }
    }
  }
}

/** Jalankan operasi terantrian, ubah error menjadi hasil terstruktur. */
function runSafe(tenantId, fn, override = null) {
  return enqueue(tenantId, async () => {
    try {
      const out = await withRouter(tenantId, fn, override);
      if (out && out.__simulated) return simulatedResult();
      return out;
    } catch (err) {
      const message = errorMessage(err);
      log(`[${tenantId || 'default'}] gagal: ${message}`);
      return { success: false, simulated: false, error: message };
    }
  });
}

const first = (rows) => (Array.isArray(rows) ? rows[0] : rows) || null;

// ---------------------------------------------------------------------------
// Helper level-menu (dipanggil di dalam sesi yang sudah terkoneksi)
// ---------------------------------------------------------------------------
function formatRateLimit(rate) {
  if (!rate) return undefined;
  const str = String(rate).trim();
  if (str.includes('/')) return str;
  const m = str.match(/^(\d+(?:\.\d+)?)\s*([kmg]?bps)?$/i);
  if (m) {
    const val = m[1];
    return `${val}M/${val}M`;
  }
  return str;
}

async function ensureProfile(menu, profileName, rateLimit) {
  if (!profileName || profileName === 'default') return;
  const rows = await menu.menu(PPP_PROFILE).where('name', profileName).get();
  const existing = first(rows);
  const data = {};
  const formattedRate = formatRateLimit(rateLimit);
  if (formattedRate) data.rateLimit = formattedRate;

  if (existing) {
    if (formattedRate && existing.rateLimit !== formattedRate) {
      await menu.menu(PPP_PROFILE).where('name', profileName).update(data);
    }
    return { action: 'exists', profile: profileName };
  }
  await menu.menu(PPP_PROFILE).add({
    name: profileName,
    ...data
  });
  return { action: 'created', profile: profileName };
}

async function findSecret(menu, name) {
  const rows = await menu.menu(PPP_SECRET).where('name', name).get();
  return first(rows);
}

async function kickActiveSession(menu, name) {
  const rows = await menu.menu(PPP_ACTIVE).where('name', name).get();
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  await menu.menu(PPP_ACTIVE).where('name', name).remove();
  return rows.length;
}

function secretComment(customer) {
  return `${customer.customer_id || customer.id} | ${customer.nama || ''}`.slice(0, 120);
}

const isIsolated = (c) => c.status_jaringan === 'Terisolir' || c.status_jaringan === 'Terisolir / Gangguan';

/**
 * Pastikan secret PPPoE untuk satu pelanggan ada & sesuai (idempoten).
 * Mengembalikan { action: 'created' | 'updated', kicked, profile }.
 */
async function ensureSecret(menu, cfg, customer) {
  const name = customer.mikrotikUsername;
  if (!name) throw new Error('Pelanggan belum memiliki mikrotikUsername');

  const profile = isIsolated(customer)
    ? cfg.profile_isolir
    : (customer.mikrotikProfile || 'default');

  // Pastikan profile PPP terdaftar di router jika bukan isolir & ada nama profil
  if (!isIsolated(customer) && customer.mikrotikProfile) {
    try {
      await ensureProfile(menu, customer.mikrotikProfile, customer.paketRateLimit || customer.kecepatan);
    } catch (_) {}
  }

  const data = { profile, comment: secretComment(customer) };
  if (customer.mikrotikPassword) data.password = customer.mikrotikPassword;
  if (cfg.assign_static_ip && customer.ipAddress) data.remoteAddress = customer.ipAddress;

  const existing = await findSecret(menu, name);
  if (existing) {
    await menu.menu(PPP_SECRET).where('name', name).update(data);
    return { action: 'updated', profile, kicked: 0 };
  }

  if (!customer.mikrotikPassword) throw new Error('Password PPPoE belum tersedia untuk membuat secret baru');
  await menu.menu(PPP_SECRET).add({
    name,
    password: customer.mikrotikPassword,
    service: customer.mikrotikService === 'any' ? 'any' : 'pppoe',
    ...data
  });
  return { action: 'created', profile, kicked: 0 };
}

// ---------------------------------------------------------------------------
// API publik
// ---------------------------------------------------------------------------

/** Status aktif/simulasi untuk tenant. */
function isLive(tenantId) {
  return tenantConfig.isMikrotikLive(tenantConfig.getMikrotikConfig(tenantId));
}

/** Tes koneksi + ambil identitas & resource router. `override` = kredensial dari form. */
function testConnection(tenantId, override = null) {
  return runSafe(tenantId, async (menu, cfg) => {
    const identity = first(await menu.menu('/system identity').get());
    const resource = first(await menu.menu('/system resource').get()) || {};
    return {
      success: true,
      simulated: false,
      host: cfg.host,
      port: cfg.port,
      identity: identity && identity.name,
      model: resource.boardName || resource['board-name'],
      version: resource.version ? `RouterOS v${resource.version}` : undefined,
      uptime: resource.uptime,
      cpu_load: resource.cpuLoad !== undefined ? `${resource.cpuLoad}%` : undefined,
      free_memory: resource.freeMemory,
      total_memory: resource.totalMemory
    };
  }, override);
}

/** Informasi router + jumlah sesi PPPoE aktif & secret. */
function getRouterInfo(tenantId) {
  return runSafe(tenantId, async (menu, cfg) => {
    const identity = first(await menu.menu('/system identity').get());
    const resource = first(await menu.menu('/system resource').get()) || {};
    const active = await menu.menu(PPP_ACTIVE).get();
    const secrets = await menu.menu(PPP_SECRET).get();
    return {
      success: true,
      simulated: false,
      host: cfg.host,
      port: cfg.port,
      identity: identity && identity.name,
      model: resource.boardName,
      version: resource.version ? `RouterOS v${resource.version}` : undefined,
      uptime: resource.uptime,
      cpu_load: resource.cpuLoad !== undefined ? `${resource.cpuLoad}%` : undefined,
      free_memory: resource.freeMemory,
      total_memory: resource.totalMemory,
      active_pppoe: Array.isArray(active) ? active.length : 0,
      total_secrets: Array.isArray(secrets) ? secrets.length : 0
    };
  });
}

/**
 * Buat Secret PPPoE baru saat pelanggan terdaftar (idempoten: jika sudah ada akan di-update).
 * `customer.mikrotikPassword` wajib terisi (gunakan generatePassword()).
 */
function createPppoeSecret(tenantId, customer) {
  return runSafe(tenantId, async (menu, cfg) => {
    const r = await ensureSecret(menu, cfg, customer);
    log(`[${tenantId}] secret ${customer.mikrotikUsername} ${r.action} (profile ${r.profile})`);
    return { success: true, simulated: false, ...r, message: `Secret PPPoE ${customer.mikrotikUsername} ${r.action === 'created' ? 'dibuat' : 'diperbarui'} (profile ${r.profile})` };
  });
}

/** Isolir: pindahkan ke ISOLIR_PROFILE lalu putus sesi aktif agar profil baru berlaku. */
function isolateCustomer(tenantId, customer) {
  return runSafe(tenantId, async (menu, cfg) => {
    const name = customer.mikrotikUsername;
    if (!name) throw new Error('Pelanggan belum memiliki mikrotikUsername');
    const secret = await findSecret(menu, name);
    if (!secret) throw new Error(`Secret PPPoE '${name}' tidak ditemukan di router`);
    await menu.menu(PPP_SECRET).where('name', name).update({ profile: cfg.profile_isolir });
    const kicked = await kickActiveSession(menu, name);
    log(`[${tenantId}] isolir ${name} -> ${cfg.profile_isolir} (sesi diputus: ${kicked})`);
    return { success: true, simulated: false, action: 'isolated', profile: cfg.profile_isolir, kicked, message: `${name} dipindahkan ke ${cfg.profile_isolir}` };
  });
}

/** Buka isolir: kembalikan profil normal paket pelanggan lalu putus sesi agar reconnect. */
function restoreCustomer(tenantId, customer) {
  return runSafe(tenantId, async (menu) => {
    const name = customer.mikrotikUsername;
    if (!name) throw new Error('Pelanggan belum memiliki mikrotikUsername');
    const profile = customer.mikrotikProfile || 'default';
    const secret = await findSecret(menu, name);
    if (!secret) throw new Error(`Secret PPPoE '${name}' tidak ditemukan di router`);
    await menu.menu(PPP_SECRET).where('name', name).update({ profile });
    const kicked = await kickActiveSession(menu, name);
    log(`[${tenantId}] restore ${name} -> ${profile} (sesi diputus: ${kicked})`);
    return { success: true, simulated: false, action: 'restored', profile, kicked, message: `${name} dikembalikan ke profile ${profile}` };
  });
}

/**
 * Isolir banyak pelanggan dalam SATU sesi koneksi (auto-isolir saat jatuh tempo).
 * Mengembalikan { success, results: [{ id, success, error? }] }.
 */
function isolateMany(tenantId, customers) {
  return runSafe(tenantId, async (menu, cfg) => {
    const results = [];
    for (const c of customers) {
      try {
        const secret = c.mikrotikUsername ? await findSecret(menu, c.mikrotikUsername) : null;
        if (!secret) throw new Error(`Secret '${c.mikrotikUsername || '-'}' tidak ditemukan`);
        await menu.menu(PPP_SECRET).where('name', c.mikrotikUsername).update({ profile: cfg.profile_isolir });
        await kickActiveSession(menu, c.mikrotikUsername);
        results.push({ id: c.id, success: true });
      } catch (e) {
        results.push({ id: c.id, success: false, error: errorMessage(e) });
      }
    }
    log(`[${tenantId}] auto-isolir: ${results.filter((r) => r.success).length}/${results.length} berhasil`);
    return { success: true, simulated: false, results };
  });
}

/**
 * Sinkronisasi massal billing -> router dalam satu sesi: buat/perbarui secret sesuai
 * status jaringan (profil paket atau ISOLIR_PROFILE). Tidak memutus sesi aktif.
 */
function syncCustomers(tenantId, customers) {
  return runSafe(tenantId, async (menu, cfg) => {
    const results = [];
    for (const c of customers) {
      try {
        const r = await ensureSecret(menu, cfg, c);
        results.push({ id: c.id, success: true, action: r.action, profile: r.profile });
      } catch (e) {
        results.push({ id: c.id, success: false, error: errorMessage(e) });
      }
    }
    return { success: true, simulated: false, results };
  });
}

/** Sinkronkan / buat profil PPP di router dengan rate-limit tertentu */
function syncProfile(tenantId, { name, rateLimit }) {
  return runSafe(tenantId, async (menu) => {
    const r = await ensureProfile(menu, name, rateLimit);
    log(`[${tenantId}] profile ${name} ${r.action}`);
    return { success: true, simulated: false, ...r, message: `Profile '${name}' berhasil disinkronkan ke MikroTik` };
  });
}

// ---------------------------------------------------------------------------
// MODUL HOTSPOT VOUCHER & PELACAKAN SESI AKTIF (BayarWifi 3.0)
// ---------------------------------------------------------------------------
const HOTSPOT_USER = '/ip hotspot user';
const HOTSPOT_ACTIVE = '/ip hotspot active';
const HOTSPOT_PROFILE = '/ip hotspot user profile';

async function ensureHotspotProfile(menu, profile) {
  const name = profile.mikrotik_profile || profile.nama || 'default';
  if (!name || name === 'default') return { action: 'default', profile: 'default' };

  const rows = await menu.menu(HOTSPOT_PROFILE).where('name', name).get();
  const existing = first(rows);
  const payload = {
    name,
    sharedUsers: String(profile.shared_users || 1)
  };
  const formattedRate = formatRateLimit(profile.rate_limit || profile.kecepatan);
  if (formattedRate) payload.rateLimit = formattedRate;

  if (existing) {
    await menu.menu(HOTSPOT_PROFILE).where('name', name).update(payload);
    return { action: 'updated', profile: name };
  }
  await menu.menu(HOTSPOT_PROFILE).add(payload);
  return { action: 'created', profile: name };
}

/** Sinkronisasi profil paket Hotspot ke MikroTik (/ip hotspot user profile) */
function syncHotspotProfile(tenantId, profile) {
  return runSafe(tenantId, async (menu) => {
    const r = await ensureHotspotProfile(menu, profile);
    log(`[${tenantId}] hotspot profile ${r.profile} ${r.action}`);
    return { success: true, simulated: false, ...r, message: `Hotspot profile '${r.profile}' berhasil disinkronkan` };
  });
}

/** Buat satu atau banyak voucher Hotspot di MikroTik (/ip hotspot user) */
function createHotspotVouchers(tenantId, vouchers = []) {
  const list = Array.isArray(vouchers) ? vouchers : [vouchers];
  return runSafe(tenantId, async (menu) => {
    const results = [];
    for (const v of list) {
      try {
        const rows = await menu.menu(HOTSPOT_USER).where('name', v.kode_voucher).get();
        const existing = first(rows);
        const payload = {
          name: v.kode_voucher,
          password: v.password || v.kode_voucher,
          profile: v.mikrotik_profile || 'default',
          comment: `VCR|${v.batch_code || 'SINGLE'}|${v.nama_paket || ''}|${v.kasir || 'Admin'}`.slice(0, 120)
        };
        if (v.uptime_limit) payload.limitUptime = v.uptime_limit;
        if (v.quota_bytes && Number(v.quota_bytes) > 0) payload.limitBytesTotal = String(v.quota_bytes);

        if (existing) {
          await menu.menu(HOTSPOT_USER).where('name', v.kode_voucher).update(payload);
          results.push({ kode_voucher: v.kode_voucher, success: true, action: 'updated' });
        } else {
          await menu.menu(HOTSPOT_USER).add(payload);
          results.push({ kode_voucher: v.kode_voucher, success: true, action: 'created' });
        }
      } catch (e) {
        results.push({ kode_voucher: v.kode_voucher, success: false, error: errorMessage(e) });
      }
    }
    return {
      success: true,
      simulated: false,
      synced_count: results.filter((r) => r.success).length,
      results
    };
  });
}

/** Hapus voucher Hotspot dari MikroTik & putus sesi aktif jika sedang online */
function removeHotspotVoucher(tenantId, kodeVoucher) {
  return runSafe(tenantId, async (menu) => {
    const activeRows = await menu.menu(HOTSPOT_ACTIVE).where('user', kodeVoucher).get();
    if (Array.isArray(activeRows) && activeRows.length > 0) {
      await menu.menu(HOTSPOT_ACTIVE).where('user', kodeVoucher).remove();
    }
    const userRows = await menu.menu(HOTSPOT_USER).where('name', kodeVoucher).get();
    if (Array.isArray(userRows) && userRows.length > 0) {
      await menu.menu(HOTSPOT_USER).where('name', kodeVoucher).remove();
    }
    return { success: true, simulated: false, kode_voucher: kodeVoucher, removed: true };
  });
}

/** Ambil daftar sesi aktif PPPoE & Hotspot dari router untuk pelacakan pelanggan offline */
function getActiveSessions(tenantId) {
  return runSafe(tenantId, async (menu) => {
    const pppActive = await menu.menu(PPP_ACTIVE).get();
    let hsActive = [];
    try {
      hsActive = await menu.menu(HOTSPOT_ACTIVE).get();
    } catch (_) {}
    return {
      success: true,
      simulated: false,
      pppoe_active: Array.isArray(pppActive) ? pppActive : [],
      hotspot_active: Array.isArray(hsActive) ? hsActive : []
    };
  });
}

module.exports = {
  generatePassword,
  isLive,
  testConnection,
  getRouterInfo,
  syncProfile,
  createPppoeSecret,
  isolateCustomer,
  restoreCustomer,
  isolateMany,
  syncCustomers,
  syncHotspotProfile,
  createHotspotVouchers,
  removeHotspotVoucher,
  getActiveSessions,
  _errorMessage: errorMessage
};

