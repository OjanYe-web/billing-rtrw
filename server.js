const express = require('express');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'customers.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const PACKAGES_FILE = path.join(__dirname, 'packages.json');
const BANK_ACCOUNTS_FILE = path.join(__dirname, 'bank_accounts.json');
const INVENTORY_STOCK_FILE = path.join(__dirname, 'inventory_stock.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Helper database JSON (tulis atomik & aman dari crash / file lock) ----
const safeWriteJSON = (filePath, data) => {
  const tmp = filePath + '.tmp';
  const str = JSON.stringify(data, null, 2);
  try {
    fs.writeFileSync(tmp, str, 'utf8');
    try {
      fs.renameSync(tmp, filePath);
    } catch (renameErr) {
      // Fallback untuk Windows jika renameSync terkena lock EPERM/EBUSY
      fs.writeFileSync(filePath, str, 'utf8');
      if (fs.existsSync(tmp)) {
        try { fs.unlinkSync(tmp); } catch (_) {}
      }
    }
  } catch (err) {
    fs.writeFileSync(filePath, str, 'utf8');
  }
};

const readDB = () => {
  if (!fs.existsSync(DB_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Error saat membaca customers.json, fallback ke []:', e.message);
    return [];
  }
};

const writeDB = (data) => safeWriteJSON(DB_FILE, data);

// ---- Helper Paket Internet (packages.json) ----
const defaultPackages = [
  {
    id: "PKG-01",
    nama: "Paket Warga 10 Mbps",
    kecepatan: "10 Mbps",
    harga: 100000,
    mikrotik_profile: "10Mbps",
    deskripsi: "Paket hemat internet rumah untuk browsing, sosmed, dan streaming HD"
  },
  {
    id: "PKG-02",
    nama: "Paket Warga 20 Mbps",
    kecepatan: "20 Mbps",
    harga: 150000,
    mikrotik_profile: "20Mbps",
    deskripsi: "Cocok untuk keluarga 3-5 perangkat, meeting online & streaming 4K"
  },
  {
    id: "PKG-03",
    nama: "Paket Gamer 30 Mbps",
    kecepatan: "30 Mbps",
    harga: 250000,
    mikrotik_profile: "30Mbps",
    deskripsi: "Prioritas bandwidth, latency rendah untuk gaming & download cepat"
  },
  {
    id: "PKG-04",
    nama: "Paket Bisnis 50 Mbps",
    kecepatan: "50 Mbps",
    harga: 350000,
    mikrotik_profile: "50Mbps",
    deskripsi: "Paket kecepatan tinggi untuk kantor, toko, warkop, dan multi-user"
  }
];

const readPackages = () => {
  if (!fs.existsSync(PACKAGES_FILE)) {
    fs.writeFileSync(PACKAGES_FILE, JSON.stringify(defaultPackages, null, 2));
    return defaultPackages;
  }
  try {
    return JSON.parse(fs.readFileSync(PACKAGES_FILE, 'utf8'));
  } catch (e) {
    return defaultPackages;
  }
};

const writePackages = (data) => safeWriteJSON(PACKAGES_FILE, data);

// ---- Helper Rekening Bank (bank_accounts.json) ----
const defaultBankAccounts = [
  {
    id: "BANK-01",
    nama_bank: "BCA",
    nomor_rekening: "8830123456",
    atas_nama: "MOHAMMAD FAHER",
    keterangan: "Rekening Utama (Bebas Admin via BI-FAST)",
    is_active: true
  },
  {
    id: "BANK-02",
    nama_bank: "Mandiri",
    nomor_rekening: "1370019876543",
    atas_nama: "MOHAMMAD FAHER",
    keterangan: "Bank Mandiri Operasional RT/RW.net",
    is_active: true
  },
  {
    id: "BANK-03",
    nama_bank: "BRI",
    nomor_rekening: "012301098765501",
    atas_nama: "MOHAMMAD FAHER",
    keterangan: "Bisa setor tunai/transfer via Agen BRILink terdekat",
    is_active: true
  },
  {
    id: "BANK-04",
    nama_bank: "SeaBank",
    nomor_rekening: "901234567890",
    atas_nama: "MOHAMMAD FAHER",
    keterangan: "Gratis transfer dari ShopeePay / Bank Lain",
    is_active: true
  }
];

const readBankAccounts = () => {
  if (!fs.existsSync(BANK_ACCOUNTS_FILE)) {
    fs.writeFileSync(BANK_ACCOUNTS_FILE, JSON.stringify(defaultBankAccounts, null, 2));
    return defaultBankAccounts;
  }
  try {
    return JSON.parse(fs.readFileSync(BANK_ACCOUNTS_FILE, 'utf8'));
  } catch (e) {
    return defaultBankAccounts;
  }
};

const writeBankAccounts = (data) => safeWriteJSON(BANK_ACCOUNTS_FILE, data);

// ---- Helper Manajemen Stok & Inventaris Material (inventory_stock.json) ----
const defaultInventoryStock = [
  {
    id: "STK-01",
    nama_barang: "Modem ONT ZTE F609 V3",
    kategori: "Perangkat",
    jumlah_stok: 25,
    satuan: "Pcs",
    harga_satuan: 165000,
    keterangan: "GPON ONT 4 Port LAN + Wi-Fi, support PPPoE & Bridge",
    min_stok: 5
  },
  {
    id: "STK-02",
    nama_barang: "Modem ONT Huawei HG8245H5",
    kategori: "Perangkat",
    jumlah_stok: 18,
    satuan: "Pcs",
    harga_satuan: 220000,
    keterangan: "Dual Band GPON ONT 2.4G & 5G AC untuk paket Gamer/Bisnis",
    min_stok: 5
  },
  {
    id: "STK-03",
    nama_barang: "Kabel Drop Core FO 1 Core 3 Sling",
    kategori: "Kabel",
    jumlah_stok: 1450,
    satuan: "Meter",
    harga_satuan: 850,
    keterangan: "Kabel FO 1 Core dengan 3 kawat seling baja untuk tarikan tiang luar",
    min_stok: 200
  },
  {
    id: "STK-04",
    nama_barang: "Fast Connector SC/UPC (Biru)",
    kategori: "Aksesoris",
    jumlah_stok: 120,
    satuan: "Pcs",
    harga_satuan: 3500,
    keterangan: "Konektor mekanik cepat terminasi kabel drop core ke ONT",
    min_stok: 20
  },
  {
    id: "STK-05",
    nama_barang: "Patch Cord SC-UPC to SC-UPC 3 Meter",
    kategori: "Aksesoris",
    jumlah_stok: 45,
    satuan: "Pcs",
    harga_satuan: 12000,
    keterangan: "Kabel jumper penghubung Roset/ODP ke port PON modem",
    min_stok: 10
  },
  {
    id: "STK-06",
    nama_barang: "Optical Distribution Point (ODP) 8 Port",
    kategori: "Aksesoris",
    jumlah_stok: 8,
    satuan: "Box",
    harga_satuan: 85000,
    keterangan: "Box splitter tiang luar ruangan komplit adapter SC/UPC",
    min_stok: 2
  },
  {
    id: "STK-07",
    nama_barang: "Router AP Totolink N200RE",
    kategori: "Perangkat",
    jumlah_stok: 12,
    satuan: "Pcs",
    harga_satuan: 135000,
    keterangan: "Router access point tambahan untuk perluasan jangkauan Wi-Fi",
    min_stok: 3
  }
];

const readInventoryStock = () => {
  if (!fs.existsSync(INVENTORY_STOCK_FILE)) {
    fs.writeFileSync(INVENTORY_STOCK_FILE, JSON.stringify(defaultInventoryStock, null, 2));
    return defaultInventoryStock;
  }
  try {
    return JSON.parse(fs.readFileSync(INVENTORY_STOCK_FILE, 'utf8'));
  } catch (e) {
    return defaultInventoryStock;
  }
};

const writeInventoryStock = (data) => safeWriteJSON(INVENTORY_STOCK_FILE, data);

// Fungsi Pengurangan Stok Otomatis saat Pemakaian Material di Lapangan
function deductInventoryStock(itemNameOrKeyword, quantity = 1, contextInfo = '') {
  if (!itemNameOrKeyword) return null;
  const stockList = readInventoryStock();
  if (!stockList || stockList.length === 0) return null;

  const search = String(itemNameOrKeyword).trim().toLowerCase();
  let item = stockList.find(s => s.nama_barang.toLowerCase() === search);
  if (!item) {
    item = stockList.find(s => 
      search.includes(s.nama_barang.toLowerCase()) || 
      s.nama_barang.toLowerCase().includes(search) ||
      (s.kategori === 'Perangkat' && search.includes(s.nama_barang.toLowerCase().replace('modem ont ', '')))
    );
  }

  if (item) {
    const qty = Math.max(1, Number(quantity) || 1);
    const prevStock = item.jumlah_stok;
    item.jumlah_stok = Math.max(0, item.jumlah_stok - qty);
    writeInventoryStock(stockList);

    logActivity('PENGURANGAN_STOK', `Pengurangan otomatis stok: "${item.nama_barang}" berkurang ${qty} ${item.satuan} (${contextInfo || 'Pemakaian pelanggan'}). Sisa stok: ${item.jumlah_stok} ${item.satuan}`, {
      kategori: 'Inventaris',
      target_id: item.id
    });

    return {
      item,
      qty_deducted: qty,
      prev_stock: prevStock,
      remaining_stock: item.jumlah_stok
    };
  }

  return null;
}

// ---- Settings Helper (WA Gateway, Templates, Info QRIS & Router MikroTik) ----
const defaultSettings = {
  wa_provider: 'manual', // 'manual', 'fonnte', 'wablas'
  api_token: '',
  sender_phone: '',
  qris_info: 'DANA Bisnis (Workshop JanYe, NMID: ID1026610426227)',
  mikrotik: {
    enabled: true,
    host: '192.168.88.1',
    port: 8728,
    username: 'admin',
    password: '',
    identity: 'MikroTik-CCR1009-Billing',
    model: 'CCR1009-7G-1C-1S+',
    version: 'RouterOS v7.14.3',
    profile_isolir: 'profile-ISOLIR',
    last_sync: null
  },
  templates: {
    h3: "Assalamualaikum / Halo {nama},\n\nPengingat Tagihan Internet RT/RW.net:\nTagihan periode {periode} Anda akan jatuh tempo 3 hari lagi pada {jatuh_tempo}.\n• Paket: {paket}\n• Total Tagihan: {total_tagihan}\n• Cara Bayar (QRIS): Scan QRIS {qris_info} atau transfer ke admin.\n\nMohon lakukan pembayaran sebelum batas jatuh tempo agar koneksi tetap lancar. Terima kasih! 🙏",
    due: "Assalamualaikum / Halo {nama},\n\nHari ini adalah BATAS AKHIR (Jatuh Tempo: {jatuh_tempo}) pembayaran tagihan internet RT/RW.net periode {periode}.\n• Paket: {paket}\n• Total Tagihan: {total_tagihan}\n• Pembayaran QRIS: {qris_info}\n\nSilakan konfirmasi jika sudah melakukan transfer/scan QRIS. Terima kasih! 🙏",
    overdue: "PEMBERITAHUAN TAGIHAN MELEWATI JATUH TEMPO (MENUNGGAK)\n\nKepada Yth. {nama},\nTagihan internet RT/RW.net Anda periode {periode} telah MELEWATI jatuh tempo ({jatuh_tempo}).\n• Paket: {paket}\n• Total Tagihan: {total_tagihan}\n• Status Jaringan: {status_jaringan}\n• Metode Bayar: QRIS {qris_info}\n\nHarap segera menyelesaikan pembayaran hari ini untuk menghindari isolir/pemutusan jaringan internet. Hubungi admin jika butuh bantuan.",
    general: "Assalamualaikum / Selamat pagi Bapak/Ibu {nama},\n\nKami dari RT/RW.net menginformasikan rincian tagihan internet Anda:\n• Periode: {periode}\n• Paket: {paket}\n• Status Jaringan: {status_jaringan}\n• Total Tagihan: {total_tagihan}\n• Batas Pembayaran: {jatuh_tempo}\n• Pembayaran QRIS: {qris_info}\n\nMohon melakukan pembayaran sebelum batas jatuh tempo. Abaikan pesan ini jika sudah membayar. Terima kasih! 🙏"
  }
};

const readSettings = () => {
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
    return defaultSettings;
  }
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return {
      ...defaultSettings,
      ...s,
      mikrotik: { ...defaultSettings.mikrotik, ...(s.mikrotik || {}) },
      templates: { ...defaultSettings.templates, ...(s.templates || {}) }
    };
  } catch (e) {
    return defaultSettings;
  }
};

const writeSettings = (s) => safeWriteJSON(SETTINGS_FILE, s);

