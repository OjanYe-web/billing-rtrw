'use strict';
/**
 * MODUL 3 (BayarWifi 3.0) - Manajemen Hotspot Voucher & Pelacakan Pelanggan Offline
 *
 * Mencakup:
 * 1. Manajemen Profil Paket Hotspot (durasi uptime, kuota, rate-limit, harga modal & harga jual).
 * 2. Generator Kode Voucher Hotspot (Satuan & Massal/Batch) terintegrasi MikroTik RouterOS.
 * 3. Pelacakan Pelanggan Offline (Offline Customer Tracker) yang menggabungkan:
 *    - Sesi aktif PPPoE MikroTik (/ppp active)
 *    - Status optik OLT (LOS, DyingGasp, Redaman Kritis)
 *    - Tiket gangguan aktif & status isolir tagihan
 */
const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_HOTSPOT_PROFILES = [
  {
    id: 'HSP-01',
    nama: 'Voucher 3 Jam Hemat',
    mikrotik_profile: 'VCR-3JAM',
    rate_limit: '5M/5M',
    uptime_limit: '3h',
    durasi_label: '3 Jam',
    shared_users: 1,
    harga_modal: 1000,
    harga_jual: 2000,
    deskripsi: 'Voucher Wi-Fi eceran warkop / warung durasi 3 jam nonstop'
  },
  {
    id: 'HSP-02',
    nama: 'Voucher Harian 24 Jam',
    mikrotik_profile: 'VCR-HARIAN',
    rate_limit: '7M/7M',
    uptime_limit: '1d',
    durasi_label: '24 Jam (1 Hari)',
    shared_users: 1,
    harga_modal: 3000,
    harga_jual: 5000,
    deskripsi: 'Voucher internet harian bebas kuota selama 24 jam'
  },
  {
    id: 'HSP-03',
    nama: 'Voucher Mingguan 7 Hari',
    mikrotik_profile: 'VCR-MINGGUAN',
    rate_limit: '10M/10M',
    uptime_limit: '7d',
    durasi_label: '7 Hari',
    shared_users: 1,
    harga_modal: 15000,
    harga_jual: 20000,
    deskripsi: 'Voucher mingguan cocok untuk tamu atau pekerja mingguan'
  },
  {
    id: 'HSP-04',
    nama: 'Voucher Bulanan 30 Hari',
    mikrotik_profile: 'VCR-BULANAN',
    rate_limit: '15M/15M',
    uptime_limit: '30d',
    durasi_label: '30 Hari',
    shared_users: 2,
    harga_modal: 40000,
    harga_jual: 50000,
    deskripsi: 'Voucher bulanan anak kos bisa untuk 2 perangkat sekaligus'
  }
];

