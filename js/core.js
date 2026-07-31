'use strict';

/* ============================================================
   Next Gen Premier Roofing Contractor — Job Tracker
   Plain JS, no dependencies. Data persists in localStorage.
   ============================================================ */

const STORAGE_KEY = 'ngpr-tracker-v1';

const DEFAULT_SERVICES = [
  { id: 'shingling',         name: 'Shingling',            rate: 650 },
  { id: 'flat-roofing',      name: 'Flat Roofing',         rate: 650 },
  { id: 'tile-relay',        name: 'Tile Relay',           rate: 650 },
  { id: 'new-tile-concrete', name: 'New Tile — Concrete',  rate: 1050 },
  { id: 'new-tile-clay',     name: 'New Tile — Clay',      rate: 975 },
  { id: 'sheathing',         name: 'Sheathing',            rate: 225 },
  { id: 'solar-compound',    name: 'Solar Compound',       rate: 650 },
];

const STATUSES = [
  ['lead', 'Lead'],
  ['quoted', 'Quoted'],
  ['scheduled', 'Scheduled'],
  ['in-progress', 'In Progress'],
  ['completed', 'Completed'],
  ['paid', 'Paid'],
];

/* Jobs in these statuses count toward monthly / quarterly / yearly earnings. */
const REVENUE_STATUSES = ['completed', 'paid'];