const STATUS = ['Lunas', 'Belum Lunas'];
const STATUS_JARINGAN = ['Aktif', 'Terisolir', 'Terisolir / Gangguan', 'Gangguan'];
const STATUS_GANGGUAN = ['DOWN', 'UP'];
const STATUS_PENANGANAN = ['Pending', 'Sedang Dikerjakan', 'Selesai'];
const pad = (n) => String(n).padStart(2, '0');
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Helper hitung durasi penyelesaian tiket (dalam menit/jam/hari)
function formatDurasi(startMs, endMs) {
  if (!startMs || !endMs || endMs < startMs) return '-';
  const diffMinutes = Math.round((endMs - startMs) / (1000 * 60));
  if (diffMinutes < 1) return 'Kurang dari 1 menit';
  if (diffMinutes < 60) return `${diffMinutes} Menit`;
  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;
  if (hours < 24) {
    return mins > 0 ? `${hours} Jam ${mins} Menit` : `${hours} Jam`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days} Hari ${remainingHours} Jam` : `${days} Hari`;
}

// Logika otomatis isolir: jika belum lunas dan telah melewati batas toleransi hari (default 7 hari)
function checkAutoIsolir(data, graceDays = 7, now = new Date()) {
  let count = 0;
  for (const c of data) {
    if (c.status_tagihan === 'Belum Lunas') {
      const diffDays = getDaysDiff(c.jatuh_tempo, now); // < 0 berarti lewat jatuh tempo
      if (diffDays <= -graceDays && c.status_jaringan !== 'Terisolir') {
        c.status_jaringan = 'Terisolir';
        c.catatan_kendala = `Terisolir otomatis (Menunggak ${Math.abs(diffDays)} hari)`;
        if (!Array.isArray(c.network_logs)) c.network_logs = [];
        c.network_logs.unshift({
          id: Date.now() + Math.floor(Math.random() * 1000),
          status: 'DOWN',
          waktu: formatWaktuIndo(now),
          keterangan: `Isolir otomatis sistem: Menunggak ${Math.abs(diffDays)} hari (jatuh tempo: ${tgl(c.jatuh_tempo)})`,
        });
        count++;
      }
    }
  }
  return count;
}

const formatWaktuIndo = (d = new Date()) => {
  const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())} WIB`;
};

const rupiah = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
const periodeLabel = (p) => p ? new Date(p + '-01T00:00:00').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : '-';
const tgl = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';

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

// ---- AUDIT TRAIL / LOG AKTIVITAS ADMIN HELPER ----
const ACTIVITY_LOGS_FILE = path.join(__dirname, 'activity_logs.json');
const defaultActivityLogs = [
  {
    id: 1791668961287,
    aksi: "MUTASI_PERANGKAT",
    kategori: "Inventaris",
    keterangan: "Penggantian modem ONT Budi Santoso (PLG001) ke ZTE F609 V3 (SN: ZTEG99887766)",
    admin: "Rian (Teknisi Lapangan)",
    waktu: "11 Oktober 2026, 04:49 WIB",
    timestamp: 1791668961287,
    target_id: "PLG001",
    ip: "127.0.0.1"
  },
  {
    id: 1791664606902,
    aksi: "BUAT_TIKET_GANGGUAN",
    kategori: "Jaringan",
    keterangan: "Membuka tiket gangguan #TKT-664606 untuk Budi Santoso: Kabel Fiber Optic Putus (LOS Merah)",
    admin: "Admin Utama",
    waktu: "11 Oktober 2026, 03:36 WIB",
    timestamp: 1791664606902,
    target_id: "PLG001",
    ip: "127.0.0.1"
  },
  {
    id: 1791657699880,
    aksi: "STATUS_LUNAS",
    kategori: "Billing",
    keterangan: "Pelunasan tagihan QRIS DANA Bisnis: Budi Santoso (PLG001) periode 2026-10 senilai Rp 100.000",
    admin: "Admin Utama",
    waktu: "11 Oktober 2026, 01:20 WIB",
    timestamp: 1791657699880,
    target_id: "PLG001",
    ip: "127.0.0.1"
  }
];

const readActivityLogs = () => {
  if (!fs.existsSync(ACTIVITY_LOGS_FILE)) {
    fs.writeFileSync(ACTIVITY_LOGS_FILE, JSON.stringify(defaultActivityLogs, null, 2));
    return defaultActivityLogs;
  }
  try {
    return JSON.parse(fs.readFileSync(ACTIVITY_LOGS_FILE, 'utf8'));
  } catch (e) {
    return defaultActivityLogs;
  }
};

const writeActivityLogs = (logs) => safeWriteJSON(ACTIVITY_LOGS_FILE, logs);

function logActivity(aksi, keterangan, opts = {}) {
  try {
    const logs = readActivityLogs();
    const now = new Date();
    const entry = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      aksi: aksi || 'AKTIVITAS',
      kategori: opts.kategori || 'Sistem',
      keterangan: keterangan || '',
      admin: opts.admin || 'Admin Utama',
      waktu: formatWaktuIndo(now),
      timestamp: now.getTime(),
      target_id: opts.target_id || null,
      ip: opts.ip || '127.0.0.1',
    };
    logs.unshift(entry);
    if (logs.length > 500) logs.length = 500;
    writeActivityLogs(logs);
    return entry;
  } catch (err) {
    console.error('Error saat mencatat audit log:', err.message);
  }
}

// ---- EXPENSE TRACKER / PENGELUARAN KAS OPERASIONAL HELPER ----
const EXPENSES_FILE = path.join(__dirname, 'expenses.json');
const defaultExpenses = [
  {
    id: 1,
    tanggal: "2026-10-01",
    kategori: "Bandwidth & Upstream ISP",
    nominal: 750000,
    keterangan: "Biaya langganan dedicated upstream ISP 100 Mbps (Okt 2026)",
    petugas: "Admin Utama"
  },
  {
    id: 2,
    tanggal: "2026-10-03",
    kategori: "Pembelian Kabel FO & Dropcore",
    nominal: 420000,
    keterangan: "Beli kabel dropcore 1 roll 1000 meter & pigtail SC",
    petugas: "Rian (Teknisi Lapangan)"
  },
  {
    id: 3,
    tanggal: "2026-10-06",
    kategori: "Modem & Router ONT",
    nominal: 380000,
    keterangan: "Restock 2 unit ONT GPON ZTE F609 V3 cadangan",
    petugas: "Deni (Teknisi)"
  },
  {
    id: 4,
    tanggal: "2026-10-08",
    kategori: "Konsumsi & Transport Teknisi",
    nominal: 120000,
    keterangan: "BBM motor operasional teknisi keliling & konsumsi penarikan kabel",
    petugas: "Rian (Teknisi Lapangan)"
  },
  {
    id: 5,
    tanggal: "2026-10-10",
    kategori: "Operasional & Listrik",
    nominal: 150000,
    keterangan: "Token listrik server OLT & UPS gardu RT 02",
    petugas: "Admin Utama"
  }
];

const readExpenses = () => {
  if (!fs.existsSync(EXPENSES_FILE)) {
    fs.writeFileSync(EXPENSES_FILE, JSON.stringify(defaultExpenses, null, 2));
    return defaultExpenses;
  }
  try {
    return JSON.parse(fs.readFileSync(EXPENSES_FILE, 'utf8'));
  } catch (e) {
    return defaultExpenses;
  }
};

const writeExpenses = (data) => safeWriteJSON(EXPENSES_FILE, data);

function defaultDevice(c, idx = 0) {
  const models = [
    { tipe: 'ZTE F609 V3 (GPON ONT)', snPrefix: 'ZTEG' },
    { tipe: 'Huawei HG8245H5 (Dual Band GPON)', snPrefix: '48575443' },
    { tipe: 'Fiberhome AN5506-01-A (GPON ONU)', snPrefix: 'FHTT' },
    { tipe: 'VSOL V2801SG (1GE XPON ONT)', snPrefix: 'VSOL' },
  ];
  const numId = Number(c.id || (idx + 1) || 1);
  const model = models[(numId - 1) % models.length];
  const hex = (n) => (n % 256).toString(16).padStart(2, '0').toUpperCase();
  const sn = model.snPrefix + String(10000000 + numId * 12345).slice(0, 8);
  const mac = `BC:24:11:${hex(numId * 17)}:${hex(numId * 31)}:${hex(numId * 53)}`;
  const isSewa = (numId % 4 !== 0); // Mayoritas disewakan/aset RT/RW.net
  return {
    tipe: model.tipe,
    serial_number: sn,
    mac_address: mac,
    status_kepemilikan: isSewa ? 'Dipinjamkan / Sewa (Aset RT/RW.net)' : 'Milik Pribadi (Beli Putus)',
    tanggal_pasang: '2026-01-15',
    kondisi: 'Normal / Bagus',
    garansi_sampai: '2027-01-15',
    catatan_perangkat: isSewa
      ? 'Adaptor 12V 1A terpasang rapi di ruang tamu. Aset wajib ditarik saat penonaktifan sambungan.'
      : 'Modem ONT dibeli putus oleh pelanggan sendiri.',
  };
}

function ensureFieldsAndInvoices(data) {
  let changed = false;
  for (let idx = 0; idx < data.length; idx++) {
    const c = data[idx];
    if (!c.customer_id) {
      c.customer_id = 'PLG' + String(c.id || (idx + 1)).padStart(3, '0');
      changed = true;
    }
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
    // Periksa inventaris perangkat pelanggan (ONT/Modem)
    if (!c.device || typeof c.device !== 'object') {
      c.device = defaultDevice(c, idx);
      changed = true;
    } else {
      if (!c.device.tipe) { c.device.tipe = 'ZTE F609 V3 (GPON ONT)'; changed = true; }
      if (!c.device.serial_number) { c.device.serial_number = 'ZTEG' + String(10000000 + (c.id || 1) * 123).slice(0, 8); changed = true; }
      if (!c.device.mac_address) { c.device.mac_address = 'BC:24:11:00:AA:01'; changed = true; }
      if (!c.device.status_kepemilikan) { c.device.status_kepemilikan = 'Dipinjamkan / Sewa (Aset RT/RW.net)'; changed = true; }
      if (!c.device.kondisi) { c.device.kondisi = 'Normal / Bagus'; changed = true; }
      if (!c.device.tanggal_pasang) { c.device.tanggal_pasang = '2026-01-15'; changed = true; }
      if (c.device.garansi_sampai === undefined) { c.device.garansi_sampai = '2027-01-15'; changed = true; }
      if (c.device.catatan_perangkat === undefined) { c.device.catatan_perangkat = ''; changed = true; }
    }
    // Periksa konfigurasi akun MikroTik pelanggan (PPPoE / Hotspot / IP)
    const cleanUser = (c.nama || '').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (!c.mikrotikUsername) {
      c.mikrotikUsername = cleanUser || ('user_' + (c.id || (idx + 1)));
      changed = true;
    }
    if (!c.mikrotikProfile) {
      if ((c.paket || '').includes('30')) c.mikrotikProfile = '30Mbps';
      else if ((c.paket || '').includes('20')) c.mikrotikProfile = '20Mbps';
      else c.mikrotikProfile = '10Mbps';
      changed = true;
    }
    if (!c.ipAddress) {
      c.ipAddress = '192.168.88.' + (10 + (c.id || (idx + 1)));
      changed = true;
    }
    if (!c.mikrotikService) {
      c.mikrotikService = 'pppoe';
      changed = true;
    }
    if (!c.mikrotikStatus) {
      c.mikrotikStatus = (c.status_jaringan === 'Terisolir' || c.status_jaringan === 'Terisolir / Gangguan') ? 'isolated' : 'connected';
      changed = true;
    }
    if (c.mikrotikLastSync === undefined) {
      c.mikrotikLastSync = null;
      changed = true;
    }

    if (!Array.isArray(c.network_logs)) {
      c.network_logs = [];
      changed = true;
    } else {
      for (const log of c.network_logs) {
        if (!log.tiket_id) {
          log.tiket_id = 'TKT-' + String(log.id || Date.now()).slice(-6);
          changed = true;
        }
        if (!log.status_penanganan) {
          log.status_penanganan = log.status === 'UP' ? 'Selesai' : 'Pending';
          changed = true;
        }
        if (!log.jenis_kendala) {
          log.jenis_kendala = log.keterangan || (log.status === 'UP' ? 'Koneksi Normal Kembali' : 'Kendala Jaringan');
          changed = true;
        }
        if (!log.teknisi) {
          log.teknisi = log.status === 'UP' ? 'Tim Lapangan' : 'Menunggu Penugasan';
          changed = true;
        }
        if (log.catatan_perbaikan === undefined) {
          log.catatan_perbaikan = log.keterangan || '';
          changed = true;
        }
        if (!log.durasi) {
          log.durasi = log.status_penanganan === 'Selesai' ? 'Selesai' : 'Sedang Berlangsung';
          changed = true;
        }
      }
    }
  }
  return changed;
}

