'use strict';
/**
 * MODUL RBAC (Role-Based Access Control) - BayarWifi 3.0 Alignment
 *
 * Mengatur hak akses menu, tombol aksi UI, dan proteksi endpoint API untuk:
 * 1. superadmin : Akses penuh multi-tenant pusat & seluruh fitur operasional.
 * 2. admin      : Pemilik / Juragan WiFi (akses penuh di dalam tenant-nya).
 * 3. kasir      : Fokus penagihan, pembayaran tagihan, kas/pengeluaran, POS/Toko,
 *                 penjualan voucher hotspot, broadcast/reminder WA, & Live Chat.
 * 4. teknisi    : Fokus manajemen jaringan, MikroTik, OLT, pelacakan pelanggan offline,
 *                 isolir/buka isolir, tiket gangguan, perangkat ONT, stok material, & Live Chat.
 */

const VALID_ROLES = ['superadmin', 'admin', 'kasir', 'teknisi'];

const ROLE_DEFINITIONS = {
  superadmin: {
    role: 'superadmin',
    label: 'Super Admin Pusat',
    badge: '👑 Super Admin',
    allowed_menus: [
      'navDashboard',
      'navCustomers',
      'btnGenerate',
      'btnAutoIsolir',
      'btnPackages',
      'btnInventoryStock',
      'btnExpenses',
      'btnBankAccounts',
      'btnBroadcast',
      'btnBulkReminder',
      'btnSettings',
      'btnSuperAdmin',
      'btnActivityLogs',
      'btnSyncMikrotik',
      'btnRouterDetail',
      'btnOltBatchCheck',
      'btnAddCustomerTop'
    ],
    hidden_menus: [],
    allowed_customer_actions: [
      'edit',
      'delete',
      'pay_qris',
      'toggle_lunas',
      'history',
      'send_wa',
      'toggle_isolir',
      'mikrotik_sync',
      'catat_gangguan',
      'device_manage',
      'olt_check'
    ],
    modules: {
      dashboard_finance: true,
      customers_billing: true,
      customers_network: true,
      packages: true,
      inventory_stock: true,
      expenses: true,
      bank_accounts: true,
      whatsapp_broadcast: true,
      whatsapp_settings: true,
      mikrotik_router: true,
      olt_optical: true,
      hotspot_voucher: true,
      offline_tracker: true,
      pos_store: true,
      live_chat: true,
      staff_users: true,
      tenant_master: true
    }
  },

  admin: {
    role: 'admin',
    label: 'Admin / Juragan',
    badge: '🛡️ Admin',
    allowed_menus: [
      'navDashboard',
      'navCustomers',
      'btnGenerate',
      'btnAutoIsolir',
      'btnPackages',
      'btnInventoryStock',
      'btnExpenses',
      'btnBankAccounts',
      'btnBroadcast',
      'btnBulkReminder',
      'btnSettings',
      'btnActivityLogs',
      'btnSyncMikrotik',
      'btnRouterDetail',
      'btnOltBatchCheck',
      'btnAddCustomerTop'
    ],
    hidden_menus: ['btnSuperAdmin'],
    allowed_customer_actions: [
      'edit',
      'delete',
      'pay_qris',
      'toggle_lunas',
      'history',
      'send_wa',
      'toggle_isolir',
      'mikrotik_sync',
      'catat_gangguan',
      'device_manage',
      'olt_check'
    ],
    modules: {
      dashboard_finance: true,
      customers_billing: true,
      customers_network: true,
      packages: true,
      inventory_stock: true,
      expenses: true,
      bank_accounts: true,
      whatsapp_broadcast: true,
      whatsapp_settings: true,
      mikrotik_router: true,
      olt_optical: true,
      hotspot_voucher: true,
      offline_tracker: true,
      pos_store: true,
      live_chat: true,
      staff_users: true,
      tenant_master: false
    }
  },

  kasir: {
    role: 'kasir',
    label: 'Kasir & Layanan Pelanggan',
    badge: '💼 Kasir',
    allowed_menus: [
      'navDashboard',
      'navCustomers',
      'btnGenerate',
      'btnPackages',
      'btnExpenses',
      'btnBankAccounts',
      'btnBroadcast',
      'btnBulkReminder',
      'btnActivityLogs',
      'btnAddCustomerTop'
    ],
    hidden_menus: [
      'btnSuperAdmin',
      'btnAutoIsolir',
      'btnInventoryStock',
      'btnSettings',
      'btnSyncMikrotik',
      'btnRouterDetail',
      'btnOltBatchCheck'
    ],
    allowed_customer_actions: [
      'edit',
      'pay_qris',
      'toggle_lunas',
      'history',
      'send_wa'
    ],
    modules: {
      dashboard_finance: true,
      customers_billing: true,
      customers_network: false,
      packages: true,
      inventory_stock: false,
      expenses: true,
      bank_accounts: true,
      whatsapp_broadcast: true,
      whatsapp_settings: false,
      mikrotik_router: false,
      olt_optical: false,
      hotspot_voucher: true,
      offline_tracker: false,
      pos_store: true,
      live_chat: true,
      staff_users: false,
      tenant_master: false
    }
  },

  teknisi: {
    role: 'teknisi',
    label: 'Teknisi Jaringan & Lapangan',
    badge: '🛠️ Teknisi',
    allowed_menus: [
      'navCustomers',
      'btnAutoIsolir',
      'btnPackages',
      'btnInventoryStock',
      'btnActivityLogs',
      'btnSyncMikrotik',
      'btnRouterDetail',
      'btnOltBatchCheck',
      'btnAddCustomerTop'
    ],
    hidden_menus: [
      'btnSuperAdmin',
      'btnGenerate',
      'btnExpenses',
      'btnBankAccounts',
      'btnBroadcast',
      'btnBulkReminder',
      'btnSettings'
    ],
    allowed_customer_actions: [
      'edit',
      'history',
      'send_wa',
      'toggle_isolir',
      'mikrotik_sync',
      'catat_gangguan',
      'device_manage',
      'olt_check'
    ],
    modules: {
      dashboard_finance: false,
      customers_billing: false,
      customers_network: true,
      packages: true,
      inventory_stock: true,
      expenses: false,
      bank_accounts: false,
      whatsapp_broadcast: false,
      whatsapp_settings: false,
      mikrotik_router: true,
      olt_optical: true,
      hotspot_voucher: true,
      offline_tracker: true,
      pos_store: false,
      live_chat: true,
      staff_users: false,
      tenant_master: false
    }
  }
};

