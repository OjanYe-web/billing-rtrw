'use strict';
/**
 * MODUL 1 - Konfigurasi jaringan per tenant (tenants.json)
 *
 * Setiap tenant memiliki dua blok konfigurasi:
 *   mikrotik: { enabled, host, port, user, pass, profile_isolir, timeout, assign_static_ip }
 *   olt:      { enabled, vendor, protocol, host, port, user, pass, enable_pass, ... }
 *
 * Prinsip keamanan:
 *  - `enabled` default FALSE. Selama false, layanan berjalan dalam mode simulasi
 *    sehingga perilaku aplikasi lama tidak berubah dan tidak ada koneksi keluar.
 *  - Password tidak pernah dikembalikan ke browser (lihat maskNetworkConfig).
 */
const fs = require('fs');
const path = require('path');

// BILLING_TENANTS_FILE hanya untuk pengujian (mengarahkan ke file tenants tiruan).
const TENANTS_FILE = process.env.BILLING_TENANTS_FILE || path.join(__dirname, '..', 'tenants.json');

const DEFAULT_MIKROTIK = Object.freeze({
  enabled: false,
  host: '',
  port: 8728,
  user: 'admin',
  pass: '',
  profile_isolir: 'ISOLIR_PROFILE',
  timeout: 8,              // detik
  assign_static_ip: false  // true => isi remote-address secret dari customer.ipAddress
});

const DEFAULT_OLT = Object.freeze({
  enabled: false,
  vendor: 'epon',          // 'epon' | 'gpon' | 'zte' | 'zte_epon' | 'huawei' | 'vsol' | 'hioso' | 'bdcom' | 'hsqg' | 'cdata'
  protocol: 'telnet',      // 'telnet' | 'ssh'
  host: '',
  port: 23,                // default 23 untuk telnet, 22 untuk ssh
  user: '',
  pass: '',
  enable_pass: '',         // opsional (misal password 'enable' untuk privileged exec mode)
  timeout: 15,             // detik
  legacy_algorithms: true, // izinkan kex/cipher lama yang masih dipakai banyak OLT (SSH)
  rx_warning_dbm: -25,     // ONU Rx <= nilai ini => warning
  rx_critical_dbm: -27,    // ONU Rx <= nilai ini => critical
  auto_monitor: false      // true => dipindai berkala oleh cron di server.js
});