function parseCustomer(body = {}, existingId = null, allData = []) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  let custId = str(body.customer_id).toUpperCase();
  if (!custId) {
    const nextNum = (existingId || allData.reduce((m, x) => Math.max(m, x.id), 0) + 1);
    custId = 'PLG' + String(nextNum).padStart(3, '0');
  }

  const defaultUser = str(body.nama).toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const defaultProfile = str(body.paket).includes('30') ? '30Mbps' : str(body.paket).includes('20') ? '20Mbps' : '10Mbps';
  const defaultIP = '192.168.88.' + (10 + (existingId || allData.length + 1));

  const devBody = body.device || {};
  const c = {
    customer_id: custId,
    nama: str(body.nama),
    whatsapp: str(body.whatsapp).replace(/[\s\-+]/g, ''),
    alamat: str(body.alamat),
    wilayah: str(body.wilayah),
    paket: str(body.paket),
    harga: Number(body.harga),
    jatuh_tempo: str(body.jatuh_tempo),
    status_jaringan: STATUS_JARINGAN.includes(body.status_jaringan) ? body.status_jaringan : 'Aktif',
    catatan_kendala: str(body.catatan_kendala),
    mikrotikUsername: str(body.mikrotikUsername || body.mikrotik_username || defaultUser),
    mikrotikProfile: str(body.mikrotikProfile || body.mikrotik_profile || defaultProfile),
    ipAddress: str(body.ipAddress || body.ip_address || defaultIP),
    mikrotikService: str(body.mikrotikService || body.mikrotik_service || 'pppoe'),
    mikrotikStatus: body.mikrotikStatus || (body.status_jaringan === 'Terisolir' ? 'isolated' : 'connected'),
    mikrotikLastSync: body.mikrotikLastSync || null,
    device: {
      tipe: str(body.device_tipe || devBody.tipe || 'ZTE F609 V3 (GPON ONT)'),
      serial_number: str(body.device_sn || devBody.serial_number || ('ZTEG' + String(10000000 + (existingId || 1) * 12345).slice(0, 8))).toUpperCase(),
      mac_address: str(body.device_mac || devBody.mac_address || '').toUpperCase(),
      status_kepemilikan: str(body.device_kepemilikan || devBody.status_kepemilikan || 'Dipinjamkan / Sewa (Aset RT/RW.net)'),
      tanggal_pasang: str(body.device_tanggal_pasang || devBody.tanggal_pasang || today(new Date())),
      kondisi: str(body.device_kondisi || devBody.kondisi || 'Normal / Bagus'),
      garansi_sampai: str(body.device_garansi !== undefined ? body.device_garansi : (devBody.garansi_sampai || '')),
      catatan_perangkat: str(body.device_catatan !== undefined ? body.device_catatan : (devBody.catatan_perangkat || '')),
    }
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

// Compile template pesan pengingat WhatsApp
function compileMessage(template, c, settings) {
  if (!template) return '';
  const qrisInfo = (settings && settings.qris_info) || 'DANA Bisnis';
  const dev = c.device || {};

  let bankInfoText = '';
  try {
    const activeBanks = readBankAccounts().filter(b => b.is_active !== false);
    if (activeBanks.length > 0) {
      bankInfoText = activeBanks.map(b => `• ${b.nama_bank}: ${b.nomor_rekening} a/n ${b.atas_nama}${b.keterangan ? ' (' + b.keterangan + ')' : ''}`).join('\n');
    }
  } catch (e) {
    bankInfoText = 'BCA: 8830123456 a/n MOHAMMAD FAHER';
  }

  return template
    .replace(/{nama}/g, c.nama || '')
    .replace(/{whatsapp}/g, c.whatsapp || '')
    .replace(/{alamat}/g, c.alamat || '')
    .replace(/{wilayah}/g, c.wilayah || '')
    .replace(/{paket}/g, c.paket || '')
    .replace(/{total_tagihan}/g, rupiah(c.harga))
    .replace(/{jatuh_tempo}/g, tgl(c.jatuh_tempo))
    .replace(/{periode}/g, periodeLabel((c.jatuh_tempo || '').slice(0, 7)))
    .replace(/{status_tagihan}/g, c.status_tagihan || '')
    .replace(/{status_jaringan}/g, c.status_jaringan || 'Aktif')
    .replace(/{catatan_kendala}/g, c.catatan_kendala || '-')
    .replace(/{device_tipe}/g, dev.tipe || '-')
    .replace(/{device_sn}/g, dev.serial_number || '-')
    .replace(/{device_kepemilikan}/g, dev.status_kepemilikan || '-')
    .replace(/{qris_info}/g, qrisInfo)
    .replace(/{rekening_bank}/g, bankInfoText || '-')
    .replace(/{bank_info}/g, bankInfoText || '-');
}

// Menghitung selisih hari dari hari ini ke tanggal jatuh tempo
// Hasil: 3 = H-3, 0 = hari H, < 0 = lewat jatuh tempo / menunggak
function getDaysDiff(jatuhTempoStr, now = new Date()) {
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = jatuhTempoStr.split('-').map(Number);
  const dueOnly = new Date(y, m - 1, d);
  const diffTime = dueOnly - todayOnly;
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

// Filter pelanggan yang butuh pengingat (H-3 atau Overdue / Menunggak)
function getReminderList(customers, now = new Date()) {
  const settings = readSettings();
  const list = [];
  for (const c of customers) {
    if (c.status_tagihan !== 'Belum Lunas') continue;
    const diff = getDaysDiff(c.jatuh_tempo, now);
    let kategori = null;
    let templateKey = null;

    if (diff === 3) {
      kategori = 'H-3 Jatuh Tempo';
      templateKey = 'h3';
    } else if (diff === 0) {
      kategori = 'Jatuh Tempo Hari Ini';
      templateKey = 'due';
    } else if (diff < 0) {
      kategori = `Menunggak (${Math.abs(diff)} hari)`;
      templateKey = 'overdue';
    }

    if (kategori) {
      const template = (settings.templates && settings.templates[templateKey]) || settings.templates.general;
      const message = compileMessage(template, c, settings);
      const waUrl = `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(message)}`;
      list.push({
        customer: c,
        diff_days: diff,
        kategori,
        template_key: templateKey,
        pesan: message,
        wa_url: waUrl
      });
    }
  }
  return list;
}

// Kirim pesan WhatsApp melalui Gateway pihak ketiga (Fonnte/Wablas)
async function dispatchWaMessage(phone, message, settings) {
  const targetPhone = String(phone).replace(/[\s\-+]/g, '');
  if (!settings.api_token) throw new Error(`Token API untuk ${settings.wa_provider} belum diisi`);

  if (settings.wa_provider === 'fonnte') {
    const res = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: { 'Authorization': settings.api_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: targetPhone, message: message })
    });
    const data = await res.json();
    if (!res.ok || data.status === false) throw new Error(data.reason || 'Gagal mengirim via Fonnte');
    return data;
  } else if (settings.wa_provider === 'wablas') {
    const res = await fetch('https://api.wablas.com/api/send-message', {
      method: 'POST',
      headers: { 'Authorization': settings.api_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: targetPhone, message: message })
    });
    const data = await res.json();
    if (!res.ok || data.status === false) throw new Error(data.message || 'Gagal mengirim via Wablas');
    return data;
  }
  throw new Error('Provider manual tidak mendukung pengiriman background otomatis');
}

// =========================================================================
// API MANAJEMEN PAKET INTERNET (PACKAGES)
// =========================================================================

// 1. GET /api/packages - Ambil semua paket beserta jumlah pelanggan aktif
app.get('/api/packages', (req, res) => {
  const packages = readPackages();
  const customers = readDB();
  const result = packages.map(pkg => {
    const activeCount = customers.filter(c => c.paket === pkg.nama).length;
    return {
      ...pkg,
      active_subscribers: activeCount
    };
  });
  res.json(result);
});

// 2. POST /api/packages - Tambah paket internet baru
app.post('/api/packages', (req, res) => {
  const { nama, kecepatan, harga, mikrotik_profile, deskripsi } = req.body || {};
  if (!nama || !nama.trim()) return res.status(400).json({ error: 'Nama paket wajib diisi' });
  if (!kecepatan || !kecepatan.trim()) return res.status(400).json({ error: 'Kecepatan bandwidth wajib diisi' });
  const hargaNum = Number(harga);
  if (isNaN(hargaNum) || hargaNum <= 0) return res.status(400).json({ error: 'Harga bulanan harus angka lebih besar dari 0' });

  const packages = readPackages();
  if (packages.some(p => p.nama.toLowerCase() === nama.trim().toLowerCase())) {
    return res.status(400).json({ error: `Paket dengan nama "${nama.trim()}" sudah ada` });
  }

  let nextNum = 1;
  packages.forEach(p => {
    const m = String(p.id).match(/PKG-(\d+)/i);
    if (m) nextNum = Math.max(nextNum, parseInt(m[1], 10) + 1);
  });
  const id = `PKG-${String(nextNum).padStart(2, '0')}`;

  const newPkg = {
    id,
    nama: nama.trim(),
    kecepatan: kecepatan.trim(),
    harga: hargaNum,
    mikrotik_profile: (mikrotik_profile || kecepatan.trim().replace(/\s+/g, '')).trim(),
    deskripsi: (deskripsi || '').trim()
  };

  packages.push(newPkg);
  writePackages(packages);

  logActivity('TAMBAH_PAKET', `Menambahkan paket internet baru: ${newPkg.nama} (${newPkg.kecepatan} - ${rupiah(newPkg.harga)})`, {
    kategori: 'Sistem',
    target_id: newPkg.id
  });

  res.status(201).json(newPkg);
});

// 3. PUT /api/packages/:id - Ubah paket internet yang sudah ada
app.put('/api/packages/:id', (req, res) => {
  const { nama, kecepatan, harga, mikrotik_profile, deskripsi, update_existing_customers } = req.body || {};
  const packages = readPackages();
  const pkg = packages.find(p => p.id === req.params.id);
  if (!pkg) return res.status(404).json({ error: 'Paket internet tidak ditemukan' });

  if (!nama || !nama.trim()) return res.status(400).json({ error: 'Nama paket wajib diisi' });
  if (!kecepatan || !kecepatan.trim()) return res.status(400).json({ error: 'Kecepatan bandwidth wajib diisi' });
  const hargaNum = Number(harga);
  if (isNaN(hargaNum) || hargaNum <= 0) return res.status(400).json({ error: 'Harga bulanan harus angka lebih besar dari 0' });

  if (packages.some(p => p.id !== pkg.id && p.nama.toLowerCase() === nama.trim().toLowerCase())) {
    return res.status(400).json({ error: `Paket dengan nama "${nama.trim()}" sudah digunakan` });
  }

  const oldName = pkg.nama;
  pkg.nama = nama.trim();
  pkg.kecepatan = kecepatan.trim();
  pkg.harga = hargaNum;
  pkg.mikrotik_profile = (mikrotik_profile || kecepatan.trim().replace(/\s+/g, '')).trim();
  pkg.deskripsi = (deskripsi || '').trim();

  writePackages(packages);

  // Jika nama paket diubah, perbarui otomatis nama paket pada pelanggan aktif jika opsi aktif (default true)
  if (oldName !== pkg.nama && update_existing_customers !== false) {
    const customers = readDB();
    let updatedCust = 0;
    customers.forEach(c => {
      if (c.paket === oldName) {
        c.paket = pkg.nama;
        updatedCust++;
      }
    });
    if (updatedCust > 0) writeDB(customers);
  }

  logActivity('UBAH_PAKET', `Memperbarui paket internet: ${pkg.nama} (${pkg.kecepatan} - ${rupiah(pkg.harga)})`, {
    kategori: 'Sistem',
    target_id: pkg.id
  });

  res.json(pkg);
});

// 4. DELETE /api/packages/:id - Hapus paket internet
app.delete('/api/packages/:id', (req, res) => {
  const packages = readPackages();
  const idx = packages.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Paket internet tidak ditemukan' });

  const pkg = packages[idx];
  const customers = readDB();
  const inUseCount = customers.filter(c => c.paket === pkg.nama).length;

  if (inUseCount > 0 && req.query.force !== 'true') {
    return res.status(400).json({
      error: `Paket "${pkg.nama}" masih digunakan oleh ${inUseCount} pelanggan aktif. Ubah paket pelanggan tersebut terlebih dahulu atau gunakan konfirmasi hapus paksa.`,
      in_use_count: inUseCount
    });
  }

  packages.splice(idx, 1);
  writePackages(packages);

  logActivity('HAPUS_PAKET', `Menghapus paket internet: ${pkg.nama} (${pkg.id})`, {
    kategori: 'Sistem',
    target_id: pkg.id
  });

  res.json({ success: true, message: `Paket "${pkg.nama}" berhasil dihapus`, id: pkg.id });
});

// =========================================================================
// API MANAJEMEN REKENING BANK MANUAL (BANK ACCOUNTS)
// =========================================================================

// 1. GET /api/bank-accounts - Ambil semua rekening bank
app.get('/api/bank-accounts', (req, res) => {
  const accounts = readBankAccounts();
  if (req.query.active_only === 'true') {
    return res.json(accounts.filter(b => b.is_active !== false));
  }
  res.json(accounts);
});

