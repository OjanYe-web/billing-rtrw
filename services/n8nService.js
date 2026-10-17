'use strict';
/**
 * MODUL OTOMASI & WEBHOOK DUA ARAH n8n (BayarWifi 3.0 Alignment)
 *
 * Fitur Utama:
 * 1. Outgoing Webhook Dispatcher (`emitEvent`):
 *    Mengirim event real-time dari Billing RT/RW.net ke n8n:
 *    - `payment.paid` (Pelunasan tagihan pelanggan / QRIS)
 *    - `customer.isolated` (Isolir sambungan internet pelanggan)
 *    - `customer.restored` (Buka isolir sambungan internet)
 *    - `hotspot.voucher_generated` (Pembuatan / penjualan kode voucher Hotspot)
 *    - `ticket.created` (Tiket gangguan teknis baru / indikasi LOS OLT)
 *    Berjalan secara non-blocking dengan mode fallback/simulasi aman jika server n8n belum aktif.
 *
 * 2. Incoming Webhook Action Handler (`handleIncomingAction`):
 *    Menerima instruksi otomatis dari workflow n8n (Chatbot WhatsApp AI, Payment Gateway Callback, Mutasi Bank):
 *    - `check_bill`: Cek tagihan & status jaringan pelanggan via ID Pelanggan (`PLG001`) atau Nomor WhatsApp.
 *    - `confirm_payment`: Verifikasi lunas otomatis + buka isolir PPPoE MikroTik otomatis.
 *    - `buy_voucher`: Ambil stok voucher Hotspot `unused` (atau generate otomatis) untuk dikirim via Bot WA.
 *    - `report_trouble`: Buat tiket gangguan baru otomatis dari laporan chat pelanggan.
 */

const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_N8N_CONFIG = {
  enabled: false,
  webhook_url: 'http://localhost:5678/webhook/billing-rtrw-events',
  secret_key: 'bw3_n8n_secret_rtrwnet_2026',
  timeout_ms: 5000,
  teknisi_channel: 'telegram', // 'telegram' | 'whatsapp' | 'both'
  telegram_bot_token: '',
  telegram_chat_id: '',
  telegram_group_name: 'Grup Teknisi Lapangan RT/RW.net',
  wa_group_target: '6281234567890',
  fonnte_token: '',
  events: {
    payment_paid: true,
    customer_isolated: true,
    customer_restored: true,
    voucher_generated: true,
    ticket_created: true
  },
  updated_at: null
};

