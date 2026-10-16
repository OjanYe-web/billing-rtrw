'use strict';
/**
 * MODUL 3 - Integrasi OLT (monitoring redaman optik & status LOS)
 * Mendukung teknologi EPON dan GPON via SSH (`ssh2`) maupun TELNET (`net`).
 *
 * Vendor / Profil OLT yang didukung:
 *   - 'epon' / 'vsol' / 'hioso' / 'bdcom' / 'hsqg' / 'cdata' : OLT EPON / GPON tipe compact (pizza box)
 *   - 'zte' / 'zte_gpon' : ZTE GPON C300 / C320
 *   - 'zte_epon'         : ZTE EPON C300 / C320
 *   - 'huawei'           : Huawei GPON MA56xx / MA58xx
 *
 * Protokol yang didukung:
 *   - 'ssh'    : Port default 22
 *   - 'telnet' : Port default 23 (sangat umum pada OLT EPON compact)
 *
 * Pemetaan pelanggan -> ONU:
 *   olt_port : "0/1" atau "1/1/1" atau "epon0/1"
 *   onu_id   : nomor ONU (1..128)
 */

const net = require('net');
const { Client: SshClient } = require('ssh2');
const tenantConfig = require('./tenantConfig');

const log = (...args) => console.log('[olt]', ...args);

// ---------------------------------------------------------------------------
// Antrian per tenant (serialisasi koneksi ke OLT)
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
// Validasi & Sanitasi Port & ONU ID
// ---------------------------------------------------------------------------
function sanitizeOnu(port, onuId) {
  let p = String(port || '').trim().toLowerCase();
  // Hilangkan prefix "epon", "gpon", atau spasi
  p = p.replace(/^(epon|gpon)[\s_]*/i, '');
  const id = Number(onuId);

  // Menerima format "0/1", "0/1/1", atau "1/2/3"
  if (!/^\d{1,2}(?:\/\d{1,2}){1,2}$/.test(p)) {
    return { error: 'Format olt_port tidak valid. Gunakan "slot/port" (misal 0/1) atau "rack/shelf/slot" (misal 1/1/1).' };
  }
  if (!Number.isInteger(id) || id < 1 || id > 255) {
    return { error: 'onu_id harus bilangan bulat 1-255.' };
  }
  return { port: p, onuId: id };
}

// ---------------------------------------------------------------------------
// Perintah per Vendor & Mode (EPON / GPON)
// ---------------------------------------------------------------------------
function buildCommands(cfg, port, onuId) {
  const vendor = String(cfg.vendor || 'epon').toLowerCase();

  // 1. Huawei GPON
  if (vendor === 'huawei') {
    const parts = port.split('/');
    const frame = parts[0] || '0';
    const slot = parts[1] || '1';
    const pon = parts[2] || '1';
    const cmds = ['enable'];
    if (cfg.enable_pass) cmds.push(cfg.enable_pass);
    cmds.push(
      'config',
      `display ont info ${frame} ${slot} ${pon} ${onuId}`,
      `interface gpon ${frame}/${slot}`,
      `display ont optical-info ${pon} ${onuId}`,
      'quit',
      'quit'
    );
    return { commands: cmds, infoIndex: cfg.enable_pass ? 3 : 2, opticalIndex: cfg.enable_pass ? 5 : 4 };
  }

  // 2. ZTE EPON (C300 / C320 Card EPON)
  if (vendor === 'zte_epon') {
    return {
      commands: [
        'terminal length 0',
        `show epon onu detail-info epon-onu_${port}:${onuId}`,
        `show pon power attenuation epon-onu_${port}:${onuId}`
      ],
      infoIndex: 1,
      opticalIndex: 2
    };
  }

  // 3. ZTE GPON
  if (vendor === 'zte' || vendor === 'zte_gpon') {
    return {
      commands: [
        'terminal length 0',
        `show gpon onu detail-info gpon-onu_${port}:${onuId}`,
        `show pon power attenuation gpon-onu_${port}:${onuId}`
      ],
      infoIndex: 1,
      opticalIndex: 2
    };
  }

  // 4. Standar OLT EPON Compact (VSOL, HIOSO, BDCOM, HSQG, C-Data, Generic EPON)
  // Perintah universal yang didukung oleh firmware EPON populer:
  const cmds = ['enable'];
  if (cfg.enable_pass) cmds.push(cfg.enable_pass);
  cmds.push(
    'terminal length 0',
    // Cek informasi & redaman ONU:
    `show epon optical-transceiver-diagnosis interface epon ${port}:${onuId}`,
    `show onu opm-diag epon ${port}:${onuId}`,
    `show epon onu-information interface epon ${port}:${onuId}`
  );
  return {
    commands: cmds,
    infoIndex: cmds.length - 1,
    opticalIndex: cmds.length - 3, // Perintah diagnosis optik utama
    fallbackOpticalIndex: cmds.length - 2
  };
}