// 2. POST /api/bank-accounts - Tambah rekening bank baru
app.post('/api/bank-accounts', (req, res) => {
  const { nama_bank, nomor_rekening, atas_nama, keterangan, is_active } = req.body || {};
  if (!nama_bank || !nama_bank.trim()) return res.status(400).json({ error: 'Nama Bank wajib diisi (contoh: BCA, Mandiri, BRI)' });
  if (!nomor_rekening || !nomor_rekening.trim()) return res.status(400).json({ error: 'Nomor Rekening wajib diisi' });
  if (!atas_nama || !atas_nama.trim()) return res.status(400).json({ error: 'Atas Nama pemilik rekening wajib diisi' });

  const accounts = readBankAccounts();
  const cleanNo = nomor_rekening.trim().replace(/\s+/g, '');
  if (accounts.some(b => b.nomor_rekening.replace(/\s+/g, '') === cleanNo && b.nama_bank.toLowerCase() === nama_bank.trim().toLowerCase())) {
    return res.status(400).json({ error: `Nomor rekening ${cleanNo} pada Bank ${nama_bank.trim()} sudah terdaftar` });
  }

  let nextNum = 1;
  accounts.forEach(b => {
    const m = String(b.id).match(/BANK-(\d+)/i);
    if (m) nextNum = Math.max(nextNum, parseInt(m[1], 10) + 1);
  });
  const id = `BANK-${String(nextNum).padStart(2, '0')}`;

  const newAcc = {
    id,
    nama_bank: nama_bank.trim(),
    nomor_rekening: cleanNo,
    atas_nama: atas_nama.trim().toUpperCase(),
    keterangan: (keterangan || '').trim(),
    is_active: is_active !== false
  };

  accounts.push(newAcc);
  writeBankAccounts(accounts);

  logActivity('TAMBAH_REKENING', `Menambahkan rekening bank baru: ${newAcc.nama_bank} - ${newAcc.nomor_rekening} a/n ${newAcc.atas_nama}`, {
    kategori: 'Keuangan',
    target_id: newAcc.id
  });

  res.status(201).json(newAcc);
});

// 3. PUT /api/bank-accounts/:id - Ubah informasi rekening bank
app.put('/api/bank-accounts/:id', (req, res) => {
  const { nama_bank, nomor_rekening, atas_nama, keterangan, is_active } = req.body || {};
  const accounts = readBankAccounts();
  const acc = accounts.find(b => b.id === req.params.id);
  if (!acc) return res.status(404).json({ error: 'Rekening bank tidak ditemukan' });

  if (!nama_bank || !nama_bank.trim()) return res.status(400).json({ error: 'Nama Bank wajib diisi' });
  if (!nomor_rekening || !nomor_rekening.trim()) return res.status(400).json({ error: 'Nomor Rekening wajib diisi' });
  if (!atas_nama || !atas_nama.trim()) return res.status(400).json({ error: 'Atas Nama pemilik rekening wajib diisi' });

  const cleanNo = nomor_rekening.trim().replace(/\s+/g, '');
  if (accounts.some(b => b.id !== acc.id && b.nomor_rekening.replace(/\s+/g, '') === cleanNo && b.nama_bank.toLowerCase() === nama_bank.trim().toLowerCase())) {
    return res.status(400).json({ error: `Nomor rekening ${cleanNo} pada Bank ${nama_bank.trim()} sudah digunakan rekening lain` });
  }

  acc.nama_bank = nama_bank.trim();
  acc.nomor_rekening = cleanNo;
  acc.atas_nama = atas_nama.trim().toUpperCase();
  acc.keterangan = (keterangan || '').trim();
  if (is_active !== undefined) acc.is_active = Boolean(is_active);

  writeBankAccounts(accounts);

  logActivity('UBAH_REKENING', `Memperbarui rekening bank: ${acc.nama_bank} - ${acc.nomor_rekening} a/n ${acc.atas_nama} (Status: ${acc.is_active ? 'Aktif' : 'Nonaktif'})`, {
    kategori: 'Keuangan',
    target_id: acc.id
  });

  res.json(acc);
});

// 4. DELETE /api/bank-accounts/:id - Hapus rekening bank
app.delete('/api/bank-accounts/:id', (req, res) => {
  const accounts = readBankAccounts();
  const idx = accounts.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Rekening bank tidak ditemukan' });

  const removed = accounts.splice(idx, 1)[0];
  writeBankAccounts(accounts);

  logActivity('HAPUS_REKENING', `Menghapus rekening bank: ${removed.nama_bank} - ${removed.nomor_rekening} a/n ${removed.atas_nama} (${removed.id})`, {
    kategori: 'Keuangan',
    target_id: removed.id
  });

  res.json({ success: true, message: `Rekening ${removed.nama_bank} (${removed.nomor_rekening}) berhasil dihapus`, id: removed.id });
});

// =========================================================================
// API MANAJEMEN STOK & INVENTARIS MATERIAL (INVENTORY STOCK)
// =========================================================================

// 1. GET /api/inventory-stock - Ambil daftar stok material & metrik ringkasan
app.get('/api/inventory-stock', (req, res) => {
  const stock = readInventoryStock();
  const kategori = typeof req.query.kategori === 'string' ? req.query.kategori.trim() : '';

  let filtered = stock;
  if (kategori && kategori !== 'all') {
    filtered = stock.filter(s => s.kategori.toLowerCase() === kategori.toLowerCase());
  }

  const totalItems = stock.length;
  const totalValuation = stock.reduce((sum, s) => sum + ((Number(s.jumlah_stok) || 0) * (Number(s.harga_satuan) || 0)), 0);
  const lowStockItems = stock.filter(s => (Number(s.jumlah_stok) || 0) <= (Number(s.min_stok) || 5));

  const itemsWithFlag = filtered.map(s => ({
    ...s,
    is_low_stock: (Number(s.jumlah_stok) || 0) <= (Number(s.min_stok) || 5)
  }));

  res.json({
    success: true,
    summary: {
      total_items: totalItems,
      total_valuation: totalValuation,
      low_stock_count: lowStockItems.length,
    },
    total_items: totalItems,
    total_valuation: totalValuation,
    low_stock_count: lowStockItems.length,
    data: itemsWithFlag,
    items: itemsWithFlag
  });
});

// 2. POST /api/inventory-stock - Tambah material baru ke inventaris
app.post('/api/inventory-stock', (req, res) => {
  const { nama_barang, kategori, jumlah_stok, satuan, harga_satuan, keterangan, min_stok } = req.body || {};
  if (!nama_barang || !nama_barang.trim()) return res.status(400).json({ error: 'Nama Barang/Material wajib diisi' });
  if (!kategori || !kategori.trim()) return res.status(400).json({ error: 'Kategori material wajib diisi' });

  const stock = readInventoryStock();
  if (stock.some(s => s.nama_barang.toLowerCase() === nama_barang.trim().toLowerCase())) {
    return res.status(400).json({ error: `Material "${nama_barang.trim()}" sudah ada di dalam stok` });
  }

  let nextNum = 1;
  stock.forEach(s => {
    const m = String(s.id).match(/STK-(\d+)/i);
    if (m) nextNum = Math.max(nextNum, parseInt(m[1], 10) + 1);
  });
  const id = `STK-${String(nextNum).padStart(2, '0')}`;

  const newItem = {
    id,
    nama_barang: nama_barang.trim(),
    kategori: kategori.trim(),
    jumlah_stok: Math.max(0, Number(jumlah_stok) || 0),
    satuan: (satuan || 'Pcs').trim(),
    harga_satuan: Math.max(0, Number(harga_satuan) || 0),
    keterangan: (keterangan || '').trim(),
    min_stok: Math.max(1, Number(min_stok) || 5)
  };

  stock.push(newItem);
  writeInventoryStock(stock);

  logActivity('TAMBAH_STOK', `Menambahkan material baru ke inventaris: ${newItem.nama_barang} (${newItem.jumlah_stok} ${newItem.satuan})`, {
    kategori: 'Inventaris',
    target_id: newItem.id
  });

  res.status(201).json({ success: true, item: newItem, ...newItem });
});

// 3. PUT /api/inventory-stock/:id - Edit informasi material / update stok
app.put('/api/inventory-stock/:id', (req, res) => {
  const { nama_barang, kategori, jumlah_stok, satuan, harga_satuan, keterangan, min_stok } = req.body || {};
  const stock = readInventoryStock();
  const item = stock.find(s => s.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Material tidak ditemukan' });

  if (!nama_barang || !nama_barang.trim()) return res.status(400).json({ error: 'Nama Barang/Material wajib diisi' });
  if (!kategori || !kategori.trim()) return res.status(400).json({ error: 'Kategori material wajib diisi' });

  if (stock.some(s => s.id !== item.id && s.nama_barang.toLowerCase() === nama_barang.trim().toLowerCase())) {
    return res.status(400).json({ error: `Nama material "${nama_barang.trim()}" sudah digunakan material lain` });
  }

  const prevStock = item.jumlah_stok;
  item.nama_barang = nama_barang.trim();
  item.kategori = kategori.trim();
  item.jumlah_stok = Math.max(0, Number(jumlah_stok) !== undefined ? Number(jumlah_stok) : item.jumlah_stok);
  item.satuan = (satuan || item.satuan || 'Pcs').trim();
  item.harga_satuan = Math.max(0, Number(harga_satuan) || 0);
  item.keterangan = (keterangan || '').trim();
  if (min_stok !== undefined) item.min_stok = Math.max(1, Number(min_stok) || 5);

  writeInventoryStock(stock);

  logActivity('UPDATE_STOK', `Memperbarui material: ${item.nama_barang} (Stok: ${prevStock} -> ${item.jumlah_stok} ${item.satuan})`, {
    kategori: 'Inventaris',
    target_id: item.id
  });

  res.json({ success: true, item, ...item });
});

// 4. POST /api/inventory-stock/:id/adjust - Cepat tambah / kurang stok
app.post('/api/inventory-stock/:id/adjust', (req, res) => {
  const { action = 'tambah', amount = 1, catatan = '', teknisi = 'Admin' } = req.body || {};
  const stock = readInventoryStock();
  const item = stock.find(s => s.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Material tidak ditemukan' });

  const numAmount = Math.max(1, Number(amount) || 1);
  const prevStock = item.jumlah_stok;

  if (action === 'kurang') {
    item.jumlah_stok = Math.max(0, item.jumlah_stok - numAmount);
  } else if (action === 'set') {
    item.jumlah_stok = Math.max(0, Number(amount) || 0);
  } else {
    item.jumlah_stok += numAmount;
  }

  writeInventoryStock(stock);

  logActivity('ADJUST_STOK', `Penyesuaian stok ${item.nama_barang}: ${action} ${numAmount} ${item.satuan} (${prevStock} -> ${item.jumlah_stok}). Catatan: ${catatan || 'Penyesuaian ' + teknisi}`, {
    kategori: 'Inventaris',
    target_id: item.id
  });

  res.json({
    success: true,
    item,
    prev_stock: prevStock,
    current_stock: item.jumlah_stok,
    action,
    amount: numAmount
  });
});

// 5. DELETE /api/inventory-stock/:id - Hapus barang dari stok
app.delete('/api/inventory-stock/:id', (req, res) => {
  const stock = readInventoryStock();
  const idx = stock.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Material tidak ditemukan' });

  const removed = stock.splice(idx, 1)[0];
  writeInventoryStock(stock);

  logActivity('HAPUS_STOK', `Menghapus material dari stok: ${removed.nama_barang} (${removed.id})`, {
    kategori: 'Inventaris',
    target_id: removed.id
  });

  res.json({ success: true, message: `Material "${removed.nama_barang}" berhasil dihapus`, id: removed.id });
});

// ---- API Customers ----
app.get('/api/customers', (req, res) => {
  const data = readDB();
  if (ensureFieldsAndInvoices(data)) writeDB(data);
  res.json(data);
});

app.post('/api/customers', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const nextId = data.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const { value, error } = parseCustomer(req.body, nextId, data);
  if (error) return res.status(400).json({ error });
  const c = {
    id: nextId,
    ...value,
    status_tagihan: 'Belum Lunas',
    network_logs: [],
  };
  c.invoices = [makeInvoice(c)];
  data.push(c);
  writeDB(data);

  logActivity('TAMBAH_PELANGGAN', `Menambahkan pelanggan baru: ${c.nama} (${c.customer_id}) - Paket: ${c.paket} (${rupiah(c.harga)})`, {
    kategori: 'Pelanggan',
    target_id: c.customer_id
  });

  // Pengurangan otomatis stok inventaris material & modem saat pelanggan baru dipasang
  if (c.device && c.device.tipe) {
    deductInventoryStock(c.device.tipe, 1, `Pemasangan baru pelanggan ${c.nama} (${c.customer_id})`);
  }
  if (req.body.kabel_meter && Number(req.body.kabel_meter) > 0) {
    deductInventoryStock('Kabel Drop Core', Number(req.body.kabel_meter), `Penarikan kabel ${req.body.kabel_meter}m pelanggan ${c.nama} (${c.customer_id})`);
  }
  if (req.body.fast_connector && Number(req.body.fast_connector) > 0) {
    deductInventoryStock('Fast Connector', Number(req.body.fast_connector), `Terminasi konektor pelanggan ${c.nama} (${c.customer_id})`);
  }

  res.status(201).json(c);
});

app.put('/api/customers/:id', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const c = data.find((x) => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  const oldSN = (c.device && c.device.serial_number) || '';
  const oldTipe = (c.device && c.device.tipe) || '';

  const { value, error } = parseCustomer(req.body, c.id, data);
  if (error) return res.status(400).json({ error });

  const inv = currentInvoice(c);
  Object.assign(c, value);
  if (inv && inv.status !== 'Lunas') {
    inv.nominal = c.harga;
    inv.periode = c.jatuh_tempo.slice(0, 7);
  } else if (!currentInvoice(c)) {
    c.invoices.push(makeInvoice(c, c.status_tagihan));
  }
  writeDB(data);

  logActivity('EDIT_PELANGGAN', `Memperbarui data profil pelanggan: ${c.nama} (${c.customer_id}) - Paket: ${c.paket}`, {
    kategori: 'Pelanggan',
    target_id: c.customer_id
  });

  // Pengurangan otomatis jika ada penggantian modem/ONT baru
  const newSN = (c.device && c.device.serial_number) || '';
  const newTipe = (c.device && c.device.tipe) || '';
  if (newTipe && ((newSN && newSN !== oldSN) || newTipe !== oldTipe)) {
    deductInventoryStock(newTipe, 1, `Penggantian/update modem ${c.nama} (${c.customer_id}): SN ${newSN || '-'}`);
  }

  res.json(c);
});

app.delete('/api/customers/:id', (req, res) => {
  const data = readDB();
  const id = Number(req.params.id);
  const idx = data.findIndex((x) => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  const removed = data.splice(idx, 1)[0];
  writeDB(data);

  logActivity('HAPUS_PELANGGAN', `Menghapus data pelanggan: ${removed.nama} (${removed.customer_id || ('ID ' + removed.id)}) - Alamat: ${removed.alamat}`, {
    kategori: 'Pelanggan',
    target_id: removed.customer_id || String(removed.id)
  });

  res.json({ success: true, removed });
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

    // Buka isolir otomatis jika sebelumnya terisolir karena menunggak
    if (c.status_jaringan === 'Terisolir') {
      c.status_jaringan = 'Aktif';
      c.catatan_kendala = '';
      if (!Array.isArray(c.network_logs)) c.network_logs = [];
      c.network_logs.unshift({
        id: Date.now(),
        status: 'UP',
        waktu: formatWaktuIndo(),
        keterangan: 'Buka isolir otomatis: Tagihan telah dilunasi',
      });
    }
  } else {
    inv.tanggal_bayar = null;
  }

  writeDB(data);

  if (c.status_tagihan === 'Lunas') {
    logActivity('STATUS_LUNAS', `Pelunasan tagihan: ${c.nama} (${c.customer_id}) periode ${inv.periode} senilai ${rupiah(inv.nominal)} ditandai LUNAS (Tgl Bayar: ${tgl(inv.tanggal_bayar)})`, {
      kategori: 'Billing',
      target_id: c.customer_id
    });
  } else {
    logActivity('BATAL_LUNAS', `Pembatalan pelunasan: Tagihan ${c.nama} (${c.customer_id}) periode ${inv.periode} diubah kembali menjadi Belum Lunas`, {
      kategori: 'Billing',
      target_id: c.customer_id
    });
  }

  res.json(c);
});

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

  logActivity(c.status_jaringan === 'Aktif' ? 'BUKA_ISOLIR' : 'ISOLIR_PELANGGAN', `Perubahan status jaringan ${c.nama} (${c.customer_id}) menjadi "${c.status_jaringan}"${c.catatan_kendala ? ` (${c.catatan_kendala})` : ''}`, {
    kategori: 'Jaringan',
    target_id: c.customer_id
  });

  res.json(c);
});