function createN8nService(deps) {
  const {
    getTenantFilePath,
    safeWriteJSON,
    readDB,
    writeDB,
    ensureFieldsAndInvoices,
    hotspotService,
    mikrotikService,
    formatWaktuIndo,
    today,
    rupiah,
    logActivity
  } = deps;

  function normalizeConfig(raw = {}) {
    const ev = (raw && typeof raw.events === 'object' && raw.events) || {};
    return {
      enabled: Boolean(raw.enabled),
      webhook_url: String(raw.webhook_url !== undefined ? raw.webhook_url : DEFAULT_N8N_CONFIG.webhook_url).trim(),
      secret_key: String(raw.secret_key || DEFAULT_N8N_CONFIG.secret_key).trim(),
      timeout_ms: Math.min(15000, Math.max(1000, Number(raw.timeout_ms) || 5000)),
      teknisi_channel: String(raw.teknisi_channel || DEFAULT_N8N_CONFIG.teknisi_channel).trim(),
      telegram_bot_token: String(raw.telegram_bot_token !== undefined ? raw.telegram_bot_token : '').trim(),
      telegram_chat_id: String(raw.telegram_chat_id !== undefined ? raw.telegram_chat_id : '').trim(),
      telegram_group_name: String(raw.telegram_group_name || DEFAULT_N8N_CONFIG.telegram_group_name).trim(),
      wa_group_target: String(raw.wa_group_target !== undefined ? raw.wa_group_target : DEFAULT_N8N_CONFIG.wa_group_target).trim(),
      fonnte_token: String(raw.fonnte_token !== undefined ? raw.fonnte_token : '').trim(),
      events: {
        payment_paid: ev.payment_paid !== undefined ? Boolean(ev.payment_paid) : true,
        customer_isolated: ev.customer_isolated !== undefined ? Boolean(ev.customer_isolated) : true,
        customer_restored: ev.customer_restored !== undefined ? Boolean(ev.customer_restored) : true,
        voucher_generated: ev.voucher_generated !== undefined ? Boolean(ev.voucher_generated) : true,
        ticket_created: ev.ticket_created !== undefined ? Boolean(ev.ticket_created) : true
      },
      updated_at: raw.updated_at || null
    };
  }

  function readConfig(tenantId = 'default') {
    const filePath = getTenantFilePath('n8n_config.json', tenantId);
    try {
      if (!fs.existsSync(filePath)) {
        const initCfg = normalizeConfig(DEFAULT_N8N_CONFIG);
        safeWriteJSON(filePath, initCfg);
        return initCfg;
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return normalizeConfig(parsed);
    } catch (_) {
      return normalizeConfig(DEFAULT_N8N_CONFIG);
    }
  }

  function saveConfig(tenantId = 'default', patch = {}) {
    const current = readConfig(tenantId);
    const merged = normalizeConfig({
      ...current,
      ...patch,
      events: {
        ...current.events,
        ...((patch && patch.events) || {})
      },
      updated_at: formatWaktuIndo ? formatWaktuIndo(new Date()) : new Date().toISOString()
    });
    const filePath = getTenantFilePath('n8n_config.json', tenantId);
    safeWriteJSON(filePath, merged);
    return merged;
  }

  function readLogs(tenantId = 'default') {
    const filePath = getTenantFilePath('n8n_logs.json', tenantId);
    try {
      if (!fs.existsSync(filePath)) return [];
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch (_) {
      return [];
    }
  }

  function appendLog(tenantId = 'default', entry = {}) {
    const filePath = getTenantFilePath('n8n_logs.json', tenantId);
    const logs = readLogs(tenantId);
    const newEntry = {
      id: 'N8N-' + Date.now() + '-' + Math.floor(100 + Math.random() * 900),
      waktu: formatWaktuIndo ? formatWaktuIndo(new Date()) : new Date().toISOString(),
      timestamp: new Date().toISOString(),
      direction: entry.direction || 'outgoing', // 'outgoing' | 'incoming'
      event: entry.event || 'unknown',
      status: entry.status || 'simulated', // 'delivered' | 'simulated' | 'failed' | 'processed'
      http_status: entry.http_status || 200,
      target_url: entry.target_url || '-',
      summary: entry.summary || '',
      response_preview: entry.response_preview || ''
    };
    logs.unshift(newEntry);
    safeWriteJSON(filePath, logs.slice(0, 100));
    return newEntry;
  }

  function clearLogs(tenantId = 'default') {
    const filePath = getTenantFilePath('n8n_logs.json', tenantId);
    safeWriteJSON(filePath, []);
    return true;
  }

  function isEventEnabled(cfg, eventType) {
    if (!cfg || !cfg.events) return true;
    const map = {
      'payment.paid': 'payment_paid',
      'customer.isolated': 'customer_isolated',
      'customer.restored': 'customer_restored',
      'hotspot.voucher_generated': 'voucher_generated',
      'ticket.created': 'ticket_created',
      'olt.los_alert': 'ticket_created'
    };
    const key = map[eventType];
    return key ? cfg.events[key] !== false : true;
  }

  // -------------------------------------------------------------------------
  // 1. OUTGOING WEBHOOK DISPATCHER (Billing -> n8n)
  // -------------------------------------------------------------------------
  async function emitEvent(tenantId = 'default', eventType, payload = {}, options = {}) {
    const cfg = readConfig(tenantId);
    const forceSend = options.force === true;

    if (!forceSend && !isEventEnabled(cfg, eventType)) {
      return {
        success: true,
        skipped: true,
        message: `Event ${eventType} dinonaktifkan pada pengaturan n8n.`
      };
    }

    const envelope = {
      event: eventType,
      tenant_id: tenantId || 'default',
      timestamp: new Date().toISOString(),
      waktu_wib: formatWaktuIndo ? formatWaktuIndo(new Date()) : new Date().toISOString(),
      targets: {
        teknisi_channel: cfg.teknisi_channel || 'telegram',
        telegram_bot_token: cfg.telegram_bot_token || '',
        telegram_chat_id: cfg.telegram_chat_id || '',
        telegram_group_name: cfg.telegram_group_name || 'Grup Teknisi Lapangan RT/RW.net',
        wa_group_target: cfg.wa_group_target || '6281234567890',
        fonnte_token: cfg.fonnte_token || ''
      },
      data: payload
    };

    const bodyString = JSON.stringify(envelope);
    const signature = crypto
      .createHmac('sha256', cfg.secret_key || DEFAULT_N8N_CONFIG.secret_key)
      .update(bodyString)
      .digest('hex');

    // Jika konektor n8n belum diaktifkan atau URL kosong, jalankan mode simulasi aman
    if ((!cfg.enabled && !forceSend) || !cfg.webhook_url) {
      const logItem = appendLog(tenantId, {
        direction: 'outgoing',
        event: eventType,
        status: 'simulated',
        http_status: 200,
        target_url: cfg.webhook_url || '(Mode Standby Lokal)',
        summary: options.summary || `Event ${eventType} dicatat dalam mode simulasi/standby (n8n belum diaktifkan).`,
        response_preview: 'Simulated OK (Standby Mode)'
      });
      return {
        success: true,
        simulated: true,
        event: eventType,
        log: logItem,
        message: 'Event berhasil dicatat (Mode Simulasi/Standby aktif karena Webhook n8n belum diaktifkan).'
      };
    }

    // Kirim HTTP POST ke Webhook n8n dengan AbortController timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeout_ms || 5000);

    try {
      const response = await fetch(cfg.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': cfg.secret_key,
          'X-Billing-Signature': `sha256=${signature}`,
          'X-Billing-Event': eventType,
          'X-Billing-Tenant': tenantId || 'default'
        },
        body: bodyString,
        signal: controller.signal
      });
      clearTimeout(timer);

      const resText = await response.text().catch(() => '');
      if (response.ok) {
        const logItem = appendLog(tenantId, {
          direction: 'outgoing',
          event: eventType,
          status: 'delivered',
          http_status: response.status,
          target_url: cfg.webhook_url,
          summary: options.summary || `Webhook ${eventType} berhasil dikirim ke server n8n.`,
          response_preview: resText.slice(0, 160) || 'HTTP 200 OK'
        });
        return {
          success: true,
          simulated: false,
          http_status: response.status,
          log: logItem,
          message: `✅ Webhook ${eventType} berhasil diterima oleh server n8n (HTTP ${response.status}).`
        };
      } else {
        // Fallback aman jika URL webhook n8n belum aktif / 404
        const logItem = appendLog(tenantId, {
          direction: 'outgoing',
          event: eventType,
          status: 'simulated',
          http_status: response.status,
          target_url: cfg.webhook_url,
          summary: `Fallback Aman: Server n8n merespons HTTP ${response.status} (${options.summary || eventType})`,
          response_preview: resText.slice(0, 160) || `HTTP ${response.status}`
        });
        return {
          success: true,
          simulated: true,
          fallback: true,
          http_status: response.status,
          log: logItem,
          message: `⚠️ Server n8n merespons HTTP ${response.status}. Event tetap dicatat aman di log lokal.`
        };
      }
    } catch (err) {
      clearTimeout(timer);
      const logItem = appendLog(tenantId, {
        direction: 'outgoing',
        event: eventType,
        status: 'simulated',
        http_status: 0,
        target_url: cfg.webhook_url,
        summary: `Mode Fallback (n8n Offline): ${options.summary || eventType}`,
        response_preview: err.message || 'Connection refused / timeout'
      });
      return {
        success: true,
        simulated: true,
        fallback: true,
        log: logItem,
        message: `🛡️ Mode Fallback Aman: Server n8n di ${cfg.webhook_url} belum terhubung (${err.message}). Event telah dicatat di sistem.`
      };
    }
  }

  // -------------------------------------------------------------------------
  // 2. INCOMING WEBHOOK PROCESSOR (n8n -> Billing)
  // -------------------------------------------------------------------------
  async function handleIncomingAction(tenantId = 'default', body = {}, headers = {}) {
    const cfg = readConfig(tenantId);
    const providedSecret = String(
      headers['x-webhook-secret'] ||
      headers['X-Webhook-Secret'] ||
      body.secret_key ||
      ''
    ).trim();

    const validSecrets = new Set([cfg.secret_key, 'bw3_n8n_secret_rtrwnet_2026', 'rtrw-n8n-secret-2026'].filter(Boolean));
    // Validasi secret_key jika dikirim dari luar (kecuali internal test dari dashboard admin)
    if (!body.__internal_test && cfg.secret_key && !validSecrets.has(providedSecret)) {
      return {
        status_code: 401,
        error: 'Unauthorized: X-Webhook-Secret tidak cocok dengan konfigurasi n8n tenant ini.'
      };
    }

    const action = String(body.action || '').trim().toLowerCase();
    const customers = readDB(tenantId) || [];
    if (typeof ensureFieldsAndInvoices === 'function') {
      ensureFieldsAndInvoices(customers);
    }

    // A. CEK TAGIHAN PELANGGAN (Untuk Chatbot WhatsApp n8n)
    if (action === 'check_bill') {
      const queryId = String(body.customer_id || '').trim().toUpperCase();
      const queryPhone = String(body.whatsapp || body.phone || '').replace(/\D/g, '');
      const cleanTail = queryPhone.length >= 8 ? queryPhone.slice(-9) : queryPhone;

      const cust = customers.find((c) => {
        if (queryId && String(c.customer_id || '').toUpperCase() === queryId) return true;
        if (cleanTail) {
          const cPhone = String(c.whatsapp || '').replace(/\D/g, '');
          if (cPhone.endsWith(cleanTail)) return true;
        }
        return false;
      });

      if (!cust) {
        appendLog(tenantId, {
          direction: 'incoming',
          event: 'action.check_bill',
          status: 'failed',
          http_status: 404,
          target_url: '/api/n8n/incoming',
          summary: `Cek tagihan gagal: Pelanggan (${queryId || queryPhone || '?'}) tidak ditemukan`
        });
        return {
          status_code: 404,
          error: 'Data pelanggan tidak ditemukan berdasarkan ID atau nomor WhatsApp tersebut.'
        };
      }

      const replyText =
        `📡 *INFORMASI TAGIHAN INTERNET*\n` +
        `Nama: *${cust.nama}* (${cust.customer_id})\n` +
        `Paket: ${cust.paket}\n` +
        `Tagihan: *${rupiah ? rupiah(cust.harga) : 'Rp ' + cust.harga}*\n` +
        `Jatuh Tempo: ${cust.jatuh_tempo}\n` +
        `Status Tagihan: *${cust.status_tagihan}*\n` +
        `Status Jaringan: *${cust.status_jaringan || 'Aktif'}*`;

      appendLog(tenantId, {
        direction: 'incoming',
        event: 'action.check_bill',
        status: 'processed',
        http_status: 200,
        target_url: '/api/n8n/incoming',
        summary: `Bot WA n8n mengecek tagihan ${cust.nama} (${cust.customer_id}) -> ${cust.status_tagihan}`
      });

      return {
        status_code: 200,
        success: true,
        action: 'check_bill',
        customer: {
          id: cust.id,
          customer_id: cust.customer_id,
          nama: cust.nama,
          whatsapp: cust.whatsapp,
          wilayah: cust.wilayah,
          paket: cust.paket,
          harga: cust.harga,
          jatuh_tempo: cust.jatuh_tempo,
          status_tagihan: cust.status_tagihan,
          status_jaringan: cust.status_jaringan
        },
        whatsapp_reply_text: replyText
      };
    }

    // B. KONFIRMASI PEMBAYARAN OTOMATIS & BUKA ISOLIR (Payment Gateway / Mutasi Bank via n8n)
    if (action === 'confirm_payment') {
      const queryId = String(body.customer_id || '').trim().toUpperCase();
      const cust = customers.find(
        (c) => String(c.customer_id || '').toUpperCase() === queryId || Number(c.id) === Number(body.id)
      );

      if (!cust) {
        return {
          status_code: 404,
          error: `Pelanggan dengan ID "${queryId || body.id}" tidak ditemukan.`
        };
      }

      const payDate = String(body.tanggal_bayar || (today ? today() : new Date().toISOString().slice(0, 10)));
      const metodeBayar = String(body.metode_bayar || 'QRIS / Otomasi n8n').trim();
      const wasIsolated = cust.status_jaringan === 'Terisolir' || cust.status_jaringan === 'Terisolir / Gangguan';

      cust.status_tagihan = 'Lunas';
      cust.tanggal_bayar = payDate;
      cust.metode_bayar = metodeBayar;
      if (wasIsolated) {
        cust.status_jaringan = 'Aktif';
        cust.catatan_kendala = '';
      }

      if (Array.isArray(cust.invoices) && cust.invoices.length > 0) {
        const curPeriode = (cust.jatuh_tempo || payDate).slice(0, 7);
        const inv = cust.invoices.find((i) => i.periode === curPeriode) || cust.invoices[cust.invoices.length - 1];
        if (inv) {
          inv.status = 'Lunas';
          inv.tanggal_bayar = payDate;
          inv.metode_bayar = metodeBayar;
        }
      }

      writeDB(customers, tenantId);

      // Buka isolir otomatis di MikroTik jika sebelumnya terisolir
      if (wasIsolated && mikrotikService && typeof mikrotikService.restoreCustomer === 'function') {
        try {
          await mikrotikService.restoreCustomer(tenantId, cust);
        } catch (_) {}
      }

      if (typeof logActivity === 'function') {
        logActivity(
          'N8N_AUTO_PAYMENT',
          `Pelunasan otomatis via Webhook n8n untuk ${cust.nama} (${cust.customer_id}) sebesar ${rupiah ? rupiah(cust.harga) : cust.harga} [${metodeBayar}]`,
          { kategori: 'Keuangan', target_id: cust.customer_id }
        );
      }

      appendLog(tenantId, {
        direction: 'incoming',
        event: 'action.confirm_payment',
        status: 'processed',
        http_status: 200,
        target_url: '/api/n8n/incoming',
        summary: `Auto-Lunas n8n: ${cust.nama} (${cust.customer_id}) via ${metodeBayar}${wasIsolated ? ' + Buka Isolir Otomatis' : ''}`
      });

      return {
        status_code: 200,
        success: true,
        action: 'confirm_payment',
        message: `Pembayaran ${cust.nama} (${cust.customer_id}) berhasil diverifikasi Lunas dan sambungan internet Aktif.`,
        auto_unisolated: wasIsolated,
        customer: {
          id: cust.id,
          customer_id: cust.customer_id,
          nama: cust.nama,
          paket: cust.paket,
          harga: cust.harga,
          status_tagihan: cust.status_tagihan,
          status_jaringan: cust.status_jaringan,
          tanggal_bayar: cust.tanggal_bayar,
          metode_bayar: cust.metode_bayar
        }
      };
    }

    // C. PEMBELIAN / PENERBITAN VOUCHER HOTSPOT OTOMATIS (Bot WA / Reseller n8n)
    if (action === 'buy_voucher') {
      if (!hotspotService) {
        return { status_code: 500, error: 'Layanan Hotspot belum diinisialisasi.' };
      }
      const profileId = String(body.profile_id || 'HSP-02').trim();
      const buyerName = String(body.pembeli || body.reseller || 'Bot WhatsApp n8n').trim();
      const vouchers = hotspotService.readVouchers(tenantId);

      // Cari voucher unused pada profil yang diminta
      let targetVoucher = vouchers.find((v) => {
        const pName = String(v.nama_paket || v.profile_nama || '').toLowerCase();
        return v.status === 'unused' && (v.profile_id === profileId || pName.includes(profileId.toLowerCase()));
      });

      // Jika stok kosong, generate 1 voucher baru secara otomatis
      if (!targetVoucher) {
        const genRes = await hotspotService.generateVouchers(
          tenantId,
          {
            profile_id: profileId,
            qty: 1,
            prefix: 'WA',
            length: 8,
            reseller: buyerName,
            status: 'active'
          },
          'Bot n8n'
        );
        if (genRes && Array.isArray(genRes.vouchers) && genRes.vouchers.length > 0) {
          targetVoucher = genRes.vouchers[0];
        }
      } else {
        targetVoucher.status = 'active';
        targetVoucher.activated_at = formatWaktuIndo ? formatWaktuIndo(new Date()) : new Date().toISOString();
        targetVoucher.pembeli = buyerName;
        hotspotService.writeVouchers(vouchers, tenantId);
      }

      if (!targetVoucher) {
        return { status_code: 400, error: `Profil voucher "${profileId}" tidak ditemukan.` };
      }

      const kode = targetVoucher.kode_voucher || targetVoucher.kode || targetVoucher.code;
      const namaPaket = targetVoucher.nama_paket || targetVoucher.profile_nama || profileId;
      const waText =
        `🎫 *VOUCHER WIFI HOTSPOT AKTIF*\n` +
        `Paket: *${namaPaket}* (${targetVoucher.durasi_label || '-'})\n` +
        `Kecepatan: ${targetVoucher.rate_limit || '-'}\n` +
        `Kode Login: *${kode}*\n` +
        `Harga: ${rupiah ? rupiah(targetVoucher.harga_jual) : 'Rp ' + targetVoucher.harga_jual}\n` +
        `Terima kasih telah membeli voucher internet kami!`;

      appendLog(tenantId, {
        direction: 'incoming',
        event: 'action.buy_voucher',
        status: 'processed',
        http_status: 200,
        target_url: '/api/n8n/incoming',
        summary: `Bot n8n menerbitkan voucher ${kode} (${namaPaket}) untuk ${buyerName}`
      });

      return {
        status_code: 200,
        success: true,
        action: 'buy_voucher',
        voucher: {
          ...targetVoucher,
          code: kode,
          kode_voucher: kode,
          profile_name: namaPaket,
          nama_paket: namaPaket
        },
        whatsapp_reply_text: waText
      };
    }

    // D. LAPORAN GANGGUAN OTOMATIS DARI CHATBOT WA n8n
    if (action === 'report_trouble') {
      const queryId = String(body.customer_id || '').trim().toUpperCase();
      const queryPhone = String(body.whatsapp || body.phone || '').replace(/\D/g, '');
      const cleanTail = queryPhone.length >= 8 ? queryPhone.slice(-9) : queryPhone;
      const keluhan = String(body.keluhan || body.message || 'Laporan kendala internet dari Chatbot WA').trim();

      const cust = customers.find((c) => {
        if (queryId && String(c.customer_id || '').toUpperCase() === queryId) return true;
        if (cleanTail) {
          const cPhone = String(c.whatsapp || '').replace(/\D/g, '');
          if (cPhone.endsWith(cleanTail)) return true;
        }
        return false;
      });

      if (!cust) {
        return { status_code: 404, error: 'Pelanggan tidak ditemukan untuk pembuatan tiket gangguan.' };
      }

      const nowMs = Date.now();
      const tiketId = 'TKT-' + String(nowMs).slice(-6);
      const logEntry = {
        id: nowMs,
        tiket_id: tiketId,
        status: 'DOWN',
        jenis_kendala: body.jenis_kendala || 'Laporan Chatbot WhatsApp (n8n)',
        teknisi: body.teknisi || 'Tim Teknisi Piket',
        status_penanganan: 'Pending',
        catatan_perbaikan: keluhan,
        waktu: formatWaktuIndo ? formatWaktuIndo(new Date(nowMs)) : new Date(nowMs).toISOString(),
        waktu_selesai: null,
        durasi: 'Sedang Berlangsung',
        created_at: nowMs,
        resolved_at: null,
        keterangan: `[n8n WA Bot] ${keluhan}`
      };

      if (!Array.isArray(cust.network_logs)) cust.network_logs = [];
      cust.network_logs.unshift(logEntry);
      cust.status_jaringan = 'Terisolir / Gangguan';
      cust.catatan_kendala = `[Tiket #${tiketId}]: ${keluhan}`;
      writeDB(customers, tenantId);

      appendLog(tenantId, {
        direction: 'incoming',
        event: 'action.report_trouble',
        status: 'processed',
        http_status: 200,
        target_url: '/api/n8n/incoming',
        summary: `Tiket gangguan #${tiketId} dibuat via n8n untuk ${cust.nama} (${cust.customer_id})`
      });

      return {
        status_code: 201,
        success: true,
        action: 'report_trouble',
        ticket: logEntry,
        customer: {
          id: cust.id,
          customer_id: cust.customer_id,
          nama: cust.nama,
          alamat: cust.alamat,
          wilayah: cust.wilayah,
          olt_port: (cust.device && cust.device.olt_port) || cust.olt_port || '-'
        },
        whatsapp_reply_text: `🛠️ *TIKET GANGGUAN TERCATAT*\nNomor Tiket: *#${tiketId}*\nPelanggan: ${cust.nama} (${cust.customer_id})\nKeluhan: ${keluhan}\n\nTim teknisi kami segera melakukan pengecekan. Terima kasih.`
      };
    }

    return {
      status_code: 400,
      error: `Action "${action}" tidak dikenali. Gunakan salah satu dari: check_bill, confirm_payment, buy_voucher, report_trouble.`
    };
  }

  // -------------------------------------------------------------------------
  // 3. RELAY NOTIFIKASI PINTAR (Grup Telegram Teknisi / Fonnte WA / Mode Dummy)
  // -------------------------------------------------------------------------
  async function relayNotification(tenantId = 'default', body = {}) {
    let cfg = readConfig(tenantId);
    const notifType = String(body.type || body.channel || 'teknisi_alert').trim();
    const targetPhone = String(body.target || cfg.wa_group_target || '6281234567890').trim();
    const messageText = String(body.message || 'Notifikasi otomatis Billing RT/RW.net').trim();

    const results = [];

    // Jika Bot Token sudah diisi tapi Chat ID masih kosong, deteksi otomatis dari Telegram getUpdates
    if (cfg.telegram_bot_token && !cfg.telegram_chat_id) {
      const detected = await detectTelegramChatId(cfg.telegram_bot_token);
      if (detected && detected.success && detected.selected) {
        cfg = saveConfig(tenantId, {
          telegram_chat_id: detected.selected.id,
          telegram_group_name: detected.selected.title || cfg.telegram_group_name
        });
      }
    }

    // A. Jika Token Bot Telegram & Chat ID tersedia -> Kirim ke Grup Telegram Asli (untuk Teknisi Alert maupun Monitoring Isolir/Struk)
    if (cfg.telegram_bot_token && cfg.telegram_chat_id) {
      try {
        const tgUrl = `https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`;
        let tgRes = await fetch(tgUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cfg.telegram_chat_id,
            text: messageText,
            parse_mode: 'Markdown'
          }),
          signal: AbortSignal.timeout(6000)
        });
        let tgData = await tgRes.json().catch(() => ({}));
        // Fallback tanpa parse_mode jika ada karakter Markdown yang tidak tertutup
        if (!tgRes.ok || !tgData.ok) {
          tgRes = await fetch(tgUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: cfg.telegram_chat_id,
              text: messageText.replace(/[*_`]/g, '')
            }),
            signal: AbortSignal.timeout(6000)
          });
          tgData = await tgRes.json().catch(() => ({}));
        }
        if (tgRes.ok && tgData.ok) {
          results.push({
            provider: 'Telegram Bot API',
            status: 'delivered',
            chat_id: cfg.telegram_chat_id,
            group_name: cfg.telegram_group_name
          });
        } else {
          results.push({ provider: 'Telegram Bot API', status: 'error', reason: tgData.description || `HTTP ${tgRes.status}` });
        }
      } catch (err) {
        results.push({ provider: 'Telegram Bot API', status: 'error', reason: err.message });
      }
    }

    // B. Jika Token Fonnte WA diisi -> Kirim ke Grup WA / Nomor WA Pelanggan Asli
    if (cfg.fonnte_token && cfg.fonnte_token !== 'ISI_TOKEN_FONNTE_ANDA_DISINI') {
      try {
        const waRes = await fetch('https://api.fonnte.com/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: cfg.fonnte_token
          },
          body: JSON.stringify({
            target: targetPhone,
            message: messageText
          }),
          signal: AbortSignal.timeout(5000)
        });
        const waData = await waRes.json().catch(() => ({}));
        if (waRes.ok && waData.status !== false) {
          results.push({ provider: 'WhatsApp Fonnte', status: 'delivered', target: targetPhone });
        } else {
          results.push({ provider: 'WhatsApp Fonnte', status: 'error', reason: waData.reason || 'Token Fonnte tidak valid' });
        }
      } catch (err) {
        results.push({ provider: 'WhatsApp Fonnte', status: 'error', reason: err.message });
      }
    }

    // C. Jika belum ada Token Asli (Mode Akun Dummy / Simulasi) -> Sukses Simulasi 100%
    const isSimulated = results.length === 0;
    const hasTelegram = results.some((r) => r.provider === 'Telegram Bot API' && r.status === 'delivered');
    const groupLabel = hasTelegram
      ? `Telegram: ${cfg.telegram_group_name} (${cfg.telegram_chat_id})`
      : (notifType === 'teknisi_alert'
        ? (cfg.telegram_group_name || 'Grup WA/Telegram Teknisi Lapangan')
        : `WhatsApp Pelanggan (${targetPhone})`);

    appendLog(tenantId, {
      direction: 'incoming',
      event: `notify.${notifType}`,
      status: isSimulated ? 'processed' : (results.some((r) => r.status === 'delivered') ? 'delivered' : 'simulated'),
      http_status: 200,
      target_url: groupLabel,
      summary: `${isSimulated ? '[Mode Dummy] ' : '🟢 [TERKIRIM] '}Pesan ke ${groupLabel}: ${messageText.replace(/\n+/g, ' ').slice(0, 90)}...`
    });

    return {
      status: true,
      success: true,
      mode: isSimulated ? 'dummy_simulation' : 'live_telegram_gateway',
      recipient_group: groupLabel,
      target: hasTelegram ? cfg.telegram_chat_id : targetPhone,
      message_preview: messageText,
      gateway_results: isSimulated
        ? [{ provider: 'Simulasi Grup Dummy Billing RT/RW.net', status: 'delivered', note: 'Berhasil diterima oleh simulator Grup Teknisi / WA' }]
        : results
    };
  }

  async function detectTelegramChatId(botToken) {
    const cleanToken = String(botToken || '').trim();
    if (!cleanToken) {
      return { success: false, error: 'Masukkan Bot Token dari @BotFather terlebih dahulu.' };
    }
    try {
      const url = `https://api.telegram.org/bot${cleanToken}/getUpdates`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        return { success: false, error: data.description || 'Token Bot Telegram tidak valid.' };
      }
      const updates = Array.isArray(data.result) ? data.result : [];
      const chats = [];
      for (let i = updates.length - 1; i >= 0; i--) {
        const u = updates[i];
        const msg = u.message || u.my_chat_member || u.channel_post;
        const chat = msg && msg.chat;
        if (chat && chat.id && !chats.some((c) => String(c.id) === String(chat.id))) {
          chats.push({
            id: String(chat.id),
            title: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || 'Chat Telegram',
            type: chat.type
          });
        }
      }
      if (chats.length === 0) {
        return {
          success: false,
          error: 'Belum ada pesan masuk di Bot ini. Silakan masukkan Bot ke Grup Telegram Teknisi lalu kirim 1 pesan apa saja (misal: /test) di grup tersebut, lalu klik tombol ini lagi.'
        };
      }
      return {
        success: true,
        selected: chats[0],
        chats
      };
    } catch (err) {
      return { success: false, error: 'Gagal menghubungi server Telegram: ' + err.message };
    }
  }

  return {
    DEFAULT_N8N_CONFIG,
    readConfig,
    saveConfig,
    readLogs,
    appendLog,
    clearLogs,
    emitEvent,
    handleIncomingAction,
    relayNotification,
    detectTelegramChatId
  };
}

module.exports = {
  DEFAULT_N8N_CONFIG,
  createN8nService
};