function createHotspotService(deps) {
  const {
    getTenantFilePath,
    safeWriteJSON,
    readDB,
    mikrotikService,
    oltService,
    formatWaktuIndo,
    logActivity
  } = deps;

  // -------------------------------------------------------------------------
  // Database Helper per Tenant
  // -------------------------------------------------------------------------
  function readProfiles(tenantId) {
    const filePath = getTenantFilePath('hotspot_profiles.json', tenantId);
    if (!fs.existsSync(filePath)) {
      safeWriteJSON(filePath, DEFAULT_HOTSPOT_PROFILES);
      return [...DEFAULT_HOTSPOT_PROFILES];
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : [...DEFAULT_HOTSPOT_PROFILES];
    } catch (_) {
      return [...DEFAULT_HOTSPOT_PROFILES];
    }
  }

  function writeProfiles(data, tenantId) {
    const filePath = getTenantFilePath('hotspot_profiles.json', tenantId);
    safeWriteJSON(filePath, data);
  }

  function seedDefaultVouchers(profiles) {
    const nowStr = formatWaktuIndo ? formatWaktuIndo(new Date()) : new Date().toISOString();
    const pHarian = profiles.find((p) => p.id === 'HSP-02') || profiles[0];
    const pMingguan = profiles.find((p) => p.id === 'HSP-03') || profiles[0];
    return [
      {
        id: 'VCR-1001',
        kode_voucher: 'BW24K9M8',
        password: 'BW24K9M8',
        mode_login: 'user_eq_pass',
        profile_id: pHarian.id,
        nama_paket: pHarian.nama,
        mikrotik_profile: pHarian.mikrotik_profile,
        rate_limit: pHarian.rate_limit,
        uptime_limit: pHarian.uptime_limit,
        durasi_label: pHarian.durasi_label,
        harga_modal: pHarian.harga_modal,
        harga_jual: pHarian.harga_jual,
        batch_code: 'BATCH-INIT',
        status: 'unused', // 'unused' | 'active' | 'expired' | 'disabled'
        reseller: 'Loket Utama',
        kasir: 'Admin',
        pembeli: '',
        created_at: nowStr,
        activated_at: null,
        mikrotik_synced: true
      },
      {
        id: 'VCR-1002',
        kode_voucher: 'BW24X7P2',
        password: 'BW24X7P2',
        mode_login: 'user_eq_pass',
        profile_id: pHarian.id,
        nama_paket: pHarian.nama,
        mikrotik_profile: pHarian.mikrotik_profile,
        rate_limit: pHarian.rate_limit,
        uptime_limit: pHarian.uptime_limit,
        durasi_label: pHarian.durasi_label,
        harga_modal: pHarian.harga_modal,
        harga_jual: pHarian.harga_jual,
        batch_code: 'BATCH-INIT',
        status: 'active',
        reseller: 'Loket Utama',
        kasir: 'Siti Rahma (Kasir Utama)',
        pembeli: 'Warkop Pojok RT 02',
        created_at: nowStr,
        activated_at: nowStr,
        mikrotik_synced: true
      },
      {
        id: 'VCR-1003',
        kode_voucher: 'BW7D4N5Q',
        password: 'BW7D4N5Q',
        mode_login: 'user_eq_pass',
        profile_id: pMingguan.id,
        nama_paket: pMingguan.nama,
        mikrotik_profile: pMingguan.mikrotik_profile,
        rate_limit: pMingguan.rate_limit,
        uptime_limit: pMingguan.uptime_limit,
        durasi_label: pMingguan.durasi_label,
        harga_modal: pMingguan.harga_modal,
        harga_jual: pMingguan.harga_jual,
        batch_code: 'BATCH-INIT',
        status: 'unused',
        reseller: 'Mitra Warung Berkah',
        kasir: 'Admin',
        pembeli: '',
        created_at: nowStr,
        activated_at: null,
        mikrotik_synced: true
      }
    ];
  }

  function readVouchers(tenantId) {
    const filePath = getTenantFilePath('hotspot_vouchers.json', tenantId);
    if (!fs.existsSync(filePath)) {
      const profiles = readProfiles(tenantId);
      const seeded = seedDefaultVouchers(profiles);
      safeWriteJSON(filePath, seeded);
      return seeded;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeVouchers(data, tenantId) {
    const filePath = getTenantFilePath('hotspot_vouchers.json', tenantId);
    safeWriteJSON(filePath, data);
  }

  // -------------------------------------------------------------------------
  // Generator Kode Unik Voucher
  // -------------------------------------------------------------------------
  function generateCode(length = 6, charsetType = 'alphanumeric_upper', prefix = '') {
    let chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    if (charsetType === 'numeric') {
      chars = '0123456789';
    } else if (charsetType === 'alphanumeric_mixed') {
      chars = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
    }
    const cleanPrefix = String(prefix || '').trim();
    const targetRandomLen = Math.max(3, Number(length || 6) - cleanPrefix.length);
    let out = cleanPrefix;
    for (let i = 0; i < targetRandomLen; i++) {
      out += chars[crypto.randomInt(0, chars.length)];
    }
    return out;
  }

  /**
   * Generate Voucher Hotspot (Satuan atau Massal / Batch)
   */
  async function generateVouchers(tenantId, payload = {}, actorName = 'Admin') {
    const profiles = readProfiles(tenantId);
    const vouchers = readVouchers(tenantId);

    const profileId = payload.profile_id || (profiles[0] && profiles[0].id);
    const profile = profiles.find((p) => p.id === profileId) || profiles[0];
    if (!profile) {
      return { error: 'Profil paket Hotspot tidak ditemukan.' };
    }

    const qty = Math.min(500, Math.max(1, Number(payload.qty || payload.jumlah || 1)));
    const codeLength = Math.min(16, Math.max(4, Number(payload.length || payload.panjang_kode || 8)));
    const prefix = String(payload.prefix || 'BW').trim().toUpperCase();
    const charsetType = payload.charset || 'alphanumeric_upper';
    const modeLogin = payload.mode_login === 'user_diff_pass' ? 'user_diff_pass' : 'user_eq_pass';
    const reseller = String(payload.reseller || 'Loket Utama').trim();
    const pembeli = String(payload.pembeli || '').trim();
    const initialStatus = payload.status === 'active' ? 'active' : 'unused';

    const batchCode = payload.batch_code || ('BATCH-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4));
    const nowStr = formatWaktuIndo ? formatWaktuIndo(new Date()) : new Date().toISOString();

    const existingCodes = new Set(vouchers.map((v) => v.kode_voucher.toUpperCase()));
    const createdList = [];

    for (let i = 0; i < qty; i++) {
      let kode = generateCode(codeLength, charsetType, prefix);
      let attempts = 0;
      while (existingCodes.has(kode.toUpperCase()) && attempts < 25) {
        kode = generateCode(codeLength + 1, charsetType, prefix);
        attempts++;
      }
      existingCodes.add(kode.toUpperCase());

      const pwd = modeLogin === 'user_diff_pass'
        ? generateCode(Math.max(4, codeLength - 2), 'numeric', '')
        : kode;

      const vItem = {
        id: 'VCR-' + Date.now() + '-' + (i + 1),
        kode_voucher: kode,
        password: pwd,
        mode_login: modeLogin,
        profile_id: profile.id,
        nama_paket: profile.nama,
        mikrotik_profile: profile.mikrotik_profile,
        rate_limit: profile.rate_limit,
        uptime_limit: profile.uptime_limit,
        durasi_label: profile.durasi_label,
        harga_modal: Number(profile.harga_modal || 0),
        harga_jual: Number(profile.harga_jual || 0),
        batch_code: batchCode,
        status: initialStatus,
        reseller,
        kasir: actorName,
        pembeli,
        created_at: nowStr,
        activated_at: initialStatus === 'active' ? nowStr : null,
        mikrotik_synced: false
      };

      createdList.push(vItem);
    }

    // Sinkronisasi otomatis ke MikroTik RouterOS jika live
    let mkSyncResult = { simulated: true, synced_count: createdList.length };
    if (mikrotikService && typeof mikrotikService.createHotspotVouchers === 'function') {
      mkSyncResult = await mikrotikService.createHotspotVouchers(tenantId, createdList);
      if (mkSyncResult.success) {
        for (const v of createdList) v.mikrotik_synced = true;
      }
    }

    const updatedVouchers = [...createdList, ...vouchers];
    writeVouchers(updatedVouchers, tenantId);

    if (logActivity) {
      logActivity(
        'GENERATE_VOUCHER_HOTSPOT',
        `Membuat ${createdList.length} voucher Hotspot paket "${profile.nama}" (Batch: ${batchCode}, Reseller: ${reseller})`,
        { kategori: 'Hotspot', target_id: batchCode }
      );
    }

    return {
      success: true,
      batch_code: batchCode,
      count: createdList.length,
      profile,
      vouchers: createdList,
      mikrotik_sync: mkSyncResult
    };
  }

  /**
   * Ringkasan Statistik Voucher Hotspot
   */
  function getVoucherStats(vouchers = []) {
    const unused = vouchers.filter((v) => v.status === 'unused');
    const active = vouchers.filter((v) => v.status === 'active');
    const expired = vouchers.filter((v) => v.status === 'expired');
    const disabled = vouchers.filter((v) => v.status === 'disabled');

    const potensiOmzet = vouchers.reduce((acc, v) => acc + Number(v.harga_jual || 0), 0);
    const omzetTerjual = active.concat(expired).reduce((acc, v) => acc + Number(v.harga_jual || 0), 0);
    const labaTerjual = active.concat(expired).reduce((acc, v) => acc + (Number(v.harga_jual || 0) - Number(v.harga_modal || 0)), 0);

    const batches = [...new Set(vouchers.map((v) => v.batch_code).filter(Boolean))];

    return {
      total_vouchers: vouchers.length,
      count_unused: unused.length,
      count_active: active.length,
      count_expired: expired.length,
      count_disabled: disabled.length,
      potensi_omzet: potensiOmzet,
      omzet_terjual: omzetTerjual,
      estimasi_laba: labaTerjual,
      batches
    };
  }

  // -------------------------------------------------------------------------
  // PELACAKAN PELANGGAN OFFLINE (OFFLINE CUSTOMER TRACKER - BayarWifi 3.0)
  // -------------------------------------------------------------------------
  async function trackOfflineCustomers(tenantId, options = {}) {
    const customers = readDB(tenantId) || [];
    const checkLiveOlt = options.check_olt === true;

    // 1. Cek daftar sesi PPPoE aktif dari MikroTik jika live
    let activePppoeNames = null;
    let routerLive = false;
    if (mikrotikService && mikrotikService.isLive(tenantId)) {
      const sessRes = await mikrotikService.getActiveSessions(tenantId);
      if (sessRes && sessRes.success && !sessRes.simulated) {
        routerLive = true;
        activePppoeNames = new Set(
          (sessRes.pppoe_active || []).map((s) => String(s.name || '').toLowerCase().trim())
        );
      }
    }

    const offlineList = [];
    const onlineList = [];

    for (const c of customers) {
      const username = String(c.mikrotikUsername || '').toLowerCase().trim();
      const isIsolated = c.status_jaringan === 'Terisolir' || c.status_jaringan === 'Terisolir / Gangguan';
      const hasTroubleStatus = c.status_jaringan === 'Gangguan' || c.status_jaringan === 'Terisolir / Gangguan';
      const openTickets = (c.network_logs || []).filter((l) => l.status_penanganan !== 'Selesai');

      // Cek apakah sesi PPPoE terputus di router live
      const isDisconnectedOnRouter = routerLive && username ? !activePppoeNames.has(username) : false;

      // Cek indikasi gangguan optik OLT pada catatan / tiket atau query OLT
      const oltPort = (c.device && c.device.olt_port) || c.olt_port || c.oltPort || '';
      const onuId = (c.device && c.device.onu_id) || c.onu_id || c.oltOnuId || '';

      let oltDiag = null;
      if (checkLiveOlt && oltPort && onuId && oltService) {
        try {
          oltDiag = await oltService.getOnuStatus(tenantId, { olt_port: oltPort, onu_id: onuId });
        } catch (_) {}
      }

      const kendalaText = `${c.catatan_kendala || ''} ${(openTickets[0] && openTickets[0].jenis_kendala) || ''}`.toLowerCase();
      const isLosOptical =
        (oltDiag && (oltDiag.state === 'LOS' || oltDiag.los === true)) ||
        kendalaText.includes('los') ||
        kendalaText.includes('putus') ||
        kendalaText.includes('redaman');

      const isDyingGasp =
        (oltDiag && oltDiag.state === 'DyingGasp') ||
        kendalaText.includes('mati listrik') ||
        kendalaText.includes('dying gasp') ||
        kendalaText.includes('adaptor');

      const isOffline =
        isIsolated ||
        hasTroubleStatus ||
        openTickets.length > 0 ||
        isDisconnectedOnRouter ||
        (oltDiag && oltDiag.online === false);

      if (isOffline) {
        let offlineReason = 'PPPOE_DISCONNECTED';
        let reasonLabel = 'Sesi PPPoE Terputus / Offline';
        let severity = 'warning';
        let recommendation = 'Periksa power modem ONT pelanggan atau lakukan ping/kick ulang sesi PPPoE di MikroTik.';

        if (isLosOptical) {
          offlineReason = 'LOS_OPTIK';
          reasonLabel = 'LOS Merah / Kabel FO Putus / Redaman Tinggi';
          severity = 'critical';
          recommendation = `Cek jalur dropcore FO dan konektor SC/UPC pada ODP (${oltPort ? `Port OLT ${oltPort}:${onuId}` : 'Port OLT belum dipetakan'}).`;
        } else if (isDyingGasp) {
          offlineReason = 'DYING_GASP_MATI_LISTRIK';
          reasonLabel = 'Dying Gasp (Modem Mati Listrik / Adaptor Off)';
          severity = 'warning';
          recommendation = 'Modem ONT kehilangan daya listrik di rumah pelanggan. Konfirmasi ke pelanggan apakah listrik padam.';
        } else if (isIsolated) {
          offlineReason = 'ISOLIR_TAGIHAN';
          reasonLabel = 'Terisolir (Tagihan Belum Lunas / Menunggak)';
          severity = 'isolated';
          recommendation = 'Arahkan kasir untuk konfirmasi pembayaran tagihan agar sambungan dipulihkan otomatis.';
        } else if (openTickets.length > 0 || hasTroubleStatus) {
          offlineReason = 'GANGGUAN_TERCATAT';
          reasonLabel = (openTickets[0] && openTickets[0].jenis_kendala) || c.catatan_kendala || 'Tiket Gangguan Aktif';
          severity = 'critical';
          recommendation = `Tindak lanjuti tiket ${openTickets[0] ? openTickets[0].tiket_id : 'gangguan'} oleh teknisi (${(openTickets[0] && openTickets[0].teknisi) || 'Tim Lapangan'}).`;
        }

        offlineList.push({
          id: c.id,
          customer_id: c.customer_id,
          nama: c.nama,
          whatsapp: c.whatsapp,
          wilayah: c.wilayah,
          alamat: c.alamat,
          paket: c.paket,
          status_tagihan: c.status_tagihan,
          status_jaringan: c.status_jaringan,
          mikrotikUsername: c.mikrotikUsername,
          mikrotikProfile: c.mikrotikProfile,
          ipAddress: c.ipAddress,
          olt_port: oltPort,
          onu_id: onuId,
          device_tipe: (c.device && c.device.tipe) || '-',
          device_sn: (c.device && c.device.serial_number) || '-',
          offline_reason: offlineReason,
          reason_label: reasonLabel,
          severity,
          recommendation,
          open_ticket: openTickets[0] || null,
          olt_diagnostic: oltDiag,
          last_sync: c.mikrotikLastSync || null
        });
      } else {
        onlineList.push({
          id: c.id,
          customer_id: c.customer_id,
          nama: c.nama,
          wilayah: c.wilayah,
          mikrotikUsername: c.mikrotikUsername,
          ipAddress: c.ipAddress,
          status: 'ONLINE'
        });
      }
    }

    // Urutkan: critical (LOS/Gangguan) paling atas, lalu warning, lalu isolated
    const severityOrder = { critical: 1, warning: 2, isolated: 3 };
    offlineList.sort((a, b) => (severityOrder[a.severity] || 9) - (severityOrder[b.severity] || 9));

    return {
      success: true,
      router_live: routerLive,
      summary: {
        total_customers: customers.length,
        online_count: onlineList.length,
        offline_total: offlineList.length,
        critical_los_count: offlineList.filter((x) => x.offline_reason === 'LOS_OPTIK' || x.severity === 'critical').length,
        dying_gasp_count: offlineList.filter((x) => x.offline_reason === 'DYING_GASP_MATI_LISTRIK').length,
        isolated_count: offlineList.filter((x) => x.offline_reason === 'ISOLIR_TAGIHAN').length,
        disconnected_pppoe_count: offlineList.filter((x) => x.offline_reason === 'PPPOE_DISCONNECTED').length
      },
      offline_customers: offlineList
    };
  }

  return {
    readProfiles,
    writeProfiles,
    readVouchers,
    writeVouchers,
    generateVouchers,
    getVoucherStats,
    trackOfflineCustomers
  };
}

module.exports = {
  DEFAULT_HOTSPOT_PROFILES,
  createHotspotService
};

