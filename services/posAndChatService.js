'use strict';
/**
 * MODUL 4 (BayarWifi 3.0) - POS (Point of Sales / Toko) & Live Chat Pelanggan Terintegrasi
 *
 * 1. POS / Toko:
 *    - Terintegrasi dengan `inventory_stock.json` (potong stok otomatis saat barang terjual),
 *      `hotspotService` (otomatis terbitkan kode voucher saat penjualan voucher di POS),
 *      dan `customers.json` (pencatatan transaksi atas nama pelanggan terdaftar atau umum).
 * 2. Live Chat:
 *    - Terintegrasi penuh dengan profil pelanggan (`customers.json`) sehingga saat Admin,
 *      Kasir, atau Teknisi membuka ruang chat, rincian tagihan, status isolir, tipe ONT,
 *      dan port OLT pelanggan langsung tampil.
 *    - Dilengkapi fitur konversi percakapan menjadi Tiket Gangguan Teknis.
 */
const fs = require('fs');

const DEFAULT_SERVICE_PRODUCTS = [
  {
    id: 'SRV-01',
    kode_produk: 'SRV-INSTALASI',
    nama_produk: 'Biaya Pasang Baru / Instalasi Standar',
    kategori: 'Jasa & Layanan',
    tipe_item: 'service',
    harga_modal: 50000,
    harga_jual: 150000,
    stok: 999,
    satuan: 'Paket',
    deskripsi: 'Jasa penarikan kabel dropcore FO, setting ONT, dan aktivasi PPPoE'
  },
  {
    id: 'SRV-02',
    kode_produk: 'SRV-ADAPTOR',
    nama_produk: 'Penggantian Adaptor Modem 12V 1.5A',
    kategori: 'Aksesoris',
    tipe_item: 'service',
    harga_modal: 20000,
    harga_jual: 35000,
    stok: 50,
    satuan: 'Pcs',
    deskripsi: 'Adaptor pengganti untuk ONT ZTE / Huawei / Router AP'
  },
  {
    id: 'SRV-03',
    kode_produk: 'SRV-SPLICE',
    nama_produk: 'Jasa Splicing / Penyambungan Kabel FO Putus',
    kategori: 'Jasa & Layanan',
    tipe_item: 'service',
    harga_modal: 15000,
    harga_jual: 50000,
    stok: 999,
    satuan: 'Titik',
    deskripsi: 'Jasa sambung ulang core optik putus di luar garansi'
  }
];