// ---------------------------------------------------------------------------
// Parser output CLI
// ---------------------------------------------------------------------------
const num = (m) => (m ? Number(m) : null);

function parseEponGeneric(infoOut = '', opticalOut = '') {
  let onuRx = null;
  let onuTx = null;
  let oltRx = null;
  let oltTx = null;

  const combined = opticalOut + '\n' + infoOut;

  // Tangkap OLT Rx terlebih dahulu agar tidak tertukar dengan ONU Rx
  const mOltRx = combined.match(/(?:OLT\s*Rx\s*Optical\s*Power|OLT\s*Rx(?:\s*ONT)?|OLT\s*Receive\s*Power|OLT\s*Optical\s*Power\s*Rx)\s*\(?(?:dBm)?\)?\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  if (mOltRx) oltRx = num(mOltRx[1]);

  // Regex fleksibel penangkap nilai ONU Rx/Tx:
  const mRx = combined.match(/(?:^|[^\w])(?:Rx\s*Optical\s*Power|Rx\s*Power|Receive\s*Power|ONU\s*Rx|Optical\s*Power\s*Rx)\s*\(?(?:dBm)?\)?\s*[:=]\s*(-?\d+(?:\.\d+)?)/im);
  const mTx = combined.match(/(?:Tx\s*Optical\s*Power|Tx\s*Power|Transmit\s*Power|ONU\s*Tx|Optical\s*Power\s*Tx)\s*\(?(?:dBm)?\)?\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);

  if (mRx) onuRx = num(mRx[1]);
  if (mTx) onuTx = num(mTx[1]);

  // Cek format tabel kolom sederhana: "epon0/1:1  -18.42  2.15"
  if (onuRx === null) {
    const tableMatch = combined.match(/:\d+\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)/);
    if (tableMatch) {
      onuRx = num(tableMatch[1]);
      onuTx = num(tableMatch[2]);
    }
  }

  // Deteksi status koneksi ONU
  let state = 'unknown';
  if (/\b(online|registered|up|authenticated|auth)\b/i.test(combined)) state = 'online';
  else if (/\b(los|loss\s+of\s+signal|link\s*down)\b/i.test(combined)) state = 'los';
  else if (/\b(offline|down|deregistered|lost)\b/i.test(combined)) state = 'offline';

  // Sebab disconnect jika ada
  let cause = null;
  const causeMatch = combined.match(/(?:Deregister\s*reason|Offline\s*reason|Down\s*cause|Last\s*dereg\s*reason)\s*[:=]\s*([^\r\n]+)/i);
  if (causeMatch) cause = causeMatch[1].trim();

  return {
    state,
    last_down_cause: cause,
    onu_rx_dbm: onuRx,
    onu_tx_dbm: onuTx,
    olt_rx_dbm: oltRx,
    olt_tx_dbm: oltTx,
    attenuation_db: null
  };
}