// ---- API Manajemen Inventaris & Mutasi Perangkat Pelanggan (ONT/Modem) ----
app.patch('/api/customers/:id/device', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const c = data.find((x) => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  const body = req.body || {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  const oldDevice = { ...(c.device || {}) };
  c.device = {
    tipe: str(body.tipe || oldDevice.tipe || 'ZTE F609 V3 (GPON ONT)'),
    serial_number: str(body.serial_number || oldDevice.serial_number || ('ZTEG' + String(10000000 + c.id * 12345).slice(0, 8))).toUpperCase(),
    mac_address: str(body.mac_address || oldDevice.mac_address || '').toUpperCase(),
    status_kepemilikan: str(body.status_kepemilikan || oldDevice.status_kepemilikan || 'Dipinjamkan / Sewa (Aset RT/RW.net)'),
    tanggal_pasang: str(body.tanggal_pasang || oldDevice.tanggal_pasang || today(new Date())),
    kondisi: str(body.kondisi || oldDevice.kondisi || 'Normal / Bagus'),
    garansi_sampai: str(body.garansi_sampai !== undefined ? body.garansi_sampai : (oldDevice.garansi_sampai || '')),
    catatan_perangkat: str(body.catatan_perangkat !== undefined ? body.catatan_perangkat : (oldDevice.catatan_perangkat || '')),
  };

  // Catat riwayat pergantian/mutasi ke network_logs jika diaktifkan atau jika SN berubah
  if (body.log_mutasi || (oldDevice.serial_number && oldDevice.serial_number !== c.device.serial_number)) {
    if (!Array.isArray(c.network_logs)) c.network_logs = [];
    const logId = Date.now() + Math.floor(Math.random() * 1000);
    const teknisi = str(body.teknisi || 'Teknisi Lapangan');
    const keterangan = str(body.keterangan_mutasi || `Mutasi Perangkat: Ganti ke ${c.device.tipe} (SN: ${c.device.serial_number}) - Status: ${c.device.status_kepemilikan}`);
    
    c.network_logs.unshift({
      id: logId,
      tiket_id: 'MUT-' + String(logId).slice(-6),
      status: 'UP',
      jenis_kendala: 'Mutasi / Pergantian Perangkat (ONT)',
      teknisi: teknisi,
      status_penanganan: 'Selesai',
      waktu: formatWaktuIndo(new Date()),
      waktu_selesai: formatWaktuIndo(new Date()),
      durasi: 'Selesai',
      created_at: logId,
      resolved_at: logId,
      catatan_perbaikan: keterangan,
      keterangan: keterangan
    });
  }

  writeDB(data);

  // Pengurangan otomatis stok saat mutasi perangkat baru
  if (oldDevice.serial_number && oldDevice.serial_number !== c.device.serial_number && c.device.tipe) {
    deductInventoryStock(c.device.tipe, 1, `Mutasi ONT pelanggan ${c.nama} (${c.customer_id}): SN Baru ${c.device.serial_number}`);
  }

  logActivity('MUTASI_PERANGKAT', `Mutasi/update perangkat ONT ${c.nama} (${c.customer_id}): ${c.device.tipe} (SN: ${c.device.serial_number}) - ${c.device.status_kepemilikan}`, {
    kategori: 'Inventaris',
    target_id: c.customer_id
  });

  res.json({ success: true, customer: c, device: c.device });
});

// ---- API Manajemen Tiket & Log Gangguan Teknisi ----
app.post('/api/customers/:id/network-logs', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const c = data.find((x) => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  const {
    jenis_kendala,
    teknisi,
    status_penanganan,
    catatan_perbaikan,
    status,
    waktu,
    waktu_selesai,
    durasi,
    keterangan
  } = req.body || {};

  const handleStatus = STATUS_PENANGANAN.includes(status_penanganan) ? status_penanganan : 'Pending';
  const connStatus = status === 'UP' || handleStatus === 'Selesai' ? (status || 'UP') : 'DOWN';

  const nowMs = Date.now();
  const createdTimeStr = typeof waktu === 'string' && waktu.trim() ? waktu.trim() : formatWaktuIndo(new Date(nowMs));
  const finalJenis = typeof jenis_kendala === 'string' && jenis_kendala.trim() ? jenis_kendala.trim() : (keterangan || 'Kendala Jaringan');
  const finalTeknisi = typeof teknisi === 'string' && teknisi.trim() ? teknisi.trim() : 'Belum Ditugaskan';
  const finalCatatan = typeof catatan_perbaikan === 'string' ? catatan_perbaikan.trim() : (keterangan || '');

  let resolvedMs = null;
  let resolvedTimeStr = null;
  let finalDurasi = 'Sedang Berlangsung';

  if (handleStatus === 'Selesai') {
    resolvedMs = nowMs;
    resolvedTimeStr = typeof waktu_selesai === 'string' && waktu_selesai.trim() ? waktu_selesai.trim() : formatWaktuIndo(new Date(resolvedMs));
    finalDurasi = typeof durasi === 'string' && durasi.trim() ? durasi.trim() : formatDurasi(nowMs, resolvedMs);
  }

  const logEntry = {
    id: nowMs,
    tiket_id: 'TKT-' + String(nowMs).slice(-6),
    status: connStatus,
    jenis_kendala: finalJenis,
    teknisi: finalTeknisi,
    status_penanganan: handleStatus,
    catatan_perbaikan: finalCatatan,
    waktu: createdTimeStr,
    waktu_selesai: resolvedTimeStr,
    durasi: finalDurasi,
    created_at: nowMs,
    resolved_at: resolvedMs,
    keterangan: finalCatatan || finalJenis,
  };

  if (!Array.isArray(c.network_logs)) c.network_logs = [];
  c.network_logs.unshift(logEntry);

  if (handleStatus === 'Selesai' || connStatus === 'UP') {
    const hasPendingDown = c.network_logs.some(l => l.id !== logEntry.id && l.status_penanganan !== 'Selesai' && l.status === 'DOWN');
    if (!hasPendingDown && c.status_jaringan !== 'Terisolir') {
      c.status_jaringan = 'Aktif';
      c.catatan_kendala = '';
    }
  } else {
    c.status_jaringan = 'Terisolir / Gangguan';
    c.catatan_kendala = `${finalJenis} (Teknisi: ${finalTeknisi})`;
  }

  writeDB(data);

  logActivity('BUAT_TIKET_GANGGUAN', `Membuka tiket #${logEntry.tiket_id} untuk ${c.nama} (${c.customer_id}): ${logEntry.jenis_kendala} (Teknisi: ${logEntry.teknisi})`, {
    kategori: 'Jaringan',
    target_id: c.customer_id
  });

  res.status(201).json({ customer: c, log: logEntry });
});

app.put('/api/customers/:id/network-logs/:logId', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const c = data.find((x) => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  const logId = Number(req.params.logId);
  const ticket = (c.network_logs || []).find((l) => l.id === logId);
  if (!ticket) return res.status(404).json({ error: 'Tiket gangguan tidak ditemukan' });

  const body = req.body || {};
  if (body.jenis_kendala) ticket.jenis_kendala = body.jenis_kendala.trim();
  if (body.teknisi !== undefined) ticket.teknisi = String(body.teknisi).trim() || 'Belum Ditugaskan';
  if (body.status_penanganan && STATUS_PENANGANAN.includes(body.status_penanganan)) {
    ticket.status_penanganan = body.status_penanganan;
  }
  if (body.catatan_perbaikan !== undefined) ticket.catatan_perbaikan = String(body.catatan_perbaikan).trim();
  if (body.waktu) ticket.waktu = String(body.waktu).trim();

  if (ticket.status_penanganan === 'Selesai') {
    ticket.status = 'UP';
    ticket.resolved_at = body.resolved_at || Date.now();
    ticket.waktu_selesai = body.waktu_selesai || formatWaktuIndo(new Date(ticket.resolved_at));
    const startMs = ticket.created_at || ticket.id || Date.now();
    ticket.durasi = body.durasi || formatDurasi(startMs, ticket.resolved_at);

    // Cek apakah semua gangguan sudah selesai
    const hasPendingDown = (c.network_logs || []).some(l => l.id !== logId && l.status_penanganan !== 'Selesai' && l.status === 'DOWN');
    if (!hasPendingDown && c.status_jaringan !== 'Terisolir') {
      c.status_jaringan = 'Aktif';
      c.catatan_kendala = '';
    }
  } else {
    ticket.status = body.status || 'DOWN';
    ticket.resolved_at = null;
    ticket.waktu_selesai = null;
    ticket.durasi = 'Sedang Berlangsung';
    if (ticket.status === 'DOWN') {
      c.status_jaringan = 'Terisolir / Gangguan';
      c.catatan_kendala = `${ticket.jenis_kendala} (Teknisi: ${ticket.teknisi})`;
    }
  }

  ticket.keterangan = ticket.catatan_perbaikan || ticket.jenis_kendala;

  writeDB(data);

  logActivity('UPDATE_TIKET_GANGGUAN', `Memperbarui tiket #${ticket.tiket_id} untuk ${c.nama} (${c.customer_id}): Status ${ticket.status_penanganan} (${ticket.status}) - Teknisi: ${ticket.teknisi}`, {
    kategori: 'Jaringan',
    target_id: c.customer_id
  });

  res.json({ customer: c, log: ticket });
});

app.delete('/api/customers/:id/network-logs/:logId', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const c = data.find((x) => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  const logId = Number(req.params.logId);
  c.network_logs = (c.network_logs || []).filter((l) => l.id !== logId);

  // Jika tidak ada tiket pending/down yang tersisa dan tidak terisolir tagihan
  const hasPendingDown = (c.network_logs || []).some(l => l.status_penanganan !== 'Selesai' && l.status === 'DOWN');
  if (!hasPendingDown && c.status_jaringan === 'Terisolir / Gangguan') {
    c.status_jaringan = 'Aktif';
    c.catatan_kendala = '';
  }

  writeDB(data);

  logActivity('HAPUS_TIKET_GANGGUAN', `Menghapus entri tiket gangguan ID #${logId} pada pelanggan ${c.nama} (${c.customer_id})`, {
    kategori: 'Jaringan',
    target_id: c.customer_id
  });

  res.json(c);
});

app.post('/api/generate-tagihan', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const n = generateBills(data);
  if (n > 0) {
    writeDB(data);
    logActivity('GENERATE_TAGIHAN', `Menerbitkan ${n} tagihan baru periode berjalan`, {
      kategori: 'Billing'
    });
  }
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

// ---- Endpoint Eksekusi Isolir Otomatis Pelanggan Menunggak ----
app.post('/api/customers/auto-isolir', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const graceDays = req.body && Number.isFinite(Number(req.body.grace_days)) ? Number(req.body.grace_days) : 7;
  const count = checkAutoIsolir(data, graceDays);
  if (count > 0) {
    writeDB(data);
    logActivity('AUTO_ISOLIR', `Eksekusi isolir otomatis: ${count} pelanggan menunggak diubah statusnya menjadi Terisolir (toleransi ${graceDays} hari)`, {
      kategori: 'Jaringan'
    });
  }
  res.json({
    success: true,
    isolated_count: count,
    grace_days: graceDays,
    customers: data,
    message: count > 0 
      ? `${count} sambungan pelanggan yang menunggak lebih dari ${graceDays} hari berhasil diubah statusnya menjadi Terisolir.` 
      : `Tidak ada pelanggan yang menunggak melebihi batas toleransi ${graceDays} hari.`
  });
});

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
    qris_info: typeof body.qris_info === 'string' ? body.qris_info.trim() : cur.qris_info,
    templates: {
      ...cur.templates,
      ...(body.templates || {})
    }
  };
  writeSettings(updated);

  logActivity('UPDATE_PENGATURAN', `Memperbarui konfigurasi sistem & gateway WhatsApp (${updated.wa_provider})`, {
    kategori: 'Sistem'
  });

  res.json(updated);
});