function createPosAndChatService(deps) {
  const {
    getTenantFilePath,
    safeWriteJSON,
    readDB,
    writeDB,
    readInventoryStock,
    writeInventoryStock,
    hotspotService,
    readSettings,
    dispatchWaMessage,
    formatWaktuIndo,
    today,
    rupiah,
    logActivity
  } = deps;

  // =========================================================================
  // BAGIAN 1: MODUL POS (POINT OF SALES / TOKO)
  // =========================================================================

  function seedDefaultPosTransactions(customers = []) {
    const firstCust = customers[0] || { customer_id: 'PLG001', nama: 'Pelanggan RT/RW', whatsapp: '628123456789' };
    const nowStr = formatWaktuIndo ? formatWaktuIndo(new Date()) : new Date().toISOString();
    const todayDate = today ? today(new Date()) : new Date().toISOString().slice(0, 10);

    return [
      {
        id: 'POS-1001',
        no_nota: `INV-POS-${todayDate.replace(/-/g, '')}-001`,
        tanggal: todayDate,
        waktu: nowStr,
        customer_id: firstCust.customer_id || 'PLG001',
        nama_pembeli: firstCust.nama || 'Bapak Ahmad',
        whatsapp_pembeli: firstCust.whatsapp || '',
        kasir: 'Siti Rahma (Kasir Utama)',
        role_petugas: 'kasir',
        metode_bayar: 'Tunai',
        status: 'completed', // 'completed' | 'void'
        items: [
          {
            product_id: 'STK-07',
            nama_produk: 'Router AP Totolink N200RE',
            tipe_item: 'inventory',
            qty: 1,
            satuan: 'Pcs',
            harga_modal: 110000,
            harga_satuan: 135000,
            subtotal: 135000
          }
        ],
        subtotal: 135000,
        diskon: 0,
        total_bayar: 135000,
        uang_diterima: 150000,
        kembalian: 15000,
        estimasi_laba: 25000,
        generated_vouchers: [],
        catatan: 'Pembelian router tambahan untuk lantai 2'
      }
    ];
  }

  function readPosTransactions(tenantId) {
    const filePath = getTenantFilePath('pos_transactions.json', tenantId);
    if (!fs.existsSync(filePath)) {
      const seeded = seedDefaultPosTransactions(readDB(tenantId));
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

  function writePosTransactions(data, tenantId) {
    const filePath = getTenantFilePath('pos_transactions.json', tenantId);
    safeWriteJSON(filePath, data);
  }

  /**
   * Ambil Katalog Produk POS Terpadu (Stok Inventaris + Paket Voucher Hotspot + Jasa Layanan)
   */
  function getPosCatalog(tenantId) {
    const stockList = readInventoryStock(tenantId) || [];
    const hotspotProfiles = hotspotService ? hotspotService.readProfiles(tenantId) : [];

    const inventoryProducts = stockList.map((s) => {
      const hargaBeli = Number(s.harga_satuan || 0);
      // Margin toko default 20% di atas harga modal inventaris jika harga_jual belum diset
      const hargaJual = Number(s.harga_jual || Math.ceil((hargaBeli * 1.2) / 1000) * 1000);
      return {
        id: s.id,
        kode_produk: s.id,
        nama_produk: s.nama_barang,
        kategori: `Stok ${s.kategori || 'Barang'}`,
        tipe_item: 'inventory',
        harga_modal: hargaBeli,
        harga_jual: hargaJual,
        stok: Number(s.jumlah_stok || 0),
        satuan: s.satuan || 'Pcs',
        deskripsi: s.keterangan || ''
      };
    });

    const voucherProducts = hotspotProfiles.map((p) => ({
      id: p.id,
      kode_produk: p.mikrotik_profile || p.id,
      nama_produk: `${p.nama} (${p.durasi_label || p.uptime_limit})`,
      kategori: 'Voucher Hotspot',
      tipe_item: 'voucher',
      profile_id: p.id,
      harga_modal: Number(p.harga_modal || 0),
      harga_jual: Number(p.harga_jual || 0),
      stok: 9999,
      satuan: 'Voucher',
      deskripsi: p.deskripsi || `Kecepatan ${p.rate_limit}`
    }));

    return {
      all_products: [...voucherProducts, ...inventoryProducts, ...DEFAULT_SERVICE_PRODUCTS],
      categories: ['Voucher Hotspot', 'Stok Perangkat', 'Stok Kabel', 'Stok Aksesoris', 'Jasa & Layanan']
    };
  }

  /**
   * Proses Checkout / Transaksi Baru di POS (Point of Sales)
   */
  async function createPosTransaction(tenantId, body = {}, actor = {}) {
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) {
      return { error: 'Keranjang belanja POS tidak boleh kosong. Pilih minimal 1 item.' };
    }

    const catalog = getPosCatalog(tenantId).all_products;
    const stockList = readInventoryStock(tenantId) || [];
    const customers = readDB(tenantId) || [];

    // Cari data pelanggan jika customer_id dikirimkan
    let matchedCustomer = null;
    if (body.customer_id) {
      const cid = String(body.customer_id).trim().toUpperCase();
      matchedCustomer = customers.find(
        (c) => String(c.customer_id).toUpperCase() === cid || String(c.id) === String(body.customer_id)
      );
    }

    const namaPembeli = String(
      body.nama_pembeli || (matchedCustomer && matchedCustomer.nama) || 'Pelanggan Umum (Walk-In)'
    ).trim();
    const whatsappPembeli = String(
      body.whatsapp_pembeli || (matchedCustomer && matchedCustomer.whatsapp) || ''
    ).trim();

    const processedItems = [];
    const generatedVouchers = [];
    let subtotal = 0;
    let totalModal = 0;
    let stockModified = false;

    for (const reqItem of rawItems) {
      const qty = Math.max(1, Number(reqItem.qty || reqItem.jumlah || 1));
      const prod = catalog.find(
        (p) => p.id === reqItem.product_id || p.kode_produk === reqItem.product_id
      );

      const namaProduk = String(reqItem.nama_produk || (prod && prod.nama_produk) || 'Item Toko').trim();
      const tipeItem = reqItem.tipe_item || (prod && prod.tipe_item) || 'service';
      const satuan = reqItem.satuan || (prod && prod.satuan) || 'Pcs';
      const hargaSatuan = Number(reqItem.harga_satuan !== undefined ? reqItem.harga_satuan : (prod ? prod.harga_jual : 0));
      const hargaModal = Number(reqItem.harga_modal !== undefined ? reqItem.harga_modal : (prod ? prod.harga_modal : Math.round(hargaSatuan * 0.75)));

      if (hargaSatuan <= 0) {
        return { error: `Harga satuan untuk "${namaProduk}" tidak valid.` };
      }

      // 1. Jika tipe_item === 'inventory', periksa dan kurangi stok di inventory_stock.json
      if (tipeItem === 'inventory') {
        const stkItem = stockList.find((s) => s.id === (prod ? prod.id : reqItem.product_id));
        if (stkItem) {
          if (stkItem.jumlah_stok < qty) {
            return {
              error: `Stok "${stkItem.nama_barang}" tidak mencukupi (Tersedia: ${stkItem.jumlah_stok} ${stkItem.satuan}, Diminta: ${qty}).`
            };
          }
          stkItem.jumlah_stok -= qty;
          stockModified = true;
        }
      }

      // 2. Jika tipe_item === 'voucher', otomatis terbitkan voucher Hotspot baru
      if (tipeItem === 'voucher' && hotspotService) {
        const profileId = reqItem.profile_id || (prod && prod.profile_id) || reqItem.product_id;
        const genRes = await hotspotService.generateVouchers(
          tenantId,
          {
            profile_id: profileId,
            qty,
            pembeli: namaPembeli,
            reseller: 'POS Toko',
            status: 'active'
          },
          actor.nama || 'Kasir POS'
        );
        if (genRes && genRes.vouchers) {
          generatedVouchers.push(...genRes.vouchers);
        }
      }

      const itemSubtotal = hargaSatuan * qty;
      subtotal += itemSubtotal;
      totalModal += hargaModal * qty;

      processedItems.push({
        product_id: (prod && prod.id) || reqItem.product_id || 'CUSTOM',
        nama_produk: namaProduk,
        tipe_item: tipeItem,
        qty,
        satuan,
        harga_modal: hargaModal,
        harga_satuan: hargaSatuan,
        subtotal: itemSubtotal
      });
    }

    if (stockModified) {
      writeInventoryStock(stockList, tenantId);
    }

    const diskon = Math.max(0, Number(body.diskon || 0));
    const totalBayar = Math.max(0, subtotal - diskon);
    const uangDiterima = Number(body.uang_diterima !== undefined ? body.uang_diterima : totalBayar);
    const kembalian = Math.max(0, uangDiterima - totalBayar);
    const estimasiLaba = totalBayar - totalModal;

    const todayDate = today ? today(new Date()) : new Date().toISOString().slice(0, 10);
    const nowStr = formatWaktuIndo ? formatWaktuIndo(new Date()) : new Date().toISOString();
    const txList = readPosTransactions(tenantId);
    const seq = String(txList.length + 1).padStart(3, '0');

    const newTx = {
      id: 'POS-' + Date.now(),
      no_nota: `INV-POS-${todayDate.replace(/-/g, '')}-${seq}`,
      tanggal: todayDate,
      waktu: nowStr,
      customer_id: matchedCustomer ? matchedCustomer.customer_id : (body.customer_id || null),
      nama_pembeli: namaPembeli,
      whatsapp_pembeli: whatsappPembeli,
      kasir: actor.nama || 'Kasir',
      role_petugas: actor.role || 'kasir',
      metode_bayar: String(body.metode_bayar || 'Tunai').trim(),
      status: 'completed',
      items: processedItems,
      subtotal,
      diskon,
      total_bayar: totalBayar,
      uang_diterima: uangDiterima,
      kembalian,
      estimasi_laba: estimasiLaba,
      generated_vouchers: generatedVouchers.map((v) => ({
        kode_voucher: v.kode_voucher,
        password: v.password,
        nama_paket: v.nama_paket,
        durasi_label: v.durasi_label
      })),
      catatan: String(body.catatan || '').trim()
    };

    txList.unshift(newTx);
    writePosTransactions(txList, tenantId);

    if (logActivity) {
      logActivity(
        'TRANSAKSI_POS',
        `Penjualan POS ${newTx.no_nota} kepada "${namaPembeli}" senilai ${rupiah ? rupiah(totalBayar) : totalBayar} (${processedItems.length} item)`,
        { kategori: 'Keuangan', target_id: newTx.no_nota }
      );
    }

    return {
      success: true,
      message: `Transaksi POS ${newTx.no_nota} berhasil disimpan.`,
      transaction: newTx
    };
  }

  /**
   * Batalkan (Void) Transaksi POS & Kembalikan Stok Inventaris
   */
  function voidPosTransaction(tenantId, txId, actor = {}) {
    const txList = readPosTransactions(tenantId);
    const tx = txList.find((t) => t.id === txId || t.no_nota === txId);
    if (!tx) return { error: 'Transaksi POS tidak ditemukan.' };
    if (tx.status === 'void') return { error: 'Transaksi POS ini sudah dibatalkan sebelumnya.' };

    // Kembalikan stok barang fisik ke inventory_stock.json
    const stockList = readInventoryStock(tenantId) || [];
    let stockRestored = false;
    for (const item of tx.items || []) {
      if (item.tipe_item === 'inventory') {
        const stk = stockList.find((s) => s.id === item.product_id);
        if (stk) {
          stk.jumlah_stok += Number(item.qty || 1);
          stockRestored = true;
        }
      }
    }
    if (stockRestored) {
      writeInventoryStock(stockList, tenantId);
    }

    tx.status = 'void';
    tx.voided_at = formatWaktuIndo ? formatWaktuIndo(new Date()) : new Date().toISOString();
    tx.voided_by = actor.nama || 'Admin';
    writePosTransactions(txList, tenantId);

    if (logActivity) {
      logActivity('VOID_TRANSAKSI_POS', `Membatalkan nota POS ${tx.no_nota} (${tx.nama_pembeli}) & mengembalikan stok barang`, {
        kategori: 'Keuangan',
        target_id: tx.no_nota
      });
    }

    return {
      success: true,
      message: `Transaksi ${tx.no_nota} berhasil dibatalkan dan stok barang telah dikembalikan.`,
      transaction: tx
    };
  }

  /**
   * Ringkasan Statistik Penjualan POS
   */
  function getPosSummary(tenantId) {
    const txList = readPosTransactions(tenantId);
    const activeTx = txList.filter((t) => t.status !== 'void');
    const todayDate = today ? today(new Date()) : new Date().toISOString().slice(0, 10);
    const currentMonth = todayDate.slice(0, 7);

    const todayTx = activeTx.filter((t) => t.tanggal === todayDate);
    const monthTx = activeTx.filter((t) => String(t.tanggal || '').startsWith(currentMonth));

    const sumTotal = (arr) => arr.reduce((a, b) => a + Number(b.total_bayar || 0), 0);
    const sumProfit = (arr) => arr.reduce((a, b) => a + Number(b.estimasi_laba || 0), 0);

    // Hitung produk terlaris
    const productCountMap = {};
    for (const tx of activeTx) {
      for (const item of tx.items || []) {
        const key = item.nama_produk;
        if (!productCountMap[key]) {
          productCountMap[key] = { nama_produk: key, tipe_item: item.tipe_item, qty_terjual: 0, total_omzet: 0 };
        }
        productCountMap[key].qty_terjual += Number(item.qty || 1);
        productCountMap[key].total_omzet += Number(item.subtotal || 0);
      }
    }
    const topProducts = Object.values(productCountMap).sort((a, b) => b.qty_terjual - a.qty_terjual).slice(0, 5);

    return {
      total_transaksi: activeTx.length,
      total_void: txList.length - activeTx.length,
      omzet_hari_ini: sumTotal(todayTx),
      laba_hari_ini: sumProfit(todayTx),
      transaksi_hari_ini: todayTx.length,
      omzet_bulan_ini: sumTotal(monthTx),
      laba_bulan_ini: sumProfit(monthTx),
      transaksi_bulan_ini: monthTx.length,
      total_omzet_keseluruhan: sumTotal(activeTx),
      top_products: topProducts
    };
  }

  // =========================================================================
  // BAGIAN 2: MODUL LIVE CHAT TERINTEGRASI DATA PELANGGAN
  // =========================================================================

  function seedDefaultChats(customers = []) {
    const nowStr = formatWaktuIndo ? formatWaktuIndo(new Date()) : new Date().toISOString();
    const c1 = customers[0] || {
      id: 1,
      customer_id: 'PLG001',
      nama: 'Budi Santoso',
      whatsapp: '6281234567890',
      wilayah: 'RT 01 / RW 02',
      paket: 'Paket Warga 20 Mbps'
    };
    const c2 = customers[1] || c1;

    return [
      {
        session_id: 'CHAT-' + (c1.customer_id || 'PLG001'),
        customer_id: c1.customer_id || 'PLG001',
        customer_db_id: c1.id || 1,
        nama_pelanggan: c1.nama,
        whatsapp: c1.whatsapp,
        kategori: 'tagihan', // 'tagihan' | 'gangguan' | 'pasang_baru' | 'umum'
        status: 'open', // 'open' | 'pending' | 'resolved'
        assigned_to: 'Kasir & Admin',
        unread_admin: 1,
        unread_client: 0,
        updated_at: nowStr,
        messages: [
          {
            id: 'MSG-101',
            sender_type: 'customer',
            sender_name: c1.nama,
            sender_role: 'pelanggan',
            message: 'Halo kak, saya mau konfirmasi pembayaran tagihan Wi-Fi bulan ini via QRIS DANA ya.',
            waktu: nowStr
          }
        ]
      },
      {
        session_id: 'CHAT-' + (c2.customer_id || 'PLG002'),
        customer_id: c2.customer_id || 'PLG002',
        customer_db_id: c2.id || 2,
        nama_pelanggan: c2.nama,
        whatsapp: c2.whatsapp,
        kategori: 'gangguan',
        status: 'pending',
        assigned_to: 'Rian Pratama (Teknisi Lapangan)',
        unread_admin: 0,
        unread_client: 0,
        updated_at: nowStr,
        messages: [
          {
            id: 'MSG-201',
            sender_type: 'customer',
            sender_name: c2.nama,
            sender_role: 'pelanggan',
            message: 'Siang mas teknisi, lampu indikator LOS di modem ZTE saya kedip merah sejak tadi pagi.',
            waktu: nowStr
          },
          {
            id: 'MSG-202',
            sender_type: 'staff',
            sender_name: 'Rian Pratama (Teknisi Lapangan)',
            sender_role: 'teknisi',
            message: 'Siap Bapak/Ibu, laporan sudah kami terima. Tim teknisi sedang menuju ODP wilayah Anda untuk pengecekan kabel dropcore.',
            waktu: nowStr
          }
        ]
      }
    ];
  }

  function readChats(tenantId) {
    const filePath = getTenantFilePath('live_chats.json', tenantId);
    if (!fs.existsSync(filePath)) {
      const seeded = seedDefaultChats(readDB(tenantId));
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

  function writeChats(data, tenantId) {
    const filePath = getTenantFilePath('live_chats.json', tenantId);
    safeWriteJSON(filePath, data);
  }

  /**
   * Perkaya sesi Live Chat dengan informasi tagihan & jaringan pelanggan secara real-time
   */
  function enrichChatSession(session, customers = []) {
    const cust = customers.find(
      (c) =>
        String(c.customer_id).toUpperCase() === String(session.customer_id).toUpperCase() ||
        Number(c.id) === Number(session.customer_db_id)
    );

    const lastMsg = (session.messages || [])[session.messages.length - 1] || null;
    return {
      ...session,
      last_message: lastMsg ? lastMsg.message : '',
      last_sender: lastMsg ? lastMsg.sender_name : '',
      customer_context: cust
        ? {
            id: cust.id,
            customer_id: cust.customer_id,
            nama: cust.nama,
            whatsapp: cust.whatsapp,
            wilayah: cust.wilayah,
            alamat: cust.alamat,
            paket: cust.paket,
            harga: cust.harga,
            jatuh_tempo: cust.jatuh_tempo,
            status_tagihan: cust.status_tagihan,
            status_jaringan: cust.status_jaringan,
            mikrotikUsername: cust.mikrotikUsername,
            ipAddress: cust.ipAddress,
            olt_port: (cust.device && cust.device.olt_port) || cust.olt_port || '',
            onu_id: (cust.device && cust.device.onu_id) || cust.onu_id || '',
            device_tipe: (cust.device && cust.device.tipe) || '-'
          }
        : null
    };
  }

  function listChatSessions(tenantId, filters = {}) {
    const chats = readChats(tenantId);
    const customers = readDB(tenantId) || [];

    let enriched = chats.map((s) => enrichChatSession(s, customers));

    if (filters.status) {
      enriched = enriched.filter((s) => s.status === filters.status);
    }
    if (filters.kategori) {
      enriched = enriched.filter((s) => s.kategori === filters.kategori);
    }
    if (filters.q) {
      const q = String(filters.q).toLowerCase().trim();
      enriched = enriched.filter(
        (s) =>
          (s.nama_pelanggan || '').toLowerCase().includes(q) ||
          (s.customer_id || '').toLowerCase().includes(q) ||
          (s.last_message || '').toLowerCase().includes(q)
      );
    }

    const totalUnreadAdmin = chats.reduce((acc, s) => acc + Number(s.unread_admin || 0), 0);

    return {
      success: true,
      summary: {
        total_sessions: chats.length,
        open_count: chats.filter((s) => s.status === 'open').length,
        pending_count: chats.filter((s) => s.status === 'pending').length,
        resolved_count: chats.filter((s) => s.status === 'resolved').length,
        total_unread_admin: totalUnreadAdmin
      },
      sessions: enriched
    };
  }

  /**
   * Kirim pesan dari Pelanggan (Portal Mandiri / Widget Live Chat)
   * Dilengkapi Bot Auto-Reply pintar berdasarkan konteks data pelanggan
   */
  function sendCustomerMessage(tenantId, customerIdentifier, payload = {}) {
    const text = String(payload.message || payload.pesan || '').trim();
    if (!text) return { error: 'Isi pesan chat tidak boleh kosong.' };

    const customers = readDB(tenantId) || [];
    const cleanId = String(customerIdentifier || payload.customer_id || '').trim().toUpperCase();
    const cust = customers.find(
      (c) =>
        String(c.customer_id).toUpperCase() === cleanId ||
        String(c.id) === cleanId ||
        String(c.whatsapp) === cleanId
    );

    const custId = cust ? cust.customer_id : (cleanId || 'GUEST-' + String(Date.now()).slice(-4));
    const sessionId = 'CHAT-' + custId;
    const nowStr = formatWaktuIndo ? formatWaktuIndo(new Date()) : new Date().toISOString();

    const chats = readChats(tenantId);
    let session = chats.find((s) => s.session_id === sessionId || s.customer_id === custId);

    // Deteksi otomatis kategori topik pesan
    const lowerText = text.toLowerCase();
    let detectedCategory = payload.kategori || 'umum';
    if (/los|merah|mati|putus|lemot|lambat|gangguan|error/i.test(lowerText)) {
      detectedCategory = 'gangguan';
    } else if (/bayar|tagihan|lunas|qris|transfer|rekening|nota/i.test(lowerText)) {
      detectedCategory = 'tagihan';
    } else if (/pasang|daftar|paket baru/i.test(lowerText)) {
      detectedCategory = 'pasang_baru';
    }

    if (!session) {
      session = {
        session_id: sessionId,
        customer_id: custId,
        customer_db_id: cust ? cust.id : null,
        nama_pelanggan: cust ? cust.nama : (payload.nama || 'Pelanggan'),
        whatsapp: cust ? cust.whatsapp : (payload.whatsapp || ''),
        kategori: detectedCategory,
        status: 'open',
        assigned_to: detectedCategory === 'gangguan' ? 'Tim Teknisi' : 'Kasir & Admin',
        unread_admin: 0,
        unread_client: 0,
        updated_at: nowStr,
        messages: []
      };
      chats.unshift(session);
    }

    const userMsg = {
      id: 'MSG-' + Date.now(),
      sender_type: 'customer',
      sender_name: cust ? cust.nama : session.nama_pelanggan,
      sender_role: 'pelanggan',
      message: text,
      waktu: nowStr
    };

    session.messages.push(userMsg);
    session.status = 'open';
    session.kategori = detectedCategory;
    session.unread_admin = Number(session.unread_admin || 0) + 1;
    session.updated_at = nowStr;

    // Smart Auto-Reply Bot jika pelanggan menanyakan info tagihan secara instan
    let autoBotReply = null;
    if (cust && /cek tagihan|info tagihan|berapa tagihan/i.test(lowerText)) {
      const nominalStr = rupiah ? rupiah(cust.harga) : `Rp ${cust.harga}`;
      autoBotReply = {
        id: 'MSG-BOT-' + (Date.now() + 1),
        sender_type: 'bot',
        sender_name: 'Asisten Otomatis Billing',
        sender_role: 'system',
        message: `Halo Bapak/Ibu ${cust.nama}, status tagihan paket "${cust.paket}" Anda saat ini adalah *${cust.status_tagihan}* (${nominalStr}, Jatuh Tempo: ${cust.jatuh_tempo}). Tim kasir kami akan segera merespons pesan Anda.`,
        waktu: nowStr
      };
      session.messages.push(autoBotReply);
    }

    writeChats(chats, tenantId);

    return {
      success: true,
      session: enrichChatSession(session, customers),
      new_message: userMsg,
      auto_reply: autoBotReply
    };
  }

  /**
   * Kirim Balasan Chat dari Staf (Admin / Kasir / Teknisi) ke Pelanggan
   */
  async function sendStaffReply(tenantId, sessionId, payload = {}, actor = {}) {
    const text = String(payload.message || payload.pesan || '').trim();
    if (!text) return { error: 'Pesan balasan tidak boleh kosong.' };

    const chats = readChats(tenantId);
    const customers = readDB(tenantId) || [];
    const session = chats.find((s) => s.session_id === sessionId || s.customer_id === sessionId);
    if (!session) return { error: 'Sesi percakapan Live Chat tidak ditemukan.' };

    const nowStr = formatWaktuIndo ? formatWaktuIndo(new Date()) : new Date().toISOString();
    const staffMsg = {
      id: 'MSG-' + Date.now(),
      sender_type: 'staff',
      sender_name: actor.nama || 'Admin Support',
      sender_role: actor.role || 'admin',
      message: text,
      waktu: nowStr
    };

    session.messages.push(staffMsg);
    session.unread_admin = 0;
    session.unread_client = Number(session.unread_client || 0) + 1;
    session.updated_at = nowStr;
    if (payload.status && ['open', 'pending', 'resolved'].includes(payload.status)) {
      session.status = payload.status;
    } else if (session.status === 'open') {
      session.status = 'pending';
    }

    writeChats(chats, tenantId);

    // Opsional: Teruskan balasan ke WhatsApp pelanggan jika diminta
    let waForwarded = false;
    let waError = null;
    if (payload.send_wa === true && session.whatsapp && dispatchWaMessage && readSettings) {
      try {
        const settings = readSettings(tenantId);
        if (settings && settings.wa_provider !== 'manual' && settings.api_token) {
          await dispatchWaMessage(session.whatsapp, `*[Live Support RT/RW.net - ${actor.nama || 'Admin'}]*\n\n${text}`, settings);
          waForwarded = true;
        }
      } catch (e) {
        waError = e.message;
      }
    }

    if (logActivity) {
      logActivity(
        'BALAS_LIVE_CHAT',
        `Membalas Live Chat pelanggan ${session.nama_pelanggan} (${session.customer_id})`,
        { kategori: 'Komunikasi', target_id: session.customer_id }
      );
    }

    return {
      success: true,
      session: enrichChatSession(session, customers),
      reply: staffMsg,
      wa_forwarded: waForwarded,
      wa_error: waError
    };
  }

  /**
   * Konversi Keluhan Live Chat menjadi Tiket Gangguan Jaringan pada Data Pelanggan
   */
  function convertChatToTicket(tenantId, sessionId, payload = {}, actor = {}) {
    const chats = readChats(tenantId);
    const customers = readDB(tenantId) || [];
    const session = chats.find((s) => s.session_id === sessionId || s.customer_id === sessionId);
    if (!session) return { error: 'Sesi Live Chat tidak ditemukan.' };

    const cust = customers.find(
      (c) =>
        String(c.customer_id).toUpperCase() === String(session.customer_id).toUpperCase() ||
        Number(c.id) === Number(session.customer_db_id)
    );
    if (!cust) {
      return { error: 'Data pelanggan tidak ditemukan di database untuk dibuatkan tiket gangguan.' };
    }

    const lastCustMsg = [...(session.messages || [])].reverse().find((m) => m.sender_type === 'customer');
    const jenisKendala = String(
      payload.jenis_kendala || (lastCustMsg ? lastCustMsg.message.slice(0, 80) : 'Laporan Gangguan via Live Chat')
    ).trim();
    const teknisi = String(payload.teknisi || actor.nama || 'Tim Teknisi Lapangan').trim();
    const nowStr = formatWaktuIndo ? formatWaktuIndo(new Date()) : new Date().toISOString();
    const tiketId = 'TKT-CHAT-' + String(Date.now()).slice(-5);

    if (!Array.isArray(cust.network_logs)) cust.network_logs = [];
    const newTicket = {
      id: Date.now(),
      tiket_id: tiketId,
      status: 'DOWN',
      jenis_kendala: jenisKendala,
      teknisi,
      status_penanganan: 'Sedang Dikerjakan',
      catatan_perbaikan: `Dikonversi dari Live Chat (${session.session_id}). Keluhan: ${jenisKendala}`,
      waktu: nowStr,
      waktu_selesai: '-',
      durasi: 'Sedang Berlangsung'
    };

    cust.network_logs.unshift(newTicket);
    cust.status_jaringan = cust.status_jaringan === 'Terisolir' ? 'Terisolir / Gangguan' : 'Gangguan';
    cust.catatan_kendala = jenisKendala;
    writeDB(customers, tenantId);

    // Tambahkan pesan sistem ke ruang chat bahwa tiket telah dibuat
    session.status = 'pending';
    session.kategori = 'gangguan';
    session.assigned_to = teknisi;
    session.updated_at = nowStr;
    session.messages.push({
      id: 'MSG-SYS-' + Date.now(),
      sender_type: 'system',
      sender_name: 'Sistem Tiket Jaringan',
      sender_role: 'system',
      message: `🛠️ Tiket Gangguan *${tiketId}* telah dibuat dan ditugaskan kepada *${teknisi}*. Status jaringan pelanggan diperbarui menjadi "${cust.status_jaringan}".`,
      waktu: nowStr
    });
    writeChats(chats, tenantId);

    if (logActivity) {
      logActivity(
        'KONVERSI_CHAT_KE_TIKET',
        `Mengonversi sesi Live Chat ${session.nama_pelanggan} (${cust.customer_id}) menjadi Tiket Gangguan ${tiketId}`,
        { kategori: 'Jaringan', target_id: cust.customer_id }
      );
    }

    return {
      success: true,
      message: `Percakapan berhasil dikonversi menjadi Tiket Gangguan ${tiketId}.`,
      ticket: newTicket,
      customer: cust,
      session: enrichChatSession(session, customers)
    };
  }

  return {
    // POS
    readPosTransactions,
    writePosTransactions,
    getPosCatalog,
    createPosTransaction,
    voidPosTransaction,
    getPosSummary,
    // Live Chat
    readChats,
    writeChats,
    listChatSessions,
    sendCustomerMessage,
    sendStaffReply,
    convertChatToTicket,
    enrichChatSession
  };
}

module.exports = {
  DEFAULT_SERVICE_PRODUCTS,
  createPosAndChatService
};