function parseZte(infoOut = '', opticalOut = '') {
  let onuRx = null;
  let onuTx = null;
  let oltRx = null;
  let oltTx = null;

  const mRx = opticalOut.match(/(?:Rx optical power|Rx\s+power|ONU\s+Rx)\s*:\s*(-?\d+(?:\.\d+)?)/i);
  const mTx = opticalOut.match(/(?:Tx optical power|Tx\s+power|ONU\s+Tx)\s*:\s*(-?\d+(?:\.\d+)?)/i);
  const mOltRx = opticalOut.match(/(?:OLT\s+Rx(?:\s+ONT)?\s*(?:optical\s+power)?)\s*:\s*(-?\d+(?:\.\d+)?)/i);

  if (mRx) onuRx = num(mRx[1]);
  if (mTx) onuTx = num(mTx[1]);
  if (mOltRx) oltRx = num(mOltRx[1]);

  const up = opticalOut.match(/up\s+Rx\s*:\s*(-?\d+(?:\.\d+)?)\s*\(?dbm\)?\s+Tx\s*:\s*(-?\d+(?:\.\d+)?)/i);
  const down = opticalOut.match(/down\s+Tx\s*:\s*(-?\d+(?:\.\d+)?)\s*\(?dbm\)?\s+Rx\s*:\s*(-?\d+(?:\.\d+)?)/i);
  if (up) {
    if (oltRx === null) oltRx = num(up[1]);
    if (onuTx === null) onuTx = num(up[2]);
  }
  if (down) {
    if (oltTx === null) oltTx = num(down[1]);
    if (onuRx === null) onuRx = num(down[2]);
  }

  const att = [...opticalOut.matchAll(/(\d+(?:\.\d+)?)\s*\(?dB\)?/gi)].map((m) => Number(m[1]));
  const phase = infoOut.match(/Phase state\s*:\s*([A-Za-z\-]+)/i);
  const stateMatch = infoOut.match(/(?:^|\n)\s*State\s*:\s*([A-Za-z\-]+)/i);
  const causeMatch = infoOut.match(/(?:Deregister reason|Offline reason|Last down cause)\s*:\s*([^\r\n]+)/i);

  return {
    state: phase ? phase[1] : (stateMatch ? stateMatch[1] : null),
    last_down_cause: causeMatch ? causeMatch[1].trim() : null,
    onu_rx_dbm: onuRx,
    onu_tx_dbm: onuTx,
    olt_rx_dbm: oltRx,
    olt_tx_dbm: oltTx,
    attenuation_db: att.length ? att[att.length - 1] : null
  };
}

function parseHuawei(infoOut = '', opticalOut = '') {
  const grab = (re, s) => { const m = s.match(re); return m ? num(m[1]) : null; };
  const run = infoOut.match(/Run state\s*:\s*([A-Za-z\-]+)/i);
  const cause = infoOut.match(/Last down cause\s*:\s*([^\r\n]+)/i);
  return {
    state: run ? run[1] : null,
    last_down_cause: cause ? cause[1].trim() : null,
    onu_rx_dbm: grab(/(?:ONT optical power|Rx optical power)\s*\(dBm\)?\s*:\s*(-?\d+(?:\.\d+)?)/i, opticalOut),
    onu_tx_dbm: grab(/(?:Tx optical power)\s*\(dBm\)?\s*:\s*(-?\d+(?:\.\d+)?)/i, opticalOut),
    olt_rx_dbm: grab(/OLT (?:Rx ONT )?optical power\(dBm\)\s*:\s*(-?\d+(?:\.\d+)?)/i, opticalOut),
    olt_tx_dbm: null,
    attenuation_db: null
  };
}

function parseOltOutput(cfg, infoOut, opticalOut) {
  const vendor = String(cfg.vendor || '').toLowerCase();
  if (vendor === 'huawei') return parseHuawei(infoOut, opticalOut);
  if (vendor === 'zte' || vendor === 'zte_gpon' || vendor === 'zte_epon') return parseZte(infoOut, opticalOut);
  return parseEponGeneric(infoOut, opticalOut);
}

// ---------------------------------------------------------------------------
// Klasifikasi Redaman & Kondisi Kabel
// ---------------------------------------------------------------------------
function classify(parsed, cfg) {
  const state = String(parsed.state || '').toLowerCase();
  const cause = String(parsed.last_down_cause || '').toLowerCase();
  const rx = parsed.onu_rx_dbm;

  let level = 'unknown';
  let label = 'Tidak diketahui';

  if (state === 'los' || (/^(offline|logging)$/.test(state) && /\blos\b/.test(cause))) {
    level = 'los'; label = 'LOS - sinyal optik hilang (kabel putus / konektor lepas)';
  } else if (/^(offline|dyinggasp|dying-gasp|logging)$/.test(state)) {
    level = 'offline'; label = /dying/.test(state) || /dying/.test(cause) ? 'Offline - ONU mati listrik (dying gasp)' : 'Offline';
  } else if (/^(working|online|registered|up)$/.test(state) || state === '') {
    if (rx === null || rx === undefined) {
      level = state ? 'unknown' : 'unknown'; label = 'Online, daya Rx tidak terbaca';
    } else if (rx <= cfg.rx_critical_dbm) {
      level = 'critical'; label = `Redaman kritis (Rx ${rx} dBm <= ${cfg.rx_critical_dbm})`;
    } else if (rx <= cfg.rx_warning_dbm) {
      level = 'warning'; label = `Redaman tinggi (Rx ${rx} dBm <= ${cfg.rx_warning_dbm})`;
    } else {
      level = 'normal'; label = `Normal (Rx ${rx} dBm)`;
    }
  }
  return { level, label, is_fault: level === 'los' || level === 'critical' };
}

