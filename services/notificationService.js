'use strict';
/**
 * MODUL 4 - Otomatisasi pengingat tagihan & notifikasi WhatsApp.
 *
 * Jenis pesan:
 *   h3      : pengingat H-3 sebelum jatuh tempo
 *   due     : pengingat pada hari jatuh tempo (H)
 *   overdue : pengingat menunggak (perilaku lama cron: setiap hari selama belum lunas)
 *   paid    : konfirmasi pembayaran sukses
 *
 * Pengiriman memakai gateway WA yang sudah ada di server.js (Fonnte / Wablas) melalui
 * `dispatchWaMessage` yang di-inject. Layanan ini menambahkan:
 *   - de-duplikasi (customer.wa_notif) agar pesan tidak terkirim ganda saat cron/manual berulang
 *   - retry 2x, jeda antar pesan (hindari rate-limit gateway)
 *   - dukungan lintas tenant (cron berjalan per tenant aktif)
 *   - saklar per jenis pesan: settings.auto_notif = { h3, due, overdue, paid } (default true)
 *
 * Tidak pernah melempar error ke pemanggil.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 0812xxxx -> 62812xxxx ; buang spasi/strip/plus. */
function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s\-+()]/g, '');
  if (!p) return '';
  if (p.startsWith('0')) p = '62' + p.slice(1);
  return /^\d{9,15}$/.test(p) ? p : '';
}

function createNotificationService(deps) {
  const {
    readSettings, readDB, writeDB, compileMessage, dispatchWaMessage,
    getDaysDiff, runInTenant, listTenantIds, logActivity,
    formatMetodeBayar, tgl, periodeLabel
  } = deps;

  const log = (...a) => console.log('[wa-notif]', ...a);

  const TYPE_LABEL = { h3: 'H-3', due: 'Jatuh Tempo', overdue: 'Menunggak', paid: 'Pembayaran Sukses' };

  /** Kunci de-duplikasi: nilai berbeda = boleh kirim lagi. */
  function dedupeKey(type, c, invoice) {
    if (type === 'paid') return (invoice && invoice.periode) || c.jatuh_tempo || 'paid';
    if (type === 'overdue') return new Date().toISOString().slice(0, 10); // 1x per hari
    return c.jatuh_tempo; // h3 & due: 1x per siklus jatuh tempo
  }

  function buildMessage(type, c, settings, invoice) {
    const tpl = (settings.templates && settings.templates[type]) || (settings.templates && settings.templates.general) || '';
    let msg = compileMessage(tpl, c, settings);
    if (type === 'paid') {
      const inv = invoice || {};
      msg = msg
        .replace(/{tanggal_bayar}/g, inv.tanggal_bayar ? tgl(inv.tanggal_bayar) : '-')
        .replace(/{metode_bayar}/g, formatMetodeBayar(inv.metode_bayar || c.metode_bayar || 'QRIS DANA'))
        .replace(/{periode_bayar}/g, inv.periode ? periodeLabel(inv.periode) : '-');
    }
    return msg;
  }

  function markSent(customerId, type, key) {
    const data = readDB(); // baca ulang agar tidak menimpa perubahan lain selama pengiriman async
    const c = data.find((x) => x.id === customerId);
    if (!c) return;
    c.wa_notif = { ...(c.wa_notif || {}), [type]: key };
    writeDB(data);
  }

  /**
   * Kirim satu notifikasi. Mengembalikan { sent, reason?, error? }.
   * Harus dipanggil di dalam konteks tenant yang benar.
   */
  async function sendOne(type, c, { invoice = null, settings = null, force = false } = {}) {
    try {
      const s = settings || readSettings();
      const toggles = s.auto_notif || {};
      if (!force && toggles[type] === false) return { sent: false, reason: 'disabled' };
      if (!s.wa_provider || s.wa_provider === 'manual') return { sent: false, reason: 'manual_provider' };
      if (!s.api_token) return { sent: false, reason: 'no_token' };

      const phone = normalizePhone(c.whatsapp);
      if (!phone) return { sent: false, reason: 'no_phone' };

      const key = dedupeKey(type, c, invoice);
      if (!force && c.wa_notif && c.wa_notif[type] === key) return { sent: false, reason: 'duplicate' };

      const message = buildMessage(type, c, s, invoice);
      if (!message) return { sent: false, reason: 'empty_template' };

      let lastErr = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await dispatchWaMessage(phone, message, s);
          markSent(c.id, type, key);
          try {
            logActivity('WA_NOTIF_' + type.toUpperCase(), `Notifikasi WhatsApp ${TYPE_LABEL[type]} terkirim ke ${c.nama} (${c.customer_id})`, {
              kategori: 'WhatsApp', target_id: c.customer_id
            });
          } catch (_) { /* log opsional */ }
          return { sent: true };
        } catch (e) {
          lastErr = e;
          if (attempt < 2) await sleep(1500);
        }
      }
      log(`gagal kirim ${type} ke ${c.nama}: ${lastErr && lastErr.message}`);
      return { sent: false, reason: 'gateway_error', error: lastErr && lastErr.message };
    } catch (err) {
      return { sent: false, reason: 'exception', error: err.message };
    }
  }

  /** Notifikasi sukses bayar (dipanggil fire-and-forget dari rute pelunasan). */
  function notifyPaid(c, invoice) {
    return sendOne('paid', c, { invoice });
  }

  /** Jenis pengingat untuk selisih hari tertentu (null = tidak perlu). */
  function reminderTypeForDiff(diff) {
    if (diff === 3) return 'h3';
    if (diff === 0) return 'due';
    if (diff < 0) return 'overdue';
    return null;
  }

  /**
   * Jalankan pengingat harian untuk SATU tenant (H-3, jatuh tempo, menunggak).
   * Mengembalikan ringkasan { tenant, total, sent, skipped, failed, details }.
   */
  function runDailyReminders(tenantId = 'default', now = new Date()) {
    return runInTenant(tenantId, async () => {
      const summary = { tenant: tenantId, total: 0, sent: 0, skipped: 0, failed: 0, details: [] };
      try {
        const settings = readSettings();
        const data = readDB();
        for (const c of data) {
          if (c.status_tagihan !== 'Belum Lunas') continue;
          const inv = (Array.isArray(c.invoices) && c.invoices.find((i) => i.status !== 'Lunas')) || (Array.isArray(c.invoices) && c.invoices[c.invoices.length - 1]);
          const jt = (inv && inv.jatuh_tempo) || c.jatuh_tempo;
          if (typeof jt !== 'string' || !jt.includes('-')) continue;
          const type = reminderTypeForDiff(getDaysDiff(jt, now));
          if (!type) continue;
          summary.total++;
          const r = await sendOne(type, c, { invoice: inv, settings });
          if (r.sent) summary.sent++;
          else if (['gateway_error', 'exception'].includes(r.reason)) summary.failed++;
          else summary.skipped++;
          summary.details.push({ id: c.id, nama: c.nama, type, ...r });
          if (r.sent) await sleep(800); // jeda antar pesan
        }
      } catch (err) {
        summary.error = err.message;
      }
      return summary;
    });
  }

  /** Jalankan pengingat harian untuk semua tenant aktif. */
  async function runAllTenants(now = new Date()) {
    const out = [];
    for (const id of listTenantIds()) {
      out.push(await runDailyReminders(id, now));
    }
    return out;
  }

  return { normalizePhone, sendOne, notifyPaid, runDailyReminders, runAllTenants, reminderTypeForDiff, buildMessage };
}

module.exports = { createNotificationService, normalizePhone };

