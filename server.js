const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'customers.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Helper database JSON (tulis atomik agar file tidak korup) ----
const readDB = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const writeDB = (data) => {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
};

// ---- Settings Helper (WA Gateway & Templates) ----
const defaultSettings = {
  wa_provider: 'manual', // 'manual', 'fonnte', 'wablas'
  api_token: '',
  sender_phone: '',
  templates: {
    h3: "Assalamualaikum / Halo {nama},\n\nPengingat: Tagihan internet RT/RW.net Anda untuk periode {periode} akan jatuh tempo 3 hari lagi pada {jatuh_tempo}.\n• Paket: {paket}\n• Total Tagihan: {total_tagihan}\n\nMohon lakukan pembayaran sebelum tanggal jatuh tempo agar koneksi tetap lancar. Terima kasih! 🙏",
    due: "Assalamualaikum / Halo {nama},\n\nHari ini adalah batas akhir (Jatuh Tempo: {jatuh_tempo}) pembayaran tagihan internet RT/RW.net periode {periode}.\n• Paket: {paket}\n• Total Tagihan: {total_tagihan}\n\nSilakan konfirmasi jika sudah melakukan transfer/pembayaran. Terima kasih! 🙏",
    overdue: "Pemberitahuan Tagihan Melewati Jatuh Tempo\n\nKepada Yth. {nama},\nTagihan internet RT/RW.net Anda periode {periode} telah MELEWATI jatuh tempo ({jatuh_tempo}).\n• Paket: {paket}\n• Total Tagihan: {total_tagihan}\n• Status Jaringan: {status_jaringan}\n\nHarap segera menyelesaikan pembayaran hari ini untuk menghindari isolir / pemutusan sementara jaringan internet. Hubungi admin jika membutuhkan bantuan.",
    general: "Assalamualaikum / Selamat pagi Bapak/Ibu {nama},\n\nKami dari RT/RW.net menginformasikan rincian tagihan internet Anda:\n• Periode: {periode}\n• Paket: {paket}\n• Status Jaringan: {status_jaringan}\n• Total Tagihan: {total_tagihan}\n• Batas Pembayaran: {jatuh_tempo}\n\nMohon melakukan pembayaran sebelum batas jatuh tempo. Abaikan pesan ini jika sudah melakukan pembayaran. Terima kasih! 🙏"
  }
};

const readSettings = () => {
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
    return defaultSettings;
  }
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...defaultSettings, ...s, templates: { ...defaultSettings.templates, ...(s.templates || {}) } };
  } catch (e) {
    return defaultSettings;
  }
};

const writeSettings = (s) => {
  const tmp = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
};

const STATUS = ['Lunas', 'Belum Lunas'];
const STATUS_JARINGAN = ['Aktif', 'Terisolir / Gangguan'];
const STATUS_GANGGUAN = ['DOWN', 'UP'];
const pad = (n) => String(n).padStart(2, '0');
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Format waktu real-time Indonesia (misal: "11 Oktober 2026, 20:00 WIB")
const formatWaktuIndo = (d = new Date()) => {
  const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const tgl = d.getDate();
  const bln = bulan[d.getMonth()];
  const thn = d.getFullYear();
  const jam = pad(d.getHours());
  const mnt = pad(d.getMinutes());
  return `${tgl} ${bln} ${thn}, ${jam}:${mnt} WIB`;
};