// ---------------------------------------------------------------------------
// Pembersih Karakter Escape / VT100
// ---------------------------------------------------------------------------
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
function cleanOutput(s) {
  return s
    .replace(ANSI, '')
    .replace(/\x08+/g, '')
    .replace(/-{2,}\s*More[^\r\n]*?-{2,}/gi, '')
    .replace(/--More--/gi, '')
    .replace(/\r/g, '');
}

// ---------------------------------------------------------------------------
// DRIVER KONEKSI: SSH (ssh2) & TELNET (net)
// ---------------------------------------------------------------------------

function connectOptions(cfg, legacy) {
  const opts = {
    host: cfg.host,
    port: cfg.port || 22,
    username: cfg.user,
    password: cfg.pass,
    readyTimeout: cfg.timeout * 1000,
    tryKeyboard: true
  };
  if (legacy) {
    opts.algorithms = {
      kex: { append: ['diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1'] },
      cipher: { append: ['aes128-cbc', 'aes192-cbc', 'aes256-cbc', '3des-cbc'] },
      serverHostKey: { append: ['ssh-rsa', 'ssh-dss'] }
    };
  }
  return opts;
}

function sshConnect(cfg) {
  const attempt = (legacy) => new Promise((resolve, reject) => {
    const conn = new SshClient();
    let settled = false;
    const fail = (e) => { if (!settled) { settled = true; try { conn.end(); } catch (_) {} reject(e); } };
    conn.on('ready', () => { if (!settled) { settled = true; resolve(conn); } });
    conn.on('error', fail);
    conn.on('keyboard-interactive', (_n, _i, _l, _p, finish) => finish([cfg.pass]));
    try {
      conn.connect(connectOptions(cfg, legacy));
    } catch (e) {
      fail(e);
    }
  });

  return attempt(cfg.legacy_algorithms).catch((e) => {
    if (cfg.legacy_algorithms && /Unsupported algorithm/i.test(String(e && e.message))) return attempt(false);
    throw e;
  });
}

/** Jalankan perintah via SSH */
async function runCommandsSsh(conn, commands, { timeoutMs = 30000, idleMs = 1000 } = {}) {
  const stream = await new Promise((resolve, reject) => {
    conn.shell({ term: 'vt100', cols: 220, rows: 5000 }, (err, s) => (err ? reject(err) : resolve(s)));
  });

  let buffer = '';
  let lastData = Date.now();
  stream.on('data', (d) => {
    const chunk = d.toString('utf8');
    buffer += chunk;
    lastData = Date.now();
    if (/more/i.test(chunk.slice(-60)) && /--/.test(chunk.slice(-60))) stream.write(' ');
  });

  const deadline = Date.now() + timeoutMs;
  const waitIdle = async (idle, minWait = 250) => {
    const start = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 100));
      const now = Date.now();
      if (now > deadline) throw new Error('Timeout menunggu respons OLT (SSH)');
      if (now - start >= minWait && now - lastData >= idle) return;
    }
  };

  await waitIdle(800, 300);
  const outputs = [];
  for (const cmd of commands) {
    const mark = buffer.length;
    stream.write(cmd + '\n');
    await waitIdle(idleMs);
    outputs.push(cleanOutput(buffer.slice(mark)));
  }
  try { stream.end('exit\n'); } catch (_) {}
  return outputs;
}