const EXPENSE_CATEGORIES = [
  'Materials', 'Labor', 'Permits & Fees', 'Dump / Disposal',
  'Equipment Rental', 'Subcontractor', 'Fuel', 'Other',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------- State ---------- */

const PAYMENT_METHODS = ['Cash', 'Check', 'Card', 'Transfer', 'Financing', 'Other'];

/* Suggested crew positions — the field is free text, so anything else works too. */
const POSITIONS = [
  'Owner', 'Project Manager', 'Foreman', 'Roofer', 'Tile Setter', 'Painter',
  'Laborer', 'Estimator', 'Salesperson', 'Solar Tech', 'Sheet Metal Tech',
  'Driver', 'Office / Admin', 'Apprentice', 'Subcontractor',
];

function defaultState() {
  return {
    version: 4,
    settings: {
      companyName: 'Next Gen',
      tagline: 'Premier Roofing Contractor',
      unit: 'square',
      logoDataUrl: null,
      services: DEFAULT_SERVICES.map(s => ({ ...s })),
      companyPhone: '',
      companyEmail: '',
      companyAddress: '',
      licenseNumber: '1156207',
      invoiceNotes: 'Payment is due upon receipt. Thank you for your business!',
      nextInvoiceNumber: 1001,
      tearoffPerLayer: 35,
      depositCap: 1000,
      paymentSchedule: [
        { id: 'dep', label: 'Deposit', pct: 10, due: 'Upon signing / commencement of contract' },
        { id: 'p1', label: 'Progress Payment 1', pct: 30, due: 'When tear-off begins' },
        { id: 'p2', label: 'Progress Payment 2', pct: 30, due: 'When roofing begins' },
        { id: 'fin', label: 'Final Payment', pct: 10, due: 'When the roof is completed and the work is satisfactory to the Homeowner' },
      ],
      invoiceDisclosures: [
        'WARRANTY: The completed roofing work includes a ten (10) year labor warranty provided by the Contractor, subject to the terms and exclusions of the warranty. Manufacturer material warranties, including any limited lifetime warranty, are provided by the applicable manufacturer and are subject to the manufacturer’s terms, conditions, registration requirements, and exclusions.',
        'ADDITIONAL REPAIRS AFTER TEAR-OFF: Any damaged or deteriorated fascia, shiplap, sheathing, or other structural wood discovered after tear-off and reasonably necessary to complete the work shall be replaced only as needed and charged at the agreed additional repair rates.',
        'CHANGE ORDERS: Any change to the scope of work, materials, contract price, or completion schedule must be documented in a written change order signed by the Owner and Contractor before the additional or changed work is performed, except where emergency work is reasonably necessary to protect the property from immediate damage.',
        'THREE-DAY RIGHT TO CANCEL: Depending on how and where this contract is negotiated and signed, California law may provide the Owner with a right to cancel within three business days. FIVE-DAY RIGHT TO CANCEL FOR CERTAIN SENIORS: California law may provide a five-day cancellation period for qualifying homeowners age 65 or older.',
        'MECHANICS’ LIENS: Subcontractors, suppliers, and other persons who provide labor, services, equipment, or materials to improve the property and are not paid may have rights to record a mechanics’ lien against the property.',
      ].join('\n\n'),
    },
    jobs: [],
    estimates: [],
    customers: [],
    employees: [],
  };
}

/* Ensure every job has the arrays newer versions expect. */
function normalizeJobs(jobs) {
  for (const j of jobs) {
    if (!Array.isArray(j.expenses)) j.expenses = [];
    if (!Array.isArray(j.payments)) j.payments = [];
    if (!Array.isArray(j.labor)) j.labor = [];
    if (!Array.isArray(j.extras)) j.extras = [];
    if (!j.layers || j.layers < 1) j.layers = 1;
  }
  return jobs;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    const loaded = {
      version: base.version,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      jobs: normalizeJobs(Array.isArray(parsed.jobs) ? parsed.jobs : []),
      estimates: Array.isArray(parsed.estimates) ? parsed.estimates : [],
      customers: Array.isArray(parsed.customers) ? parsed.customers : [],
      employees: Array.isArray(parsed.employees) ? parsed.employees : [],
    };
    const fromVersion = parsed.version || 1;
    /* v1 shipped with a per-sq-ft default; pricing is per square (100 sq ft). */
    if (fromVersion < 2 && loaded.settings.unit === 'sq ft') {
      loaded.settings.unit = 'square';
    }
    /* v3 adds customers: seed the list from client names on existing jobs. */
    if (fromVersion < 3 && loaded.customers.length === 0) {
      const byName = new Map();
      for (const j of loaded.jobs) {
        const name = (j.client || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (!byName.has(key)) {
          byName.set(key, {
            id: uid(), name, phone: j.phone || '', email: '', notes: '',
            createdAt: j.createdAt || new Date().toISOString(),
          });
        }
        j.customerId = byName.get(key).id;
      }
      loaded.customers = Array.from(byName.values());
    }
    /* Write migrations back so they run exactly once. */
    if (fromVersion < base.version) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
    }
    return loaded;
  } catch (err) {
    console.error('Could not load saved data', err);
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

const ui = {
  view: 'dashboard',
  jobSearch: '',
  jobStatus: 'all',
  chartMetric: 'profit',
  chartYear: new Date().getFullYear(),
  customerSearch: '',
  schedYear: new Date().getFullYear(),
  schedMonth: new Date().getMonth(),
  scopeJobId: null,
  payFrom: '',
  payTo: '',
};

/* Job-dialog session: files attach immediately under the (pre-assigned)
   job id, so a canceled NEW job must clean its uploads back up. */
let dlgIsNew = false;
let dlgSaved = false;
let dlgJobId = null;

/* ---------- Small helpers ---------- */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

const moneyFmt0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const moneyFmt2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

function money(n, cents) {
  return (cents ? moneyFmt2 : moneyFmt0).format(n || 0);
}

function moneyShort(n) {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v >= 1e6) return sign + '$' + (v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1) + 'M';
  if (v >= 1e3) return sign + '$' + Math.round(v / 1e3) + 'k';
  return sign + '$' + Math.round(v);
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function dateLabel(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return MONTHS[m - 1] + ' ' + d + ', ' + y;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------- Domain helpers ---------- */

function getService(id) {
  return state.settings.services.find(s => s.id === id) || null;
}

function serviceName(id) {
  const s = getService(id);
  return s ? s.name : '(removed service)';
}

/* "square" pluralizes to "squares" in size labels; units like "sq ft" don't. */
function unitPlural() {
  const u = state.settings.unit;
  return u === 'square' ? 'squares' : u;
}

function serviceOptions(selectedId) {
  return state.settings.services.map(s =>
    `<option value="${esc(s.id)}" ${s.id === selectedId ? 'selected' : ''}>${esc(s.name)} — ${money(s.rate, s.rate % 1 !== 0)}/${esc(state.settings.unit)}</option>`
  ).join('');
}

function statusLabel(id) {
  const s = STATUSES.find(x => x[0] === id);
  return s ? s[1] : id;
}

function statusBadge(id) {
  return `<span class="badge ${esc(id)}"><span class="dot"></span>${esc(statusLabel(id))}</span>`;
}

/* Extra tear-off layers beyond the first, at $/square per layer. */
function tearoffCharge(area, layers) {
  const extra = Math.max(0, (num(layers) || 1) - 1);
  return extra * num(state.settings.tearoffPerLayer) * num(area);
}

function suggestedPrice(serviceId, area, layers) {
  const s = getService(serviceId);
  if (!s) return 0;
  return s.rate * num(area) + tearoffCharge(area, layers);
}

/* Customer-facing additional charges (wood, repairs found after tear-off). */
function extrasTotal(job) {
  return (job.extras || []).reduce((sum, x) => sum + num(x.amount), 0);
}

/* What the customer owes in total: contract price + additional charges. */
function jobTotal(job) {
  return num(job.price) + extrasTotal(job);
}

/* The milestone payment schedule for a given job total. The first row is
   capped at the deposit cap (CA limits deposits to $1,000 or 10%, whichever
   is less). Any percentage shortfall shows up as an explicit remainder. */
function paymentScheduleRows(total) {
  const cap = num(state.settings.depositCap);
  const rows = (state.settings.paymentSchedule || []).map((m, i) => {
    let amount = Math.round(total * num(m.pct)) / 100;
    if (i === 0 && cap > 0) amount = Math.min(amount, cap);
    return { label: m.label, due: m.due, pct: num(m.pct), amount };
  });
  const scheduled = rows.reduce((s, r) => s + r.amount, 0);
  const remainder = Math.round((total - scheduled) * 100) / 100;
  if (Math.abs(remainder) >= 0.01) {
    rows.push({ label: 'Remaining balance', due: 'Due with final invoice', pct: null, amount: remainder });
  }
  return rows;
}

function expensesTotal(job) {
  return (job.expenses || []).reduce((sum, e) => sum + num(e.amount), 0);
}

function laborTotal(job) {
  return (job.labor || []).reduce((sum, l) => sum + num(l.amount), 0);
}

/* Everything a job costs you: expenses plus crew pay. */
function jobCosts(job) {
  return expensesTotal(job) + laborTotal(job);
}

function jobProfit(job) {
  return jobTotal(job) - jobCosts(job);
}

function getEmployee(id) {
  return state.employees.find(e => e.id === id) || null;
}

function payLabel(e) {
  return e.payType === 'hourly'
    ? money(e.rate, true) + '/hr'
    : money(e.rate, e.rate % 1 !== 0) + '/job';
}

function employeeLabel(e) {
  return e.name + (e.position ? ' (' + e.position + ')' : '');
}

function managerName(job) {
  const e = job.managerId ? getEmployee(job.managerId) : null;
  return e ? e.name : '';
}

function unpaidExpensesTotal(expenses) {
  return (expenses || []).filter(x => !x.paid).reduce((s, x) => s + num(x.amount), 0);
}

function jobMargin(job) {
  const p = jobTotal(job);
  return p > 0 ? (jobProfit(job) / p) * 100 : 0;
}

function paymentsTotal(job) {
  return (job.payments || []).reduce((sum, p) => sum + num(p.amount), 0);
}

function balanceDue(job) {
  return jobTotal(job) - paymentsTotal(job);
}

/* A finished job with money still owed more than 30 days after completion. */
function isOverdue(job) {
  if (!REVENUE_STATUSES.includes(job.status)) return false;
  if (balanceDue(job) <= 0.005 || !job.completedDate) return false;
  const done = new Date(job.completedDate + 'T12:00:00').getTime();
  return (Date.now() - done) / 86400000 > 30;
}

function getCustomer(id) {
  return state.customers.find(c => c.id === id) || null;
}

/* Link a job to a customer by client name, creating the customer if new. */
function linkJobCustomer(job) {
  const name = (job.client || '').trim();
  if (!name) { job.customerId = null; return; }
  let c = state.customers.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!c) {
    c = { id: uid(), name, phone: job.phone || '', email: job.email || '', notes: '', createdAt: new Date().toISOString() };
    state.customers.push(c);
  } else {
    if (!c.phone && job.phone) c.phone = job.phone;
    if (!c.email && job.email) c.email = job.email;
  }
  job.customerId = c.id;
}

/* The date a job's money is counted under: completion date first,
   then start date, then the day it was created. */
function jobDate(job) {
  return (job.completedDate || job.startDate || (job.createdAt || '').slice(0, 10) || todayISO());
}

function monthlyTotals(year) {
  const rows = Array.from({ length: 12 }, () => ({ revenue: 0, expenses: 0, profit: 0, count: 0 }));
  for (const job of state.jobs) {
    if (!REVENUE_STATUSES.includes(job.status)) continue;
    const d = jobDate(job);
    if (Number(d.slice(0, 4)) !== year) continue;
    const m = Number(d.slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    rows[m].revenue += jobTotal(job);
    rows[m].expenses += jobCosts(job);
    rows[m].profit += jobProfit(job);
    rows[m].count += 1;
  }
  return rows;
}

function sumRows(rows) {
  return rows.reduce((acc, r) => ({
    revenue: acc.revenue + r.revenue,
    expenses: acc.expenses + r.expenses,
    profit: acc.profit + r.profit,
    count: acc.count + r.count,
  }), { revenue: 0, expenses: 0, profit: 0, count: 0 });
}

function allTimeTotals() {
  const jobs = state.jobs.filter(j => REVENUE_STATUSES.includes(j.status));
  return jobs.reduce((acc, j) => ({
    revenue: acc.revenue + jobTotal(j),
    expenses: acc.expenses + jobCosts(j),
    profit: acc.profit + jobProfit(j),
    count: acc.count + 1,
  }), { revenue: 0, expenses: 0, profit: 0, count: 0 });
}

/* ---------- File storage (IndexedDB) ----------
   Invoices, receipts, and other documents are stored per job in
   IndexedDB — far more room than localStorage, and blobs stay binary. */

const FILE_DB = 'ngpr-files-v1';
let _dbPromise = null;

function filesDb() {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(FILE_DB, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore('files', { keyPath: 'id' });
        store.createIndex('jobId', 'jobId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return _dbPromise;
}

function fileTx(mode, fn) {
  return filesDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const req = fn(tx.objectStore('files'));
    tx.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  }));
}

function addJobFile(jobId, file) {
  const rec = {
    id: uid(), jobId, name: file.name, type: file.type, size: file.size,
    addedAt: new Date().toISOString(), blob: file,
  };
  return fileTx('readwrite', s => s.put(rec)).then(() => rec);
}

function getJobFiles(jobId) { return fileTx('readonly', s => s.index('jobId').getAll(jobId)); }
function getFile(id) { return fileTx('readonly', s => s.get(id)); }
function deleteFile(id) { return fileTx('readwrite', s => s.delete(id)); }
function countJobFiles(jobId) { return fileTx('readonly', s => s.index('jobId').count(jobId)); }
function allFiles() { return fileTx('readonly', s => s.getAll()); }

function deleteJobFiles(jobId) {
  return getJobFiles(jobId).then(files => Promise.all(files.map(f => deleteFile(f.id))));
}

function fmtSize(bytes) {
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return Math.round(bytes / 1e3) + ' KB';
  return bytes + ' B';
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(',');
  const type = (head.match(/data:([^;]*)/) || [])[1] || '';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/* ---------- Address autocomplete (Photon / OpenStreetMap) ----------
   Free US address search, no API key. Results are filtered to United
   States addresses only. Needs internet; when offline or blocked, the
   field quietly stays a normal text input. */

function formatPhotonAddress(p) {
  const parts = [];
  const line1 = p.housenumber
    ? (p.housenumber + ' ' + (p.street || p.name || '')).trim()
    : (p.street || p.name || '');
  if (line1) parts.push(line1);
  const city = p.city || p.town || p.village || p.district;
  if (city && city !== line1) parts.push(city);
  const region = [p.state, p.postcode].filter(Boolean).join(' ');
  if (region) parts.push(region);
  return parts.join(', ');
}

function attachAddressAutocomplete(input) {
  if (!input || input.dataset.acAttached) return;
  input.dataset.acAttached = '1';
  input.setAttribute('autocomplete', 'off');
  const field = input.closest('.field') || input.parentElement;
  const list = document.createElement('div');
  list.className = 'ac-list';
  list.hidden = true;
  field.appendChild(list);

  let timer = null;
  let ctrl = null;
  let items = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    list.innerHTML = '';
    items = [];
    active = -1;
  };

  const render = () => {
    if (!items.length) { close(); return; }
    list.innerHTML = items.map((it, i) =>
      `<button type="button" class="ac-item${i === active ? ' active' : ''}" data-idx="${i}">${esc(it)}</button>`).join('') +
      '<div class="ac-foot">Address suggestions © OpenStreetMap</div>';
    list.hidden = false;
  };

  /* Never fail silently — say why there are no suggestions. */
  const showNote = msg => {
    items = [];
    active = -1;
    list.innerHTML = `<div class="ac-note">${esc(msg)}</div>`;
    list.hidden = false;
  };

  const pick = i => {
    if (items[i]) {
      input.value = items[i];
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    close();
    input.focus();
  };

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (ctrl) ctrl.abort();
    if (q.length < 3) { close(); return; }
    timer = setTimeout(async () => {
      ctrl = new AbortController();
      try {
        /* lat/lon bias the ranking toward the middle of the US; the
           countrycode filter below hard-limits results to US only. */
        const res = await fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=10&lat=39.83&lon=-98.58', { signal: ctrl.signal });
        if (!res.ok) throw new Error('geocoder unavailable');
        const data = await res.json();
        const seen = new Set();
        items = (data.features || [])
          .filter(f => ((f.properties || {}).countrycode || '').toUpperCase() === 'US')
          .map(f => formatPhotonAddress(f.properties || {}))
          .filter(s => {
            if (!s || seen.has(s)) return false;
            seen.add(s);
            return true;
          })
          .slice(0, 6);
        active = -1;
        render();
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        showNote(window.__NGPR_PREVIEW
          ? 'Live address suggestions are blocked in this online preview — they work in the real app.'
          : 'Can’t reach the address lookup service — check your internet, or just type the address.');
      }
    }, 300);
  });

  input.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') { close(); }
  });

  /* pointerdown fires before the input's blur, so clicks land reliably */
  list.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.ac-item');
    if (btn) { e.preventDefault(); pick(Number(btn.dataset.idx)); }
  });

  input.addEventListener('blur', () => setTimeout(close, 150));
}

/* ---------- Brand ---------- */

function applyBrand() {
  const s = state.settings;
  $('#brand-logo').src = s.logoDataUrl || 'assets/logo.png';
  $('#brand-title').textContent = s.companyName;
  $('#brand-sub').textContent = s.tagline;
  document.title = s.companyName + ' ' + s.tagline + ' — Job Tracker';
}