function addMonth(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

const makeInvoice = (c, status = 'Belum Lunas', tanggal_bayar = null) => ({
  periode: c.jatuh_tempo.slice(0, 7), nominal: c.harga, status, tanggal_bayar,
});
const currentInvoice = (c) => c.invoices.find((i) => i.periode === c.jatuh_tempo.slice(0, 7));

function ensureFieldsAndInvoices(data) {
  let changed = false;
  for (const c of data) {
    if (!Array.isArray(c.invoices)) {
      c.invoices = [makeInvoice(c, c.status_tagihan)];
      changed = true;
    }
    if (!c.status_jaringan) {
      c.status_jaringan = 'Aktif';
      changed = true;
    }
    if (c.catatan_kendala === undefined) {
      c.catatan_kendala = '';
      changed = true;
    }
    if (!Array.isArray(c.network_logs)) {
      c.network_logs = [];
      changed = true;
    }
  }
  return changed;
}

function parseCustomer(body = {}) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const c = {
    nama: str(body.nama),
    whatsapp: str(body.whatsapp).replace(/[\s\-+]/g, ''),
    alamat: str(body.alamat),
    wilayah: str(body.wilayah),
    paket: str(body.paket),
    harga: Number(body.harga),
    jatuh_tempo: str(body.jatuh_tempo),
    status_jaringan: STATUS_JARINGAN.includes(body.status_jaringan) ? body.status_jaringan : 'Aktif',
    catatan_kendala: str(body.catatan_kendala),
  };
  if (!c.nama || !c.alamat || !c.wilayah || !c.paket) return { error: 'Nama, alamat, wilayah, dan paket wajib diisi' };
  if (c.whatsapp.startsWith('0')) c.whatsapp = '62' + c.whatsapp.slice(1);
  if (!/^\d{9,15}$/.test(c.whatsapp)) return { error: 'Nomor WhatsApp tidak valid (gunakan format 62812...)' };
  if (!Number.isFinite(c.harga) || c.harga <= 0) return { error: 'Harga harus berupa angka lebih dari 0' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.jatuh_tempo) || isNaN(new Date(c.jatuh_tempo))) {
    return { error: 'Tanggal jatuh tempo tidak valid' };
  }
  return { value: c };
}

// ---- API Customers ----
app.get('/api/customers', (req, res) => {
  const data = readDB();
  if (ensureFieldsAndInvoices(data)) writeDB(data);
  res.json(data);
});

app.post('/api/customers', (req, res) => {
  const { value, error } = parseCustomer(req.body);
  if (error) return res.status(400).json({ error });
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const c = {
    id: data.reduce((m, x) => Math.max(m, x.id), 0) + 1,
    ...value,
    status_tagihan: 'Belum Lunas',
    network_logs: [],
  };
  c.invoices = [makeInvoice(c)];
  data.push(c);
  writeDB(data);
  res.status(201).json(c);
});