/** Jalankan sesi Telnet otomatis (autologin user/pass & eksekusi perintah) */
function runCommandsTelnet(cfg, commands, { timeoutMs = 30000, idleMs = 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    let lastData = Date.now();
    let loggedIn = false;
    let step = 0; // 0 = wait user, 1 = wait pass, 2 = logged in
    let settled = false;

    const cleanup = () => {
      try { socket.destroy(); } catch (_) {}
    };

    const fail = (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => fail(new Error('Timeout koneksi Telnet ke OLT')));
    socket.on('error', fail);

    socket.connect(cfg.port || 23, cfg.host, () => {
      // Terhubung, tunggu prompt Login/Username
    });

    socket.on('data', (data) => {
      // Tangani opsi negosiasi Telnet dasar (IAC DO/DONT/WILL/WONT)
      let raw = data;
      const iacIndex = raw.indexOf(255);
      if (iacIndex !== -1) {
        // Balas telnet IAC jika diminta terminal type/echo
        for (let i = 0; i < raw.length; i++) {
          if (raw[i] === 255 && i + 2 < raw.length) {
            const cmd = raw[i + 1];
            const opt = raw[i + 2];
            if (cmd === 253) socket.write(Buffer.from([255, 252, opt])); // DO -> WONT
            else if (cmd === 251) socket.write(Buffer.from([255, 254, opt])); // WILL -> DONT
            i += 2;
          }
        }
      }

      const chunk = raw.toString('utf8');
      buffer += chunk;
      lastData = Date.now();

      // Jika ada pagination "--More--" kirim spasi
      if (/--\s*More\s*--/i.test(chunk)) socket.write(' ');

      // Otomasi Login Telnet
      if (!loggedIn) {
        const lower = buffer.toLowerCase();
        if (step === 0 && /(username|login)\s*:/i.test(lower)) {
          step = 1;
          socket.write(cfg.user + '\r\n');
        } else if (step <= 1 && /password\s*:/i.test(lower)) {
          step = 2;
          socket.write(cfg.pass + '\r\n');
          setTimeout(() => {
            loggedIn = true;
            executeSession();
          }, 800);
        }
      }
    });

    async function executeSession() {
      try {
        const outputs = [];
        const waitIdle = async (idle, minWait = 250) => {
          const start = Date.now();
          for (;;) {
            await new Promise((r) => setTimeout(r, 100));
            const now = Date.now();
            if (now - start >= timeoutMs) throw new Error('Timeout saat membaca perintah Telnet');
            if (now - start >= minWait && now - lastData >= idle) return;
          }
        };

        await waitIdle(600, 300);

        for (const cmd of commands) {
          const mark = buffer.length;
          socket.write(cmd + '\r\n');
          await waitIdle(idleMs);
          outputs.push(cleanOutput(buffer.slice(mark)));
        }

        try { socket.write('exit\r\n'); } catch (_) {}
        setTimeout(() => {
          if (!settled) {
            settled = true;
            cleanup();
            resolve(outputs);
          }
        }, 300);
      } catch (e) {
        fail(e);
      }
    }
  });
}

function describeError(err) {
  const msg = String((err && err.message) || err || 'Kesalahan tidak diketahui');
  if (/All configured authentication methods failed/i.test(msg)) return 'Login SSH ditolak: username/password OLT salah.';
  if (/ECONNREFUSED/i.test(msg)) return 'Koneksi ditolak: periksa apakah port SSH/Telnet sudah aktif di OLT.';
  if (/Timed out while waiting for handshake|ETIMEDOUT|Timeout/i.test(msg)) return 'Timeout: OLT tidak merespons (periksa IP, port, firewall/VLAN).';
  if (/EHOSTUNREACH|ENETUNREACH|ENOTFOUND/i.test(msg)) return 'OLT tidak dapat dijangkau dari server billing.';
  if (/no matching (key exchange|cipher|host key)/i.test(msg) || /Handshake failed/i.test(msg)) return 'Negosiasi algoritma SSH gagal (OLT versi lama/baru). Cek opsi legacy_algorithms atau gunakan Telnet.';
  return msg;
}

const simulatedResult = (extra = {}) => ({
  success: true,
  simulated: true,
  message: 'Mode simulasi: koneksi OLT untuk tenant ini belum diaktifkan (tenants.json > olt.enabled).',
  ...extra
});

/** Eksekusi aman (mencegah benturan sesi interaktif) */
function runSafe(tenantId, fn, override = null) {
  return enqueue(tenantId, async () => {
    const cfg = override
      ? tenantConfig.normalizeOlt({ ...override, enabled: true })
      : tenantConfig.getOltConfig(tenantId);

    if (!tenantConfig.isOltLive(cfg)) return simulatedResult();

    try {
      if (cfg.protocol === 'telnet') {
        const executor = (commands, opts) => runCommandsTelnet(cfg, commands, opts);
        return await fn({ type: 'telnet', executor }, cfg);
      } else {
        // SSH
        const conn = await sshConnect(cfg);
        conn.on('error', () => {});
        try {
          const executor = (commands, opts) => runCommandsSsh(conn, commands, opts);
          return await fn({ type: 'ssh', executor }, cfg);
        } finally {
          try { conn.end(); } catch (_) {}
        }
      }
    } catch (err) {
      const message = describeError(err);
      log(`[${tenantId || 'default'}] gagal: ${message}`);
      return { success: false, simulated: false, error: message };
    }
  });
}