// ---- Endpoint Reminder List (H-3 dan Menunggak) ----
app.get('/api/reminders', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const reminders = getReminderList(data);
  res.json({
    total: reminders.length,
    reminders: reminders
  });
});

// ---- Endpoint Eksekusi Reminder Massal ----
app.post('/api/reminders/send-bulk', async (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const reminders = getReminderList(data);
  const settings = readSettings();

  if (reminders.length === 0) {
    return res.json({ sent_count: 0, message: 'Tidak ada tagihan yang jatuh tempo H-3 atau menunggak saat ini.' });
  }

  // Jika mode manual (wa.me), kembalikan daftar link wa.me
  if (!settings.wa_provider || settings.wa_provider === 'manual') {
    logActivity('PENGINGAT_MASSAL', `Menyiapkan pengingat tagihan massal untuk ${reminders.length} pelanggan (Mode: wa.me)`, {
      kategori: 'Broadcast'
    });
    return res.json({
      mode: 'manual',
      total: reminders.length,
      message: 'Mode manual (wa.me) aktif. Gunakan tautan yang disediakan untuk mengirim.',
      items: reminders.map(r => ({
        id: r.customer.id,
        nama: r.customer.nama,
        whatsapp: r.customer.whatsapp,
        kategori: r.kategori,
        wa_url: r.wa_url,
        pesan: r.pesan
      }))
    });
  }

  // Jika mode Gateway API (Fonnte/Wablas)
  const results = [];
  let successCount = 0;

  for (const item of reminders) {
    try {
      await dispatchWaMessage(item.customer.whatsapp, item.pesan, settings);
      results.push({ id: item.customer.id, nama: item.customer.nama, status: 'success' });
      successCount++;
    } catch (err) {
      results.push({ id: item.customer.id, nama: item.customer.nama, status: 'failed', error: err.message });
    }
  }

  logActivity('PENGINGAT_MASSAL', `Kirim pengingat WhatsApp massal via gateway ${settings.wa_provider}: ${successCount} terkirim, ${reminders.length - successCount} gagal`, {
    kategori: 'Broadcast'
  });

  res.json({
    mode: settings.wa_provider,
    total: reminders.length,
    success_count: successCount,
    failed_count: reminders.length - successCount,
    results: results
  });
});

// ---- Send WhatsApp Satuan ----
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

  try {
    const apiRes = await dispatchWaMessage(targetPhone, message, settings);
    return res.json({ success: true, provider: settings.wa_provider, detail: apiRes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---- API Broadcast Pengumuman Massal via WhatsApp ----
app.post('/api/broadcast/preview', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const settings = readSettings();
  const { filter_target = 'all', wilayah, message_template = '' } = req.body || {};

  const filtered = data.filter((c) => {
    if (filter_target === 'menunggak') {
      return c.status_tagihan !== 'Lunas';
    }
    if (filter_target === 'terisolir') {
      return c.status_jaringan === 'Terisolir' || c.status_jaringan === 'Terisolir / Gangguan';
    }
    if (filter_target === 'wilayah' && wilayah) {
      return c.wilayah === wilayah;
    }
    return true; // 'all'
  });

  const recipients = filtered.map((c) => {
    const compiled = compileMessage(message_template, c, settings);
    return {
      id: c.id,
      customer_id: c.customer_id,
      nama: c.nama,
      whatsapp: c.whatsapp,
      wilayah: c.wilayah,
      paket: c.paket,
      harga: c.harga,
      status_tagihan: c.status_tagihan,
      status_jaringan: c.status_jaringan,
      pesan: compiled,
      wa_url: `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(compiled)}`
    };
  });

  res.json({
    filter_target,
    wilayah: wilayah || null,
    total: recipients.length,
    wa_provider: settings.wa_provider || 'manual',
    recipients
  });
});

app.post('/api/broadcast/send', async (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const settings = readSettings();
  const { filter_target = 'all', wilayah, message_template = '', customer_ids } = req.body || {};
  if (!message_template || !message_template.trim()) {
    return res.status(400).json({ error: 'Template pesan broadcast tidak boleh kosong' });
  }

  let targetList = data.filter((c) => {
    if (Array.isArray(customer_ids) && customer_ids.length > 0) {
      return customer_ids.includes(c.id);
    }
    if (filter_target === 'menunggak') {
      return c.status_tagihan !== 'Lunas';
    }
    if (filter_target === 'terisolir') {
      return c.status_jaringan === 'Terisolir' || c.status_jaringan === 'Terisolir / Gangguan';
    }
    if (filter_target === 'wilayah' && wilayah) {
      return c.wilayah === wilayah;
    }
    return true;
  });

  if (targetList.length === 0) {
    return res.status(400).json({ error: 'Tidak ada pelanggan yang sesuai dengan filter broadcast.' });
  }

  // Jika mode manual (wa.me)
  if (!settings.wa_provider || settings.wa_provider === 'manual') {
    const listWithUrls = targetList.map((c) => {
      const msg = compileMessage(message_template, c, settings);
      return {
        id: c.id,
        nama: c.nama,
        whatsapp: c.whatsapp,
        wa_url: `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(msg)}`
      };
    });

    logActivity('KIRIM_BROADCAST', `Menyiapkan tautan broadcast WhatsApp (${filter_target}) ke ${targetList.length} pelanggan`, {
      kategori: 'Broadcast'
    });

    return res.json({
      mode: 'manual',
      total: listWithUrls.length,
      message: 'Mode Manual aktif. Gunakan tautan wa.me untuk mengirimkan pesan ke pelanggan.',
      items: listWithUrls
    });
  }

  // Jika mode API Gateway (Fonnte/Wablas)
  const results = [];
  let successCount = 0;
  for (const c of targetList) {
    const msg = compileMessage(message_template, c, settings);
    try {
      await dispatchWaMessage(c.whatsapp, msg, settings);
      results.push({ id: c.id, nama: c.nama, whatsapp: c.whatsapp, status: 'success' });
      successCount++;
    } catch (err) {
      results.push({ id: c.id, nama: c.nama, whatsapp: c.whatsapp, status: 'failed', error: err.message });
    }
  }

  logActivity('KIRIM_BROADCAST', `Kirim broadcast WhatsApp (${filter_target}) via gateway ${settings.wa_provider}: ${successCount} berhasil, ${targetList.length - successCount} gagal`, {
    kategori: 'Broadcast'
  });

  res.json({
    mode: settings.wa_provider,
    total: targetList.length,
    success_count: successCount,
    failed_count: targetList.length - successCount,
    results
  });
});

// =========================================================================
// PORTAL PELANGGAN (CLIENT AREA) ENDPOINTS
// =========================================================================

// Helper menghitung sisa masa aktif dan status paket pelanggan
function getClientPortalData(c, now = new Date()) {
  const diffDays = getDaysDiff(c.jatuh_tempo, now);
  let statusMasaAktif = 'Aktif';
  let badgeColor = 'green';
  let sisaHariText = '';

  if (diffDays > 0) {
    statusMasaAktif = 'Aktif';
    badgeColor = 'green';
    sisaHariText = `${diffDays} hari tersisa`;
  } else if (diffDays === 0) {
    statusMasaAktif = 'Jatuh Tempo Hari Ini';
    badgeColor = 'yellow';
    sisaHariText = 'Berakhir hari ini';
  } else {
    statusMasaAktif = 'Masa Aktif Berakhir / Menunggak';
    badgeColor = 'red';
    sisaHariText = `Lewat ${Math.abs(diffDays)} hari`;
  }

  // Jika tagihan belum lunas dan lewat tempo, atau jaringan terisolir
  if (c.status_tagihan !== 'Lunas' && diffDays < 0) {
    statusMasaAktif = 'Terisolir / Menunggak';
    badgeColor = 'red';
  } else if (c.status_jaringan === 'Terisolir') {
    statusMasaAktif = 'Sambungan Terisolir';
    badgeColor = 'red';
  } else if (c.status_jaringan === 'Terisolir / Gangguan') {
    statusMasaAktif = 'Gangguan Jaringan';
    badgeColor = 'yellow';
  }

  return {
    customer_id: c.customer_id,
    nama: c.nama,
    whatsapp: c.whatsapp,
    alamat: c.alamat,
    wilayah: c.wilayah,
    paket: c.paket,
    harga: c.harga,
    jatuh_tempo: c.jatuh_tempo,
    status_tagihan: c.status_tagihan,
    status_jaringan: c.status_jaringan || 'Aktif',
    catatan_kendala: c.catatan_kendala || '',
    sisa_hari: diffDays,
    sisa_hari_text: sisaHariText,
    status_masa_aktif: statusMasaAktif,
    badge_color: badgeColor,
    invoices: [...(c.invoices || [])].sort((a, b) => b.periode.localeCompare(a.periode)),
    network_logs: (c.network_logs || []).slice(0, 10), // 10 log terbaru
    device: c.device || null,
    bank_accounts: readBankAccounts().filter(b => b.is_active !== false),
    admin_phone: (() => {
      const p = (readSettings().sender_phone || '').replace(/[\s\-+]/g, '');
      return p.startsWith('0') ? '62' + p.slice(1) : p;
    })(),
    qris_info: readSettings().qris_info || '',
  };
}

// 1. Verifikasi Login Pelanggan (berdasarkan ID Pelanggan atau Nomor WhatsApp)
app.post('/api/client/login', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const identifier = String(req.body.identifier || '').trim();

  if (!identifier) {
    return res.status(400).json({ error: 'ID Pelanggan atau Nomor WhatsApp wajib diisi' });
  }

  // Normalisasi jika input berupa nomor HP
  let cleanPhone = identifier.replace(/[\s\-+]/g, '');
  if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);

  // Cari berdasarkan customer_id (case insensitive) atau whatsapp
  const c = data.find((x) => 
    (x.customer_id && x.customer_id.toUpperCase() === identifier.toUpperCase()) ||
    (x.whatsapp && (x.whatsapp === cleanPhone || x.whatsapp === identifier))
  );

  if (!c) {
    return res.status(404).json({ error: 'Pelanggan tidak ditemukan. Periksa kembali ID Pelanggan (contoh: PLG001) atau nomor WhatsApp Anda.' });
  }

  res.json({
    success: true,
    message: `Selamat datang, ${c.nama}`,
    client: getClientPortalData(c),
  });
});

// 2. Refresh / Get Detail Profil Client Terkini
app.get('/api/client/profile/:customerId', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const custId = String(req.params.customerId).toUpperCase();

  const c = data.find((x) => x.customer_id && x.customer_id.toUpperCase() === custId);
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  res.json(getClientPortalData(c));
});