function normalizeRole(role) {
  const r = String(role || 'admin').toLowerCase().trim();
  return VALID_ROLES.includes(r) ? r : 'admin';
}

function getRolePermissions(role) {
  const norm = normalizeRole(role);
  return ROLE_DEFINITIONS[norm] || ROLE_DEFINITIONS.admin;
}

/**
 * Middleware Express untuk memeriksa apakah role user diizinkan mengakses endpoint tertentu.
 */
function requireRoles(...allowedRoles) {
  const normalizedAllowed = allowedRoles.map((r) => String(r).toLowerCase().trim());
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Sesi login tidak valid. Silakan login kembali.',
        code: 'UNAUTHORIZED'
      });
    }
    const userRole = normalizeRole(req.user.role);
    if (userRole === 'superadmin' || normalizedAllowed.includes(userRole)) {
      return next();
    }
    const roleDef = getRolePermissions(userRole);
    return res.status(403).json({
      error: `Akses ditolak: Peran "${roleDef.label}" tidak memiliki izin untuk melakukan tindakan ini.`,
      code: 'FORBIDDEN_ROLE',
      role: userRole,
      required_roles: normalizedAllowed
    });
  };
}

/**
 * Middleware global penjaga rute API berdasarkan matriks Role (Kasir vs Teknisi vs Admin).
 * Dipasang setelah autentikasi sesi sehingga melindungi rute eksisting tanpa merusak struktur.
 */
function routeAccessGuard(req, res, next) {
  if (!req.user) return next();
  const role = normalizeRole(req.user.role);
  if (role === 'superadmin' || role === 'admin') return next();

  const method = req.method.toUpperCase();
  const pathStr = req.path;

  // Pembatasan khusus untuk Role KASIR
  if (role === 'kasir') {
    // Kasir tidak boleh mengubah konfigurasi jaringan MikroTik / OLT, isolir teknis, atau hapus pelanggan
    if (
      pathStr.startsWith('/api/mikrotik/config') ||
      pathStr.startsWith('/api/mikrotik/sync') ||
      pathStr.startsWith('/api/mikrotik/isolate') ||
      pathStr.startsWith('/api/mikrotik/restore') ||
      pathStr.startsWith('/api/network-config') ||
      pathStr.startsWith('/api/olt/test-connection') ||
      (pathStr.endsWith('/olt-mapping') && method === 'PATCH') ||
      (pathStr.endsWith('/jaringan') && method === 'PATCH') ||
      (pathStr === '/api/customers/auto-isolir' && method === 'POST') ||
      (pathStr.startsWith('/api/customers/') && method === 'DELETE' && !pathStr.includes('/network-logs/')) ||
      (pathStr === '/api/settings' && method === 'POST') ||
      (pathStr === '/api/activity-logs/clear' && method === 'DELETE')
    ) {
      return res.status(403).json({
        error: 'Akses Ditolak: Kasir tidak diizinkan mengubah konfigurasi teknis jaringan, isolir router, atau menghapus data pelanggan.',
        code: 'FORBIDDEN_ROLE'
      });
    }
  }

  // Pembatasan khusus untuk Role TEKNISI
  if (role === 'teknisi') {
    // Teknisi tidak boleh mengubah status pembayaran Lunas/Belum Lunas, buat tagihan, kelola kas/rekening bank, atau hapus pelanggan
    if (
      (pathStr.endsWith('/status') && pathStr.startsWith('/api/customers/') && method === 'PATCH') ||
      (pathStr === '/api/generate-tagihan' && method === 'POST') ||
      (pathStr.startsWith('/api/expenses') && method !== 'GET') ||
      (pathStr.startsWith('/api/bank-accounts') && method !== 'GET') ||
      (pathStr.startsWith('/api/packages') && method !== 'GET') ||
      (pathStr.startsWith('/api/customers/') && method === 'DELETE' && !pathStr.includes('/network-logs/')) ||
      (pathStr === '/api/settings' && method === 'POST') ||
      (pathStr === '/api/activity-logs/clear' && method === 'DELETE')
    ) {
      return res.status(403).json({
        error: 'Akses Ditolak: Teknisi tidak diizinkan mengubah status pembayaran tagihan, mengelola kas keuangan, atau menghapus pelanggan.',
        code: 'FORBIDDEN_ROLE'
      });
    }
  }

  return next();
}

module.exports = {
  VALID_ROLES,
  ROLE_DEFINITIONS,
  normalizeRole,
  getRolePermissions,
  requireRoles,
  routeAccessGuard
};