// ---------------------------------------------------------------------------
// Pembacaan ONU & Diagnosis Optik
// ---------------------------------------------------------------------------
async function readOnu(session, cfg, port, onuId, withRaw = false) {
  const cmdObj = buildCommands(cfg, port, onuId);
  const outs = await session.executor(cmdObj.commands, { timeoutMs: (cfg.timeout + 15) * 1000 });

  const infoOut = outs[cmdObj.infoIndex] || '';
  let opticalOut = outs[cmdObj.opticalIndex] || '';
  if (cmdObj.fallbackOpticalIndex && !opticalOut.trim()) {
    opticalOut = outs[cmdObj.fallbackOpticalIndex] || '';
  }

  const parsed = parseOltOutput(cfg, infoOut, opticalOut);
  const verdict = classify(parsed, cfg);

  const result = {
    success: true,
    simulated: false,
    vendor: cfg.vendor,
    protocol: cfg.protocol,
    olt_port: port,
    onu_id: onuId,
    state: parsed.state,
    last_down_cause: parsed.last_down_cause,
    onu_rx_dbm: parsed.onu_rx_dbm,
    onu_tx_dbm: parsed.onu_tx_dbm,
    olt_rx_dbm: parsed.olt_rx_dbm,
    attenuation_db: parsed.attenuation_db,
    ...verdict,
    checked_at: new Date().toISOString()
  };
  if (withRaw) result.raw = { info: infoOut, optical: opticalOut };
  return result;
}

// ---------------------------------------------------------------------------
// API Publik
// ---------------------------------------------------------------------------
const isLive = (tenantId) => tenantConfig.isOltLive(tenantConfig.getOltConfig(tenantId));

/** Tes koneksi OLT (SSH atau Telnet) */
function testConnection(tenantId, override = null) {
  return runSafe(tenantId, async (session, cfg) => {
    let testCmd = 'show version';
    if (cfg.vendor === 'huawei') testCmd = 'display version';
    else if (cfg.vendor === 'zte' || cfg.vendor === 'zte_gpon' || cfg.vendor === 'zte_epon') testCmd = 'show version-running';

    const outs = await session.executor(['terminal length 0', testCmd], { timeoutMs: 15000 });
    const out = (outs[outs.length - 1] || '').trim();

    return {
      success: true,
      simulated: false,
      vendor: cfg.vendor,
      protocol: cfg.protocol,
      host: cfg.host,
      port: cfg.port,
      message: `Koneksi ${cfg.protocol.toUpperCase()} ke OLT (${cfg.vendor.toUpperCase()}) berhasil`,
      output_preview: out.slice(0, 400)
    };
  }, override);
}

/** Status & redaman satu ONU */
function getOnuStatus(tenantId, { olt_port, onu_id, withRaw = false } = {}) {
  const v = sanitizeOnu(olt_port, onu_id);
  if (v.error) return Promise.resolve({ success: false, simulated: false, error: v.error });
  return runSafe(tenantId, (session, cfg) => readOnu(session, cfg, v.port, v.onuId, withRaw));
}

/** Pindai banyak ONU dalam satu sesi */
function scanOnus(tenantId, items = []) {
  return runSafe(tenantId, async (session, cfg) => {
    const results = [];
    for (const it of items) {
      const v = sanitizeOnu(it.olt_port, it.onu_id);
      if (v.error) { results.push({ id: it.id, success: false, error: v.error }); continue; }
      try {
        const r = await readOnu(session, cfg, v.port, v.onuId);
        results.push({ id: it.id, ...r });
      } catch (e) {
        results.push({ id: it.id, success: false, error: describeError(e) });
      }
    }
    return {
      success: true,
      simulated: false,
      results,
      faults: results.filter((r) => r.success && r.is_fault)
    };
  });
}

module.exports = {
  isLive,
  testConnection,
  getOnuStatus,
  scanOnus,
  // Helper diekspor untuk unit testing
  _parseZte: parseZte,
  _parseHuawei: parseHuawei,
  _parseEponGeneric: parseEponGeneric,
  _classify: classify,
  _sanitizeOnu: sanitizeOnu,
  _buildCommands: buildCommands
};