// 3. Pelanggan Mengirim Laporan Gangguan dari Portal
app.post('/api/client/report-issue', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const custId = String(req.body.customer_id || '').toUpperCase();
  const keluhan = String(req.body.keluhan || '').trim();

  if (!custId || !keluhan) {
    return res.status(400).json({ error: 'ID Pelanggan dan rincian keluhan/gangguan wajib diisi' });
  }

  const c = data.find((x) => x.customer_id && x.customer_id.toUpperCase() === custId);
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  // Catat laporan keluhan ke network_logs pelanggan sebagai Tiket Gangguan baru
  const nowMs = Date.now();
  const logEntry = {
    id: nowMs,
    tiket_id: 'TKT-' + String(nowMs).slice(-6),
    status: 'DOWN',
    jenis_kendala: 'Laporan Pelanggan (Portal Mandiri)',
    teknisi: 'Menunggu Penugasan',
    status_penanganan: 'Pending',
    catatan_perbaikan: keluhan,
    waktu: formatWaktuIndo(new Date(nowMs)),
    waktu_selesai: null,
    durasi: 'Sedang Berlangsung',
    created_at: nowMs,
    resolved_at: null,
    keterangan: `[Laporan Pelanggan] ${keluhan}`,
  };

  if (!Array.isArray(c.network_logs)) c.network_logs = [];
  c.network_logs.unshift(logEntry);

  // Otomatis tandai catatan kendala di sistem admin
  c.status_jaringan = 'Terisolir / Gangguan';
  c.catatan_kendala = `[Laporan Pelanggan]: ${keluhan}`;

  writeDB(data);
  res.json({
    success: true,
    message: 'Laporan gangguan Anda telah berhasil dicatat dan diteruskan ke tim teknisi RT/RW.net.',
    client: getClientPortalData(c),
  });
});

// Rute render client area langsung dari URL /client atau /portal
app.get('/client', (req, res) => res.sendFile(path.join(__dirname, 'public', 'client.html')));
app.get('/portal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'client.html')));

// ---- API AUDIT TRAIL / LOG AKTIVITAS ADMIN ----
app.get('/api/activity-logs', (req, res) => {
  let logs = readActivityLogs();
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const kategori = typeof req.query.kategori === 'string' ? req.query.kategori.trim() : '';
  const limit = Number(req.query.limit) || 150;

  if (search) {
    logs = logs.filter(l => 
      (l.keterangan && l.keterangan.toLowerCase().includes(search)) ||
      (l.aksi && l.aksi.toLowerCase().includes(search)) ||
      (l.admin && l.admin.toLowerCase().includes(search)) ||
      (l.target_id && l.target_id.toLowerCase().includes(search))
    );
  }

  if (kategori && kategori !== 'all') {
    logs = logs.filter(l => l.kategori === kategori);
  }

  res.json({
    total: logs.length,
    logs: logs.slice(0, limit)
  });
});

app.delete('/api/activity-logs/clear', (req, res) => {
  writeActivityLogs([]);
  logActivity('CLEAR_LOGS', 'Seluruh riwayat log audit aktivitas admin telah dibersihkan', { kategori: 'Sistem' });
  res.json({ success: true, message: 'Riwayat log aktivitas berhasil dibersihkan' });
});

app.get('/api/activity-logs/stats', (req, res) => {
  const logs = readActivityLogs();
  const todayPrefix = formatWaktuIndo(new Date()).slice(0, 11);
  const todayCount = logs.filter(l => l.waktu && l.waktu.includes(todayPrefix)).length;
  const categories = {};
  for (const l of logs) {
    const k = l.kategori || 'Lainnya';
    categories[k] = (categories[k] || 0) + 1;
  }
  res.json({
    total_logs: logs.length,
    today_count: todayCount,
    categories
  });
});

// ---- API MANAJEMEN PENGELUARAN & KAS OPERASIONAL (EXPENSE TRACKER) ----
app.get('/api/expenses', (req, res) => {
  let list = readExpenses();
  const periode = typeof req.query.periode === 'string' ? req.query.periode.trim() : '';
  const kategori = typeof req.query.kategori === 'string' ? req.query.kategori.trim() : '';

  if (periode) {
    list = list.filter(e => e.tanggal && e.tanggal.slice(0, 7) === periode);
  }
  if (kategori && kategori !== 'all') {
    list = list.filter(e => e.kategori === kategori);
  }

  list.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || '') || (b.id - a.id));

  const totalNominal = list.reduce((sum, e) => sum + (Number(e.nominal) || 0), 0);

  res.json({
    total_count: list.length,
    total_nominal: totalNominal,
    expenses: list
  });
});

app.get('/api/expenses/summary', (req, res) => {
  const list = readExpenses();
  const currentMonth = today().slice(0, 7);
  const currentMonthExpenses = list.filter(e => e.tanggal && e.tanggal.slice(0, 7) === currentMonth);
  const totalNominalCurrent = currentMonthExpenses.reduce((sum, e) => sum + (Number(e.nominal) || 0), 0);
  const totalNominalAll = list.reduce((sum, e) => sum + (Number(e.nominal) || 0), 0);
  res.json({
    current_month: currentMonth,
    current_month_total: totalNominalCurrent,
    current_month_count: currentMonthExpenses.length,
    all_time_total: totalNominalAll,
    all_time_count: list.length
  });
});