app.put('/api/customers/:id', (req, res) => {
  const { value, error } = parseCustomer(req.body);
  if (error) return res.status(400).json({ error });
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const c = data.find((x) => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  const inv = currentInvoice(c);
  Object.assign(c, value);
  if (inv && inv.status !== 'Lunas') {
    inv.nominal = c.harga;
    inv.periode = c.jatuh_tempo.slice(0, 7);
  } else if (!currentInvoice(c)) {
    c.invoices.push(makeInvoice(c, c.status_tagihan));
  }
  writeDB(data);
  res.json(c);
});

app.patch('/api/customers/:id/status', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const c = data.find((x) => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  const status = req.body && req.body.status;
  if (status !== undefined && !STATUS.includes(status)) {
    return res.status(400).json({ error: 'Status tidak valid' });
  }
  c.status_tagihan = status || (c.status_tagihan === 'Lunas' ? 'Belum Lunas' : 'Lunas');

  let inv = currentInvoice(c);
  if (!inv) { inv = makeInvoice(c); c.invoices.push(inv); }
  inv.status = c.status_tagihan;

  if (c.status_tagihan === 'Lunas') {
    let tglBayar = req.body && typeof req.body.tanggal_bayar === 'string' ? req.body.tanggal_bayar.trim() : '';
    if (tglBayar && (!/^\d{4}-\d{2}-\d{2}$/.test(tglBayar) || isNaN(new Date(tglBayar)))) {
      return res.status(400).json({ error: 'Format tanggal pembayaran tidak valid (YYYY-MM-DD)' });
    }
    inv.tanggal_bayar = tglBayar || today();
  } else {
    inv.tanggal_bayar = null;
  }

  writeDB(data);
  res.json(c);
});

// Toggle status jaringan cepat (Aktif <-> Terisolir / Gangguan)
app.patch('/api/customers/:id/jaringan', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const c = data.find((x) => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  const status = req.body && req.body.status_jaringan;
  if (status !== undefined && !STATUS_JARINGAN.includes(status)) {
    return res.status(400).json({ error: 'Status jaringan tidak valid' });
  }
  c.status_jaringan = status || (c.status_jaringan === 'Aktif' ? 'Terisolir / Gangguan' : 'Aktif');
  if (req.body && req.body.catatan_kendala !== undefined) {
    c.catatan_kendala = String(req.body.catatan_kendala).trim();
  }

  // Rekam ke network_logs jika requested
  if (req.body && req.body.record_log) {
    const logStatus = c.status_jaringan === 'Aktif' ? 'UP' : 'DOWN';
    const logTime = req.body.waktu || formatWaktuIndo();
    const logKet = req.body.catatan_kendala || (logStatus === 'UP' ? 'Jaringan kembali normal' : 'Gangguan jaringan / isolir');
    c.network_logs.unshift({
      id: Date.now(),
      status: logStatus,
      waktu: logTime,
      keterangan: logKet,
    });
  }

  writeDB(data);
  res.json(c);
});

// ---- Tambah Log Gangguan Real-Time (DOWN / UP) ----
app.post('/api/customers/:id/network-logs', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const c = data.find((x) => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  const { status, waktu, keterangan } = req.body || {};
  if (!STATUS_GANGGUAN.includes(status)) {
    return res.status(400).json({ error: 'Status harus bernilai "DOWN" atau "UP"' });
  }

  const logEntry = {
    id: Date.now(),
    status: status,
    waktu: typeof waktu === 'string' && waktu.trim() ? waktu.trim() : formatWaktuIndo(),
    keterangan: typeof keterangan === 'string' && keterangan.trim() ? keterangan.trim() : (status === 'UP' ? 'Jaringan kembali normal' : 'Gangguan jaringan'),
  };

  if (!Array.isArray(c.network_logs)) c.network_logs = [];
  c.network_logs.unshift(logEntry);

  // Otomatis sinkronkan status profil pelanggan dengan status log terakhir
  if (status === 'DOWN') {
    c.status_jaringan = 'Terisolir / Gangguan';
    if (logEntry.keterangan && logEntry.keterangan !== 'Gangguan jaringan') {
      c.catatan_kendala = logEntry.keterangan;
    }
  } else if (status === 'UP') {
    c.status_jaringan = 'Aktif';
    c.catatan_kendala = '';
  }

  writeDB(data);
  res.status(201).json({ customer: c, log: logEntry });
});

// Hapus satu log gangguan
app.delete('/api/customers/:id/network-logs/:logId', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const c = data.find((x) => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  const logId = Number(req.params.logId);
  c.network_logs = (c.network_logs || []).filter((l) => l.id !== logId);
  writeDB(data);
  res.json(c);
});

app.post('/api/generate-tagihan', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const n = generateBills(data);
  writeDB(data);
  res.json({ generated: n });
});

function generateBills(data, now = new Date()) {
  const thisMonth = today(now).slice(0, 7);
  let count = 0;
  for (const c of data) {
    if (c.status_tagihan === 'Lunas' && c.jatuh_tempo.slice(0, 7) <= thisMonth) {
      c.jatuh_tempo = addMonth(c.jatuh_tempo);
      c.status_tagihan = 'Belum Lunas';
      if (!currentInvoice(c)) c.invoices.push(makeInvoice(c));
      count++;
    }
  }
  return count;
}

// ---- Settings API ----
app.get('/api/settings', (req, res) => {
  res.json(readSettings());
});

app.post('/api/settings', (req, res) => {
  const cur = readSettings();
  const body = req.body || {};
  const updated = {
    ...cur,
    wa_provider: ['manual', 'fonnte', 'wablas'].includes(body.wa_provider) ? body.wa_provider : cur.wa_provider,
    api_token: typeof body.api_token === 'string' ? body.api_token.trim() : cur.api_token,
    sender_phone: typeof body.sender_phone === 'string' ? body.sender_phone.trim() : cur.sender_phone,
    templates: {
      ...cur.templates,
      ...(body.templates || {})
    }
  };
  writeSettings(updated);
  res.json(updated);
});