function readTenantsRaw() {
  if (!fs.existsSync(TENANTS_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeTenantsRaw(list) {
  const tmp = TENANTS_FILE + '.tmp';
  const str = JSON.stringify(list, null, 2);
  fs.writeFileSync(tmp, str, 'utf8');
  try {
    fs.renameSync(tmp, TENANTS_FILE);
  } catch (_) {
    fs.writeFileSync(TENANTS_FILE, str, 'utf8');
    try { fs.unlinkSync(tmp); } catch (__) { /* abaikan */ }
  }
}

const toInt = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
};
const toNum = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const toStr = (v, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);

function normalizeMikrotik(src = {}) {
  const s = src || {};
  return {
    enabled: s.enabled === true,
    host: toStr(s.host),
    port: toInt(s.port, DEFAULT_MIKROTIK.port),
    user: toStr(s.user, DEFAULT_MIKROTIK.user) || DEFAULT_MIKROTIK.user,
    pass: typeof s.pass === 'string' ? s.pass : '',
    profile_isolir: toStr(s.profile_isolir) || DEFAULT_MIKROTIK.profile_isolir,
    timeout: toInt(s.timeout, DEFAULT_MIKROTIK.timeout),
    assign_static_ip: s.assign_static_ip === true
  };
}

const SUPPORTED_OLT_VENDORS = [
  'epon', 'gpon', 'vsol', 'hioso', 'bdcom', 'hsqg', 'cdata',
  'zte', 'zte_epon', 'zte_gpon', 'huawei'
];

function normalizeOlt(src = {}) {
  const s = src || {};
  const vendor = String(s.vendor || DEFAULT_OLT.vendor).toLowerCase().replace(/[^a-z0-9_]/g, '');
  const protocol = toStr(s.protocol, DEFAULT_OLT.protocol).toLowerCase();
  const defPort = protocol === 'ssh' ? 22 : 23;

  return {
    enabled: s.enabled === true,
    vendor: SUPPORTED_OLT_VENDORS.includes(vendor) ? vendor : DEFAULT_OLT.vendor,
    protocol: ['ssh', 'telnet'].includes(protocol) ? protocol : 'telnet',
    host: toStr(s.host),
    port: toInt(s.port, defPort),
    user: toStr(s.user),
    pass: typeof s.pass === 'string' ? s.pass : '',
    enable_pass: typeof s.enable_pass === 'string' ? s.enable_pass : '',
    timeout: toInt(s.timeout, DEFAULT_OLT.timeout),
    legacy_algorithms: s.legacy_algorithms !== false,
    rx_warning_dbm: toNum(s.rx_warning_dbm, DEFAULT_OLT.rx_warning_dbm),
    rx_critical_dbm: toNum(s.rx_critical_dbm, DEFAULT_OLT.rx_critical_dbm),
    auto_monitor: s.auto_monitor === true
  };
}

function getTenant(tenantId) {
  const id = tenantId || 'default';
  return readTenantsRaw().find((t) => t.id === id) || null;
}

function getMikrotikConfig(tenantId) {
  const t = getTenant(tenantId);
  return normalizeMikrotik(t && t.mikrotik);
}

function getOltConfig(tenantId) {
  const t = getTenant(tenantId);
  return normalizeOlt(t && t.olt);
}

/** Konfigurasi dianggap "live" bila diaktifkan dan memiliki host + user. */
const isMikrotikLive = (cfg) => !!(cfg && cfg.enabled && cfg.host && cfg.user);
const isOltLive = (cfg) => !!(cfg && cfg.enabled && cfg.host && cfg.user);

/** Hilangkan password sebelum dikirim ke browser. */
function maskNetworkConfig(cfg) {
  if (!cfg) return cfg;
  const out = { ...cfg };
  ['pass', 'enable_pass'].forEach((k) => {
    if (k in out) {
      out['has_' + k] = !!out[k];
      delete out[k];
    }
  });
  return out;
}

/**
 * Migrasi idempoten: pastikan setiap tenant punya blok mikrotik & olt.
 * Field lain pada tenants.json tidak disentuh. Mengembalikan jumlah tenant yang diperbarui.
 */
function migrateTenantsFile() {
  const list = readTenantsRaw();
  let changed = 0;
  const next = list.map((t) => {
    const hasBoth = t && t.mikrotik && t.olt;
    if (hasBoth) return t;
    changed++;
    return {
      ...t,
      mikrotik: normalizeMikrotik(t.mikrotik),
      olt: normalizeOlt(t.olt)
    };
  });
  if (changed > 0) writeTenantsRaw(next);
  return changed;
}

/**
 * Perbarui konfigurasi jaringan sebuah tenant.
 * Password kosong/undefined = pertahankan password lama (agar form edit tidak menghapusnya).
 */
function updateTenantNetwork(tenantId, patch = {}) {
  const list = readTenantsRaw();
  const idx = list.findIndex((t) => t.id === tenantId);
  if (idx === -1) return null;

  const current = list[idx];
  const merge = (oldCfg, newCfg, normalizer, secretKeys) => {
    if (!newCfg || typeof newCfg !== 'object') return normalizer(oldCfg);
    const merged = { ...(oldCfg || {}), ...newCfg };
    secretKeys.forEach((k) => {
      if (newCfg[k] === undefined || newCfg[k] === '') merged[k] = (oldCfg || {})[k] || '';
    });
    return normalizer(merged);
  };

  list[idx] = {
    ...current,
    mikrotik: merge(current.mikrotik, patch.mikrotik, normalizeMikrotik, ['pass']),
    olt: merge(current.olt, patch.olt, normalizeOlt, ['pass', 'enable_pass'])
  };
  writeTenantsRaw(list);
  return list[idx];
}

/** Daftar tenant aktif (status 'active'), dipakai cron lintas-tenant. */
function listActiveTenantIds() {
  const list = readTenantsRaw();
  const ids = list.filter((t) => (t.status || 'active') === 'active').map((t) => t.id);
  return ids.length ? ids : ['default'];
}

module.exports = {
  DEFAULT_MIKROTIK,
  DEFAULT_OLT,
  normalizeMikrotik,
  normalizeOlt,
  getTenant,
  getMikrotikConfig,
  getOltConfig,
  isMikrotikLive,
  isOltLive,
  maskNetworkConfig,
  migrateTenantsFile,
  updateTenantNetwork,
  listActiveTenantIds
};
