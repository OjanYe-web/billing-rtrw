const fs = require('fs');

const html = fs.readFileSync('public/index.html', 'utf8');

// Extract all IDs from HTML
const idRegex = /id=["']([a-zA-Z0-9_-]+)["']/g;
const ids = new Set();
let m;
while ((m = idRegex.exec(html)) !== null) {
  ids.add(m[1]);
}

console.log('Total unique IDs in HTML:', ids.size);

// Mock DOM environment
const elements = {};
function createMockElement(id) {
  return {
    id: id,
    value: '',
    textContent: '',
    innerHTML: '',
    classList: {
      _classes: new Set(),
      add(...c) { c.forEach(x => this._classes.add(x)); },
      remove(...c) { c.forEach(x => this._classes.delete(x)); },
      contains(c) { return this._classes.has(c); },
      toggle(c, force) {
        if (force !== undefined) {
          if (force) this._classes.add(c); else this._classes.delete(c);
        } else {
          if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c);
        }
      }
    },
    style: {},
    dataset: {},
    setAttribute() {},
    getAttribute() { return ''; },
    removeAttribute() {},
    addEventListener(event, fn) {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    blur() {},
    click() {}
  };
}

ids.forEach(id => {
  elements[id] = createMockElement(id);
});

// Setup mock window and document
const windowMock = {
  location: { replace() {}, reload() {}, href: 'http://localhost:3000' },
  innerWidth: 1024,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
  sessionStorage: {
    data: { auth_token: 'fake-token' },
    getItem(k) { return this.data[k] || null; },
    setItem(k, v) { this.data[k] = String(v); },
    removeItem(k) { delete this.data[k]; }
  },
  localStorage: {
    data: {},
    getItem(k) { return this.data[k] || null; },
    setItem(k, v) { this.data[k] = String(v); },
    removeItem(k) { delete this.data[k]; }
  },
  fetch: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ user: { nama: 'Admin', role: 'admin' }, active_tenant: { nama_usaha: 'RT/RW' } })
  }),
  document: {
    getElementById(id) { return elements[id] || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    body: createMockElement('body'),
    documentElement: createMockElement('html')
  }
};

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>[\s\S]*?<\/body>/i);
if (!scriptMatch) {
  console.error('Main script not found');
  process.exit(1);
}

const jsCode = scriptMatch[1];

// Run the script in VM context with mocks
const vm = require('vm');
const context = vm.createContext({
  window: windowMock,
  document: windowMock.document,
  sessionStorage: windowMock.sessionStorage,
  localStorage: windowMock.localStorage,
  fetch: windowMock.fetch,
  navigator: { userAgent: 'Node' },
  console: console,
  setTimeout: (fn) => fn(),
  clearTimeout: () => {},
  setInterval: () => {},
  clearInterval: () => {},
  Chart: class { constructor() {} resize() {} destroy() {} update() {} },
  Date: Date,
  Math: Math,
  JSON: JSON,
  Number: Number,
  String: String,
  Array: Array,
  Object: Object,
  RegExp: RegExp,
  Headers: class { has() { return false; } set() {} get() { return null; } },
  confirm: () => true,
  alert: (msg) => console.log('[ALERT]:', msg),
  prompt: () => ''
});

try {
  vm.runInContext(jsCode, context);
  console.log('SCRIPT EXECUTED WITHOUT ANY SYNTAX OR RUNTIME ERRORS IN TOP-LEVEL CODE!');
} catch (err) {
  console.error('RUNTIME ERROR IN SCRIPT:', err);
}