// ---- Send WhatsApp via Gateway or Direct ----
app.post('/api/send-wa', async (req, res) => {
  const { customer_id, message, phone } = req.body || {};
  const settings = readSettings();
  const targetPhone = phone ? String(phone).replace(/[\s\-+]/g, '') : null;

  if (!targetPhone || !message) {
    return res.status(400).json({ error: 'Nomor telepon dan pesan wajib diisi' });
  }

  if (!settings.wa_provider || settings.wa_provider === 'manual') {
    return res.json({ mode: 'manual', message: 'Gunakan tautan wa.me', url: `https://wa.me/${targetPhone}?text=${encodeURIComponent(message)}` });
  }

  if (!settings.api_token) {
    return res.status(400).json({ error: `Token API untuk provider ${settings.wa_provider} belum dikonfigurasi di Pengaturan` });
  }

  try {
    let apiRes;
    if (settings.wa_provider === 'fonnte') {
      const response = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: {
          'Authorization': settings.api_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          target: targetPhone,
          message: message
        })
      });
      apiRes = await response.json();
      if (!response.ok || (apiRes && apiRes.status === false)) {
        return res.status(502).json({ error: (apiRes && apiRes.reason) || 'Gagal mengirim pesan melalui Fonnte', detail: apiRes });
      }
      return res.json({ success: true, provider: 'fonnte', detail: apiRes });
    } else if (settings.wa_provider === 'wablas') {
      const response = await fetch('https://api.wablas.com/api/send-message', {
        method: 'POST',
        headers: {
          'Authorization': settings.api_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone: targetPhone,
          message: message
        })
      });
      apiRes = await response.json();
      if (!response.ok || (apiRes && apiRes.status === false)) {
        return res.status(502).json({ error: (apiRes && apiRes.message) || 'Gagal mengirim pesan melalui Wablas', detail: apiRes });
      }
      return res.json({ success: true, provider: 'wablas', detail: apiRes });
    }
  } catch (err) {
    return res.status(500).json({ error: `Gagal menghubungi server WhatsApp Gateway: ${err.message}` });
  }
});

// ---- CSV Export API ----
app.get('/api/export/csv', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);

  const header = ['ID', 'Nama', 'WhatsApp', 'Alamat', 'Wilayah', 'Paket', 'Harga (Rp)', 'Jatuh Tempo', 'Status Tagihan', 'Status Jaringan', 'Catatan Kendala', 'Total Log Gangguan'];
  const rows = data.map((c) => [
    c.id,
    `"${(c.nama || '').replace(/"/g, '""')}"`,
    `'${c.whatsapp}`,
    `"${(c.alamat || '').replace(/"/g, '""')}"`,
    `"${(c.wilayah || '').replace(/"/g, '""')}"`,
    `"${(c.paket || '').replace(/"/g, '""')}"`,
    c.harga,
    c.jatuh_tempo,
    c.status_tagihan,
    c.status_jaringan || 'Aktif',
    `"${(c.catatan_kendala || '').replace(/"/g, '""')}"`,
    (c.network_logs || []).length,
  ]);

  const csvContent = '\uFEFF' + [header.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="laporan-billing-rtrw-${today()}.csv"`);
  res.send(csvContent);
});

// Auto-generate: cek saat start & setiap jam; hanya bertindak pada tanggal 1
function autoGenerate() {
  const now = new Date();
  const data = readDB();
  let changed = ensureFieldsAndInvoices(data);
  if (now.getDate() === 1) {
    const n = generateBills(data, now);
    if (n) { changed = true; console.log(`[auto] ${n} tagihan baru dibuat`); }
  }
  if (changed) writeDB(data);
}
autoGenerate();
setInterval(autoGenerate, 60 * 60 * 1000);

app.listen(PORT, () => console.log(`Billing RT/RW.net berjalan di http://localhost:${PORT}`));