app.post('/api/expenses', (req, res) => {
  const body = req.body || {};
  const tanggal = String(body.tanggal || today()).trim();
  const kategori = String(body.kategori || 'Operasional').trim();
  const nominal = Number(body.nominal);
  const keterangan = String(body.keterangan || '').trim();
  const petugas = String(body.petugas || 'Admin Utama').trim();

  if (!nominal || nominal <= 0) {
    return res.status(400).json({ error: 'Nominal pengeluaran harus lebih besar dari 0' });
  }
  if (!keterangan) {
    return res.status(400).json({ error: 'Keterangan pengeluaran wajib diisi' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || isNaN(new Date(tanggal))) {
    return res.status(400).json({ error: 'Format tanggal pengeluaran tidak valid (YYYY-MM-DD)' });
  }

  const list = readExpenses();
  const nextId = list.reduce((max, e) => Math.max(max, e.id || 0), 0) + 1;
  const newExpense = {
    id: nextId,
    tanggal,
    kategori,
    nominal,
    keterangan,
    petugas,
    created_at: Date.now()
  };

  list.unshift(newExpense);
  writeExpenses(list);

  logActivity('TAMBAH_PENGELUARAN', `Mencatat pengeluaran kas [${kategori}]: ${keterangan} sebesar ${rupiah(nominal)} (Petugas: ${petugas})`, {
    kategori: 'Keuangan',
    target_id: `EXP-${nextId}`
  });

  res.status(201).json({ success: true, expense: newExpense });
});

app.delete('/api/expenses/:id', (req, res) => {
  const id = Number(req.params.id);
  const list = readExpenses();
  const idx = list.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Data pengeluaran tidak ditemukan' });

  const removed = list.splice(idx, 1)[0];
  writeExpenses(list);

  logActivity('HAPUS_PENGELUARAN', `Menghapus data pengeluaran ID #${id}: [${removed.kategori}] ${removed.keterangan} (${rupiah(removed.nominal)})`, {
    kategori: 'Keuangan',
    target_id: `EXP-${id}`
  });

  res.json({ success: true, removed });
});

// ---- API Laporan Keuangan, Pengeluaran & Laba Bersih ----
app.get('/api/reports/financial', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const expenses = readExpenses();

  // 1. Agregasi per periode bulanan dari seluruh invoice
  const monthlyMap = {};
  for (const c of data) {
    for (const inv of c.invoices || []) {
      const p = inv.periode;
      if (!monthlyMap[p]) {
        monthlyMap[p] = {
          periode: p,
          label: periodeLabel(p),
          lunas: 0,
          piutang: 0,
          total: 0,
          pengeluaran: 0,
          laba_bersih: 0,
          count_lunas: 0,
          count_belum: 0,
        };
      }
      const nom = Number(inv.nominal) || 0;
      if (inv.status === 'Lunas') {
        monthlyMap[p].lunas += nom;
        monthlyMap[p].count_lunas++;
      } else {
        monthlyMap[p].piutang += nom;
        monthlyMap[p].count_belum++;
      }
      monthlyMap[p].total += nom;
    }
  }

  // 2. Agregasi pengeluaran bulanan
  for (const exp of expenses) {
    const p = (exp.tanggal || '').slice(0, 7);
    if (!p) continue;
    if (!monthlyMap[p]) {
      monthlyMap[p] = {
        periode: p,
        label: periodeLabel(p),
        lunas: 0,
        piutang: 0,
        total: 0,
        pengeluaran: 0,
        laba_bersih: 0,
        count_lunas: 0,
        count_belum: 0,
      };
    }
    monthlyMap[p].pengeluaran = (monthlyMap[p].pengeluaran || 0) + (Number(exp.nominal) || 0);
    monthlyMap[p].count_expenses = (monthlyMap[p].count_expenses || 0) + 1;
  }

  // 3. Hitung laba bersih tiap bulan
  for (const p in monthlyMap) {
    const m = monthlyMap[p];
    if (m.pengeluaran === undefined) m.pengeluaran = 0;
    m.laba_bersih = m.lunas - m.pengeluaran;
  }

  // Urutkan periode secara kronologis
  const sortedTrend = Object.values(monthlyMap).sort((a, b) => a.periode.localeCompare(b.periode));

  // 4. Metrik Periode Berjalan atau Periode Terpilih
  const curPeriod = today().slice(0, 7);
  const targetPeriod = (req.query.periode && monthlyMap[req.query.periode]) ? req.query.periode : curPeriod;
  const activePeriodData = monthlyMap[targetPeriod] || (sortedTrend.length > 0 ? sortedTrend[sortedTrend.length - 1] : {
    periode: targetPeriod,
    label: periodeLabel(targetPeriod),
    lunas: 0,
    piutang: 0,
    total: 0,
    pengeluaran: 0,
    laba_bersih: 0,
    count_lunas: 0,
    count_belum: 0,
  });

  const totalPotensi = (activePeriodData.lunas + activePeriodData.piutang) || 1;
  const ratePersen = Math.round((activePeriodData.lunas / totalPotensi) * 100);

  const activePengeluaran = activePeriodData.pengeluaran || 0;
  const activeLabaBersih = activePeriodData.lunas - activePengeluaran;
  const marginLaba = activePeriodData.lunas > 0
    ? Math.round((activeLabaBersih / activePeriodData.lunas) * 100)
    : 0;

  // 5. Distribusi Berdasarkan Paket Internet
  const paketMap = {};
  for (const c of data) {
    const pkt = c.paket || 'Lainnya';
    if (!paketMap[pkt]) {
      paketMap[pkt] = { paket: pkt, nominal: 0, count: 0, lunas: 0, piutang: 0 };
    }
    paketMap[pkt].count++;
    paketMap[pkt].nominal += c.harga;
    if (c.status_tagihan === 'Lunas') {
      paketMap[pkt].lunas += c.harga;
    } else {
      paketMap[pkt].piutang += c.harga;
    }
  }

  // 6. Distribusi Berdasarkan Wilayah
  const wilayahMap = {};
  for (const c of data) {
    const wil = c.wilayah || 'Lainnya';
    if (!wilayahMap[wil]) {
      wilayahMap[wil] = { wilayah: wil, nominal: 0, count: 0, lunas: 0, piutang: 0 };
    }
    wilayahMap[wil].count++;
    wilayahMap[wil].nominal += c.harga;
    if (c.status_tagihan === 'Lunas') {
      wilayahMap[wil].lunas += c.harga;
    } else {
      wilayahMap[wil].piutang += c.harga;
    }
  }

  const responseSummary = {
    periode: activePeriodData.periode,
    label: activePeriodData.label,
    periode_label: activePeriodData.label,
    total_pendapatan: activePeriodData.lunas,
    total_piutang: activePeriodData.piutang,
    total_pengeluaran: activePengeluaran,
    laba_bersih: activeLabaBersih,
    margin_profit: marginLaba,
    total_potensi: activePeriodData.total,
    collection_rate: ratePersen,
    count_lunas: activePeriodData.count_lunas,
    count_belum: activePeriodData.count_belum,
    count_expenses: activePeriodData.count_expenses || 0,
    total_pelanggan: data.length,
  };

  const availablePeriods = sortedTrend.map((t) => ({
    periode: t.periode,
    label: t.label,
    is_current: t.periode === targetPeriod,
  }));

  res.json({
    summary: responseSummary,
    current_summary: responseSummary,
    monthly_trend: sortedTrend,
    monthly_trends: sortedTrend,
    available_periods: availablePeriods,
    by_package: Object.values(paketMap),
    by_area: Object.values(wilayahMap),
  });
});

// ---- CSV Export API ----
app.get('/api/export/csv', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);

  const header = ['ID', 'ID Pelanggan', 'Nama', 'WhatsApp', 'Alamat', 'Wilayah', 'Paket', 'Harga (Rp)', 'Jatuh Tempo', 'Status Tagihan', 'Status Jaringan', 'Catatan Kendala', 'Total Log Gangguan'];
  const rows = data.map((c) => [
    c.id,
    `"${c.customer_id || ''}"`,
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

// =========================================================================
// MIKROTIK ROUTEROS INTEGRATION SKELETON & CONTROLLER
// Kerangka integrasi RouterOS API (siap dihubungkan ke library 'routeros-client' atau RouterOS v7 REST API)
// =========================================================================

// Helper simulasi status router Mikrotik
function getMikrotikRouterInfo(customers = []) {
  const settings = readSettings();
  const mtConfig = settings.mikrotik || {
    host: '192.168.88.1',
    port: 8728,
    username: 'admin',
    identity: 'MikroTik-CCR1009-Billing',
    model: 'CCR1009-7G-1C-1S+',
    version: 'RouterOS v7.14.3'
  };

  const activePppoe = customers.filter(c => c.status_jaringan === 'Aktif').length;
  const isolatedCount = customers.filter(c => c.status_jaringan === 'Terisolir' || c.status_jaringan === 'Terisolir / Gangguan').length;

  return {
    connected: true, // Ubah menjadi false jika router gagal dihubungi
    status: 'ONLINE',
    host: mtConfig.host || '192.168.88.1',
    port: mtConfig.port || 8728,
    identity: mtConfig.identity || 'MikroTik-CCR1009-Billing',
    model: mtConfig.model || 'CCR1009-7G-1C-1S+',
    version: mtConfig.version || 'RouterOS v7.14.3',
    uptime: '42d 18h 32m 14s',
    cpu_load: '8%',
    free_memory: '852.4 MiB',
    total_memory: '1024.0 MiB',
    active_pppoe: activePppoe,
    active_hotspot: 0,
    total_secrets: customers.length,
    isolated_secrets: isolatedCount,
    last_sync: mtConfig.last_sync || formatWaktuIndo(new Date()),
    api_driver: 'RouterOS API / REST API Skeleton'
  };
}

// 1. GET /api/mikrotik/status (Cek status router & informasi hardware)
app.get('/api/mikrotik/status', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const routerInfo = getMikrotikRouterInfo(data);
  res.json({
    success: true,
    ...routerInfo
  });
});

// 2. POST /api/mikrotik/sync (Sinkronisasi Massal Pelanggan Billing -> Mikrotik PPP Secrets)
app.post('/api/mikrotik/sync', async (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const now = new Date();
  const nowStr = now.toISOString();

  /*
   * PANDUAN INTEGRASI LIBRARY MIKROTIK (misal: 'routeros-client' atau RouterOS v7 REST API):
   * ---------------------------------------------------------------------------------------
   * const { RouterOSClient } = require('routeros-client');
   * const api = new RouterOSClient({
   *   host: settings.mikrotik.host,
   *   user: settings.mikrotik.username,
   *   password: settings.mikrotik.password,
   *   port: settings.mikrotik.port
   * });
   * await api.connect();
   * for (const c of data) {
   *   const profile = (c.status_jaringan === 'Terisolir') ? 'profile-ISOLIR' : c.mikrotikProfile;
   *   // Eksekusi update profile / secret di Mikrotik:
   *   // await api.write('/ppp/secret/set', [`?name=${c.mikrotikUsername}`, `=profile=${profile}`, `=remote-address=${c.ipAddress}`]);
   * }
   * await api.close();
   */

  let updatedCount = 0;
  const syncResults = [];

  for (const c of data) {
    const isIso = c.status_jaringan === 'Terisolir' || c.status_jaringan === 'Terisolir / Gangguan';
    const profileApplied = isIso ? 'profile-ISOLIR' : (c.mikrotikProfile || '10Mbps');
    c.mikrotikStatus = isIso ? 'isolated' : 'connected';
    c.mikrotikLastSync = nowStr;
    updatedCount++;

    syncResults.push({
      id: c.id,
      customer_id: c.customer_id,
      nama: c.nama,
      username: c.mikrotikUsername,
      profile: profileApplied,
      ip: c.ipAddress,
      service: c.mikrotikService || 'pppoe',
      status: c.mikrotikStatus
    });
  }

  writeDB(data);

  // Update last_sync di settings
  const settings = readSettings();
  if (!settings.mikrotik) settings.mikrotik = {};
  settings.mikrotik.last_sync = formatWaktuIndo(now);
  writeSettings(settings);

  logActivity('MIKROTIK_SYNC_MASSAL', `Sinkronisasi massal data ${updatedCount} pelanggan PPPoE/Hotspot ke Router MikroTik CCR1009`, {
    kategori: 'Jaringan'
  });

  res.json({
    success: true,
    message: `Berhasil menyinkronkan ${updatedCount} pelanggan dengan Router MikroTik`,
    synced_count: updatedCount,
    last_sync: settings.mikrotik.last_sync,
    details: syncResults
  });
});

// 3. POST /api/mikrotik/isolate/:id (Isolir Akun Pelanggan di Mikrotik)
app.post('/api/mikrotik/isolate/:id', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const c = data.find((x) => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  c.status_jaringan = 'Terisolir';
  c.mikrotikStatus = 'isolated';
  c.mikrotikLastSync = new Date().toISOString();

  /*
   * PANDUAN EKSEKUSI DI ROUTER MIKROTIK:
   * 1. Ubah profil PPP secret menjadi 'profile-ISOLIR' (diarahkan ke IP Pool Walled Garden / DNS isolir).
   * 2. Putus (kick) sesi aktif di /ppp/active agar router memaksa koneksi ulang dengan profil baru.
   * await api.write('/ppp/secret/set', [`?name=${c.mikrotikUsername}`, `=profile=profile-ISOLIR`]);
   * await api.write('/ppp/active/remove', [`?name=${c.mikrotikUsername}`]);
   */

  if (!Array.isArray(c.network_logs)) c.network_logs = [];
  c.network_logs.unshift({
    id: Date.now(),
    tiket_id: 'ISO-' + String(Date.now()).slice(-6),
    status: 'DOWN',
    jenis_kendala: 'Isolir Jaringan Mikrotik',
    teknisi: 'Sistem Billing (Mikrotik API)',
    status_penanganan: 'Selesai',
    catatan_perbaikan: `Akun PPPoE ${c.mikrotikUsername} dipindahkan ke profile-ISOLIR & sesi aktif diputus.`,
    waktu: formatWaktuIndo(),
    waktu_selesai: formatWaktuIndo(),
    durasi: 'Selesai'
  });

  writeDB(data);

  logActivity('MIKROTIK_ISOLIR', `Isolir PPPoE MikroTik untuk ${c.nama} (${c.customer_id}): User '${c.mikrotikUsername}' dipindahkan ke profile-ISOLIR`, {
    kategori: 'Jaringan',
    target_id: c.customer_id
  });

  res.json({
    success: true,
    message: `Pelanggan ${c.nama} (${c.mikrotikUsername}) berhasil diisolir pada Router MikroTik`,
    customer: c,
    mikrotik_action: {
      username: c.mikrotikUsername,
      profile_before: c.mikrotikProfile,
      profile_active: 'profile-ISOLIR',
      session_kicked: true
    }
  });
});

// 4. POST /api/mikrotik/restore/:id (Buka Isolir / Pulihkan Akun Pelanggan di Mikrotik)
app.post('/api/mikrotik/restore/:id', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const c = data.find((x) => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  c.status_jaringan = 'Aktif';
  c.mikrotikStatus = 'connected';
  c.mikrotikLastSync = new Date().toISOString();

  /*
   * PANDUAN EKSEKUSI DI ROUTER MIKROTIK:
   * await api.write('/ppp/secret/set', [`?name=${c.mikrotikUsername}`, `=profile=${c.mikrotikProfile}`]);
   * await api.write('/ppp/active/remove', [`?name=${c.mikrotikUsername}`]);
   */

  if (!Array.isArray(c.network_logs)) c.network_logs = [];
  c.network_logs.unshift({
    id: Date.now(),
    tiket_id: 'RST-' + String(Date.now()).slice(-6),
    status: 'UP',
    jenis_kendala: 'Buka Isolir Jaringan Mikrotik',
    teknisi: 'Sistem Billing (Mikrotik API)',
    status_penanganan: 'Selesai',
    catatan_perbaikan: `Akun PPPoE ${c.mikrotikUsername} dikembalikan ke ${c.mikrotikProfile} & koneksi aktif dipulihkan.`,
    waktu: formatWaktuIndo(),
    waktu_selesai: formatWaktuIndo(),
    durasi: 'Selesai'
  });

  writeDB(data);

  logActivity('MIKROTIK_BUKA_ISOLIR', `Buka isolir PPPoE MikroTik untuk ${c.nama} (${c.customer_id}): Profil dikembalikan ke '${c.mikrotikProfile}'`, {
    kategori: 'Jaringan',
    target_id: c.customer_id
  });

  res.json({
    success: true,
    message: `Koneksi Mikrotik ${c.nama} (${c.mikrotikUsername}) berhasil dipulihkan`,
    customer: c,
    mikrotik_action: {
      username: c.mikrotikUsername,
      profile_active: c.mikrotikProfile,
      session_reconnected: true
    }
  });
});

// 5. POST /api/mikrotik/customer/:id/sync (Sinkronkan Satu Pelanggan ke Mikrotik)
app.post('/api/mikrotik/customer/:id/sync', (req, res) => {
  const data = readDB();
  ensureFieldsAndInvoices(data);
  const c = data.find((x) => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });

  const isIso = c.status_jaringan === 'Terisolir' || c.status_jaringan === 'Terisolir / Gangguan';
  const profileApplied = isIso ? 'profile-ISOLIR' : (c.mikrotikProfile || '10Mbps');
  c.mikrotikStatus = isIso ? 'isolated' : 'connected';
  c.mikrotikLastSync = new Date().toISOString();

  writeDB(data);

  logActivity('MIKROTIK_SYNC_SINGLE', `Sinkronisasi PPPoE ${c.nama} (${c.mikrotikUsername}) ke MikroTik: Profil ${profileApplied}`, {
    kategori: 'Jaringan',
    target_id: c.customer_id
  });

  res.json({
    success: true,
    message: `Data Mikrotik ${c.nama} (${c.mikrotikUsername}) berhasil disinkronkan`,
    customer: c,
    profile_applied: profileApplied
  });
});

// 6. POST /api/mikrotik/test-connection (Tes Ping & Koneksi Router)
app.post('/api/mikrotik/test-connection', (req, res) => {
  const data = readDB();
  const info = getMikrotikRouterInfo(data);
  res.json({
    success: true,
    message: 'Koneksi ke Router MikroTik berhasil (Online)',
    ping_latency: '1.8 ms',
    router: info
  });
});

// Auto-generate tagihan awal bulan & pengecekan auto-isolir berkala
function autoGenerate() {
  const now = new Date();
  const data = readDB();
  let changed = ensureFieldsAndInvoices(data);
  if (now.getDate() === 1) {
    const n = generateBills(data, now);
    if (n) { changed = true; console.log(`[auto] ${n} tagihan baru dibuat`); }
  }
  const isoCount = checkAutoIsolir(data, 7, now);
  if (isoCount > 0) {
    changed = true;
    console.log(`[auto-isolir] ${isoCount} sambungan pelanggan menunggak diubah menjadi Terisolir`);
  }
  if (changed) writeDB(data);
}
autoGenerate();
setInterval(autoGenerate, 60 * 60 * 1000);

// =========================================================================
// JADWAL NODE-CRON: Auto-Reminder WhatsApp Harian Setiap Jam 08:00 Pagi
// Format Cron: "0 8 * * *" (menit 0, jam 8, setiap hari)
// =========================================================================
cron.schedule('0 8 * * *', async () => {
  console.log(`[cron-08:00] Menjalankan pengecekan pengingat tagihan & status isolir (${formatWaktuIndo()})...`);
  try {
    const data = readDB();
    ensureFieldsAndInvoices(data);
    const isoCount = checkAutoIsolir(data, 7);
    if (isoCount > 0) {
      writeDB(data);
      console.log(`[cron-08:00] ⚠️ ${isoCount} pelanggan menunggak >7 hari berhasil diisolir.`);
    }
    const reminders = getReminderList(data);
    const settings = readSettings();

    if (reminders.length === 0) {
      console.log('[cron-08:00] Tidak ada tagihan H-3 atau menunggak.');
      return;
    }

    console.log(`[cron-08:00] Ditemukan ${reminders.length} pelanggan yang perlu pengingat.`);

    // Jika menggunakan API Gateway (Fonnte/Wablas), kirim otomatis ke nomor pelanggan
    if (settings.wa_provider && settings.wa_provider !== 'manual') {
      for (const r of reminders) {
        try {
          await dispatchWaMessage(r.customer.whatsapp, r.pesan, settings);
          console.log(`[cron-08:00] ✅ Pesan terkirim ke ${r.customer.nama} (${r.kategori})`);
        } catch (e) {
          console.error(`[cron-08:00] ❌ Gagal kirim ke ${r.customer.nama}: ${e.message}`);
        }
      }
    } else {
      console.log('[cron-08:00] Mode WhatsApp diatur Manual. Admin dapat memicu via dashboard tombol "Kirim Reminder Massal".');
    }
  } catch (err) {
    console.error('[cron-08:00] Terjadi kesalahan dalam cron job:', err.message);
  }
});

app.listen(PORT, () => console.log(`Billing RT/RW.net berjalan di http://localhost:${PORT}`));
