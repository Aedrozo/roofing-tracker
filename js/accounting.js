'use strict';

/* ============================================================
   Accounting module — chart of accounts, double-entry ledger,
   bills & vendors, reconciliation, reports, documents, audit,
   security (passcode lock / encryption / accountant role).
   ============================================================ */

/* ---------- Accounts ---------- */

const ACCOUNT_TYPES = [
  ['asset', 'Assets'], ['liability', 'Liabilities'], ['equity', 'Equity'],
  ['income', 'Income'], ['cogs', 'Cost of Goods Sold'], ['expense', 'Expenses'],
];

function acct(id) { return state.accounts.find(a => a.id === id) || null; }
function acctLabel(id) { const a = acct(id); return a ? a.number + ' · ' + a.name : '(unknown account)'; }
function acctType(id) { const a = acct(id); return a ? a.type : ''; }
function accountsOfType(types) { return state.accounts.filter(a => a.active !== false && types.includes(a.type)).sort((x, y) => x.number - y.number); }
function bankAccounts() { return state.accounts.filter(a => a.active !== false && (a.sub === 'bank' || a.sub === 'card')).sort((x, y) => x.number - y.number); }
function defaultBank() { return state.settings.defaultBankAccountId || 'a1000'; }

function accountOptions(selected, types) {
  const groups = ACCOUNT_TYPES.filter(([t]) => !types || types.includes(t));
  return groups.map(([t, label]) => {
    const opts = accountsOfType([t]).map(a => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${a.number} · ${esc(a.name)}</option>`).join('');
    return opts ? `<optgroup label="${esc(label)}">${opts}</optgroup>` : '';
  }).join('');
}

/* Debit-normal accounts grow with debits; credit-normal with credits. */
function normalBalance(type) { return (type === 'asset' || type === 'cogs' || type === 'expense') ? 'dr' : 'cr'; }
function signedBalance(a, dr, cr) { return normalBalance(a.type) === 'dr' ? dr - cr : cr - dr; }

/* ---------- Vendors ---------- */

function getVendor(id) { return state.vendors.find(v => v.id === id) || null; }
function vendorName(id) { const v = getVendor(id); return v ? v.name : ''; }

function ensureVendor(name) {
  const n = (name || '').trim();
  if (!n) return null;
  let v = state.vendors.find(x => x.name.toLowerCase() === n.toLowerCase());
  if (!v) {
    v = { id: uid(), name: n, phone: '', email: '', address: '', taxId: '', is1099: false, w9: false, notes: '', createdAt: new Date().toISOString() };
    state.vendors.push(v);
  }
  return v;
}

/* ---------- Periods ---------- */

function fiscalYearRange(dateIso) {
  const start = Math.min(12, Math.max(1, num(state.settings.fiscalYearStart) || 1));
  const d = new Date((dateIso || todayISO()) + 'T12:00:00');
  let y = d.getFullYear();
  if (d.getMonth() + 1 < start) y -= 1;
  const from = y + '-' + String(start).padStart(2, '0') + '-01';
  const endD = new Date(y + 1, start - 1, 0);
  const to = endD.getFullYear() + '-' + String(endD.getMonth() + 1).padStart(2, '0') + '-' + String(endD.getDate()).padStart(2, '0');
  return { from, to, label: start === 1 ? String(y) : 'FY ' + y + '–' + (y + 1) };
}

function inRange(d, from, to) { return (!from || d >= from) && (!to || d <= to); }
function r2(n) { return Math.round(n * 100) / 100; }

/* ---------- Ledger ---------- */

function jobRecognized(j) { return REVENUE_STATUSES.includes(j.status) || !!j.invoiceNumber; }
function recognitionDate(j) { return j.invoiceDate || j.completedDate || jobDate(j); }
function payAccountFor(method) { return method === 'Cash' ? 'a1050' : defaultBank(); }

/* Every money event in the business, as balanced double-entry transactions.
   Built on demand from jobs, bills, and manual journal entries. */
function buildLedger() {
  const T = [];
  const bank = defaultBank();
  for (const j of state.jobs) {
    const rec = jobRecognized(j);
    const rdate = recognitionDate(j);
    const label = j.address + (j.client ? ' — ' + j.client : '');
    if (rec) {
      const lines = [{ acct: 'a1100', dr: jobGrand(j), cr: 0 }, { acct: 'a4000', dr: 0, cr: num(j.price) }];
      if (extrasTotal(j)) lines.push({ acct: 'a4100', dr: 0, cr: extrasTotal(j) });
      if (jobTax(j)) lines.push({ acct: 'a2300', dr: 0, cr: jobTax(j) });
      T.push({ id: 'inv:' + j.id, date: rdate, kind: 'Invoice', desc: 'Invoice' + (j.invoiceNumber ? ' #' + j.invoiceNumber : '') + ' — ' + label, ref: j.invoiceNumber ? String(j.invoiceNumber) : '', jobId: j.id, lines });
    }
    (j.payments || []).forEach((p, i) => {
      if (!num(p.amount)) return;
      T.push({ id: 'pay:' + j.id + ':' + (p.id || i), date: p.date || rdate, kind: 'Payment', desc: 'Payment from ' + (j.client || 'customer') + ' — ' + j.address + (p.note ? ' (' + p.note + ')' : ''), ref: p.method || '', jobId: j.id, cashRevenue: true,
        lines: [{ acct: payAccountFor(p.method), dr: num(p.amount), cr: 0 }, { acct: rec ? 'a1100' : 'a2400', dr: 0, cr: num(p.amount) }] });
    });
    (j.expenses || []).forEach((e, i) => {
      if (!num(e.amount)) return;
      const costAcct = CATEGORY_ACCOUNT[e.category] || 'a5900';
      T.push({ id: 'exp:' + j.id + ':' + i, date: jobDate(j), kind: e.paid ? 'Job expense' : 'Job bill', desc: (e.desc || e.category) + ' — ' + j.address, ref: e.category, jobId: j.id, cashExpense: e.paid ? costAcct : null,
        lines: [{ acct: costAcct, dr: num(e.amount), cr: 0 }, { acct: e.paid ? bank : 'a2000', dr: 0, cr: num(e.amount) }] });
    });
    const lab = laborTotal(j);
    if (lab) T.push({ id: 'lab:' + j.id, date: jobDate(j), kind: 'Crew labor', desc: 'Crew labor — ' + j.address, ref: '', jobId: j.id, lines: [{ acct: 'a5100', dr: lab, cr: 0 }, { acct: 'a2200', dr: 0, cr: lab }] });
  }
  for (const b of state.bills) {
    if (!num(b.amount)) continue;
    const vend = vendorName(b.vendorId) || b.vendorName || 'Vendor';
    T.push({ id: 'bill:' + b.id, date: b.date, kind: 'Bill', desc: vend + (b.memo ? ' — ' + b.memo : ''), ref: b.ref || '', vendorId: b.vendorId, billId: b.id,
      lines: [{ acct: b.accountId, dr: num(b.amount), cr: 0 }, { acct: 'a2000', dr: 0, cr: num(b.amount) }] });
    if (b.paid) {
      T.push({ id: 'bpay:' + b.id, date: b.paidDate || b.date, kind: 'Bill payment', desc: 'Paid ' + vend + (b.memo ? ' — ' + b.memo : ''), ref: b.method || '', vendorId: b.vendorId, billId: b.id, cashExpense: b.accountId,
        lines: [{ acct: 'a2000', dr: num(b.amount), cr: 0 }, { acct: b.paidFrom || bank, dr: 0, cr: num(b.amount) }] });
    }
  }
  for (const je of state.journal) {
    T.push({ id: 'je:' + je.id, date: je.date, kind: 'Journal', desc: je.memo || 'Journal entry', ref: je.ref || '', journalId: je.id,
      lines: (je.lines || []).map(l => ({ acct: l.accountId, dr: num(l.debit), cr: num(l.credit) })) });
  }
  T.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return T;
}

/* Sum of debits and credits per account over a date range. */
function accountTotals(T, from, to) {
  const m = {};
  for (const t of T) {
    if (!inRange(t.date, from, to)) continue;
    for (const l of t.lines) {
      const e = m[l.acct] || (m[l.acct] = { dr: 0, cr: 0 });
      e.dr += l.dr; e.cr += l.cr;
    }
  }
  return m;
}

function accountBalance(T, accountId, asOf) {
  const a = acct(accountId);
  if (!a) return 0;
  const tot = accountTotals(T, '', asOf)[accountId] || { dr: 0, cr: 0 };
  return signedBalance(a, tot.dr, tot.cr);
}

function netIncome(T, from, to) {
  const tot = accountTotals(T, from, to);
  let inc = 0, cost = 0;
  for (const a of state.accounts) {
    const e = tot[a.id]; if (!e) continue;
    if (a.type === 'income') inc += e.cr - e.dr;
    if (a.type === 'cogs' || a.type === 'expense') cost += e.dr - e.cr;
  }
  return inc - cost;
}

/* ---------- Reports ---------- */

const REPORTS = [
  ['pnl', 'Profit & Loss'], ['balance', 'Balance Sheet'], ['cashflow', 'Cash Flow'],
  ['ar', 'A/R Aging (customers owe you)'], ['ap', 'A/P Aging (you owe vendors)'],
  ['jobcost', 'Job Profitability (job costing)'], ['wip', 'Work in Progress'],
  ['sales_customer', 'Sales by Customer'], ['sales_salesman', 'Sales by Salesman'],
  ['exp_account', 'Expenses by Account'], ['exp_vendor', 'Expenses by Vendor'],
  ['salestax', 'Sales Tax Collected'], ['payroll', 'Crew Payroll Summary'], ['form1099', '1099 Vendor Report'],
  ['mileage', 'Mileage Log'], ['trial', 'Trial Balance'], ['gl', 'General Ledger'],
];

function agingBucket(days) {
  if (days <= 30) return 0; if (days <= 60) return 1; if (days <= 90) return 2; return 3;
}
function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }

function reportData(name, from, to, opts) {
  const T = buildLedger();
  const basis = opts.basis || state.settings.accountingBasis || 'accrual';
  const R = { title: (REPORTS.find(r => r[0] === name) || [])[1] || name, cols: [], rows: [], foot: [], notes: '' };
  const money2 = v => money(v, true);

  if (name === 'pnl') {
    R.cols = ['Account', 'Amount'];
    R.notes = basis === 'cash' ? 'Cash basis — revenue when payments are received, costs when paid.' : 'Accrual basis — revenue when invoiced/completed, costs when incurred.';
    let inc = {}, cost = {};
    if (basis === 'accrual') {
      const tot = accountTotals(T, from, to);
      for (const a of state.accounts) {
        const e = tot[a.id]; if (!e) continue;
        if (a.type === 'income') inc[a.id] = (inc[a.id] || 0) + e.cr - e.dr;
        if (a.type === 'cogs' || a.type === 'expense') cost[a.id] = (cost[a.id] || 0) + e.dr - e.cr;
      }
    } else {
      for (const t of T) {
        if (!inRange(t.date, from, to)) continue;
        if (t.cashRevenue) inc['a4000'] = (inc['a4000'] || 0) + t.lines[0].dr;
        if (t.cashExpense) cost[t.cashExpense] = (cost[t.cashExpense] || 0) + t.lines[0].dr;
        if (t.kind === 'Journal') for (const l of t.lines) {
          const a = acct(l.acct); if (!a) continue;
          if (a.type === 'income') inc[a.id] = (inc[a.id] || 0) + l.cr - l.dr;
          if (a.type === 'cogs' || a.type === 'expense') cost[a.id] = (cost[a.id] || 0) + l.dr - l.cr;
        }
      }
    }
    const section = (label, map, types) => {
      R.rows.push([{ h: label }, '']);
      let sum = 0;
      for (const a of accountsOfType(types)) { if (map[a.id]) { R.rows.push(['    ' + a.number + ' ' + a.name, money2(map[a.id])]); sum += map[a.id]; } }
      return sum;
    };
    const income = section('INCOME', inc, ['income']);
    R.rows.push([{ b: 'Total Income' }, { b: money2(income) }]);
    const cogs = section('COST OF GOODS SOLD', cost, ['cogs']);
    R.rows.push([{ b: 'Total COGS' }, { b: money2(cogs) }]);
    R.rows.push([{ b: 'GROSS PROFIT' }, { b: money2(income - cogs) }]);
    const exp = section('OPERATING EXPENSES', cost, ['expense']);
    R.rows.push([{ b: 'Total Expenses' }, { b: money2(exp) }]);
    R.foot = [['NET INCOME', money2(income - cogs - exp)]];
    R.summary = { income, cogs, exp, net: income - cogs - exp };
  }

  else if (name === 'balance') {
    R.cols = ['Account', 'Balance'];
    R.notes = 'As of ' + dateLabel(to) + '. Current earnings = net income of all periods to date (books are never "closed" here — your CPA does that).';
    const tot = accountTotals(T, '', to);
    const section = (label, types) => {
      R.rows.push([{ h: label }, '']);
      let sum = 0;
      for (const a of accountsOfType(types)) {
        const e = tot[a.id]; if (!e) continue;
        const bal = signedBalance(a, e.dr, e.cr);
        if (Math.abs(bal) < 0.005) continue;
        R.rows.push(['    ' + a.number + ' ' + a.name, money2(bal)]); sum += bal;
      }
      return sum;
    };
    const assets = section('ASSETS', ['asset']);
    R.rows.push([{ b: 'Total Assets' }, { b: money2(assets) }]);
    const liab = section('LIABILITIES', ['liability']);
    R.rows.push([{ b: 'Total Liabilities' }, { b: money2(liab) }]);
    const eq = section('EQUITY', ['equity']);
    const earnings = netIncome(T, '', to);
    R.rows.push(['    Current earnings (net income to date)', money2(earnings)]);
    R.rows.push([{ b: 'Total Equity' }, { b: money2(eq + earnings) }]);
    R.foot = [['TOTAL LIABILITIES + EQUITY', money2(liab + eq + earnings)]];
    R.summary = { assets, liabilities: liab, equity: eq + earnings, balanced: Math.abs(assets - (liab + eq + earnings)) < 0.01 };
    R.rows.push([{ b: R.summary.balanced ? '✓ Books balance (Assets = Liabilities + Equity)' : '⚠ Out of balance by ' + money2(assets - liab - eq - earnings) }, '']);
  }

  else if (name === 'cashflow') {
    R.cols = ['Item', 'Amount'];
    const banks = bankAccounts().map(a => a.id);
    const isBank = id => banks.includes(id);
    const prev = new Date(from + 'T12:00:00'); prev.setDate(prev.getDate() - 1);
    const dayBefore = prev.toISOString().slice(0, 10);
    let opening = 0; for (const id of banks) opening += accountBalance(T, id, dayBefore) * (acct(id).type === 'liability' ? -1 : 1);
    let inflow = 0, outflow = 0; const byKind = {};
    for (const t of T) {
      if (!inRange(t.date, from, to)) continue;
      for (const l of t.lines) {
        if (!isBank(l.acct)) continue;
        const a = acct(l.acct); const delta = a.type === 'liability' ? (l.cr - l.dr) * -1 : (l.dr - l.cr);
        if (delta > 0) inflow += delta; else outflow += -delta;
        byKind[t.kind] = (byKind[t.kind] || 0) + delta;
      }
    }
    R.rows.push([{ b: 'Opening cash ' + dateLabel(dayBefore) }, { b: money2(opening) }]);
    R.rows.push([{ h: 'CASH IN' }, '']);
    for (const [k, v] of Object.entries(byKind)) if (v > 0) R.rows.push(['    ' + k, money2(v)]);
    R.rows.push([{ b: 'Total cash in' }, { b: money2(inflow) }]);
    R.rows.push([{ h: 'CASH OUT' }, '']);
    for (const [k, v] of Object.entries(byKind)) if (v < 0) R.rows.push(['    ' + k, money2(-v)]);
    R.rows.push([{ b: 'Total cash out' }, { b: money2(outflow) }]);
    R.rows.push([{ b: 'Net change in cash' }, { b: money2(inflow - outflow) }]);
    R.foot = [['CLOSING CASH ' + dateLabel(to), money2(opening + inflow - outflow)]];
  }

  else if (name === 'ar') {
    R.cols = ['Customer / Job', 'Invoiced', 'Current (0–30)', '31–60', '61–90', '90+', 'Balance'];
    const b = [0, 0, 0, 0]; let total = 0;
    for (const j of state.jobs) {
      if (!jobRecognized(j)) continue;
      const bal = r2(balanceDue(j)); if (bal <= 0.005) continue;
      const rd = recognitionDate(j); if (rd > to) continue;
      const k = agingBucket(daysBetween(rd, to)); b[k] += bal; total += bal;
      const cells = ['', '', '', '']; cells[k] = money2(bal);
      R.rows.push([(j.client || 'Customer') + ' — ' + j.address, dateLabel(rd), ...cells, money2(bal)]);
    }
    R.foot = [['TOTAL', '', money2(b[0]), money2(b[1]), money2(b[2]), money2(b[3]), money2(total)]];
    R.summary = { total };
  }

  else if (name === 'ap') {
    R.cols = ['Vendor / Item', 'Dated', 'Current (0–30)', '31–60', '61–90', '90+', 'Unpaid'];
    const b = [0, 0, 0, 0]; let total = 0;
    const push = (label, d, amt) => { const k = agingBucket(daysBetween(d, to)); b[k] += amt; total += amt; const c = ['', '', '', '']; c[k] = money2(amt); R.rows.push([label, dateLabel(d), ...c, money2(amt)]); };
    for (const bill of state.bills) if (!bill.paid && num(bill.amount) > 0 && bill.date <= to) push((vendorName(bill.vendorId) || bill.vendorName || 'Vendor') + (bill.memo ? ' — ' + bill.memo : ''), bill.date, num(bill.amount));
    for (const j of state.jobs) for (const e of j.expenses || []) if (!e.paid && num(e.amount) > 0 && jobDate(j) <= to) push((e.desc || e.category) + ' — ' + j.address, jobDate(j), num(e.amount));
    R.foot = [['TOTAL', '', money2(b[0]), money2(b[1]), money2(b[2]), money2(b[3]), money2(total)]];
    R.summary = { total };
  }

  else if (name === 'jobcost') {
    R.cols = ['Job', 'Date', 'Revenue', 'Materials', 'Labor', 'Other costs', 'Gross profit', 'Margin'];
    let s = [0, 0, 0, 0, 0];
    for (const j of state.jobs) {
      if (!jobRecognized(j) || !inRange(recognitionDate(j), from, to)) continue;
      const rev = jobTotal(j);
      const mat = (j.expenses || []).filter(e => e.category === 'Materials').reduce((x, e) => x + num(e.amount), 0);
      const lab = laborTotal(j) + (j.expenses || []).filter(e => e.category === 'Labor').reduce((x, e) => x + num(e.amount), 0);
      const oth = expensesTotal(j) - mat - (j.expenses || []).filter(e => e.category === 'Labor').reduce((x, e) => x + num(e.amount), 0);
      const gp = rev - mat - lab - oth;
      s = [s[0] + rev, s[1] + mat, s[2] + lab, s[3] + oth, s[4] + gp];
      R.rows.push([j.address + (j.client ? ' — ' + j.client : ''), dateLabel(recognitionDate(j)), money2(rev), money2(mat), money2(lab), money2(oth), money2(gp), rev > 0 ? (gp / rev * 100).toFixed(1) + '%' : '—']);
    }
    R.foot = [['TOTAL', '', money2(s[0]), money2(s[1]), money2(s[2]), money2(s[3]), money2(s[4]), s[0] > 0 ? (s[4] / s[0] * 100).toFixed(1) + '%' : '—']];
  }

  else if (name === 'wip') {
    R.cols = ['Job', 'Status', 'Contract', 'Costs to date', 'Billed / collected', 'Gross to date', 'Cost %'];
    R.notes = 'Open jobs not yet recognized as revenue: contract value vs. costs incurred and customer deposits collected.';
    let s = [0, 0, 0, 0];
    for (const j of state.jobs) {
      if (jobRecognized(j) || !['scheduled', 'in-progress', 'quoted'].includes(j.status)) continue;
      const c = jobGrand(j), k = jobCosts(j), p = paymentsTotal(j);
      s = [s[0] + c, s[1] + k, s[2] + p, s[3] + (c - k)];
      R.rows.push([j.address + (j.client ? ' — ' + j.client : ''), statusLabel(j.status), money2(c), money2(k), money2(p), money2(c - k), c > 0 ? (k / c * 100).toFixed(0) + '%' : '—']);
    }
    R.foot = [['TOTAL', '', money2(s[0]), money2(s[1]), money2(s[2]), money2(s[3]), '']];
  }

  else if (name === 'sales_customer' || name === 'sales_salesman') {
    const byName = {};
    for (const j of state.jobs) {
      if (!jobRecognized(j) || !inRange(recognitionDate(j), from, to)) continue;
      const key = name === 'sales_customer' ? (j.client || '(no customer)') : ((j.scope && j.scope.salesman) || '(no salesman)');
      const e = byName[key] || (byName[key] = { jobs: 0, sales: 0, collected: 0 });
      e.jobs++; e.sales += jobTotal(j); e.collected += paymentsTotal(j);
    }
    R.cols = [name === 'sales_customer' ? 'Customer' : 'Salesman', 'Jobs', 'Sales', 'Collected', 'Avg job'];
    let tj = 0, ts = 0, tc = 0;
    Object.entries(byName).sort((a, b) => b[1].sales - a[1].sales).forEach(([k, e]) => { tj += e.jobs; ts += e.sales; tc += e.collected; R.rows.push([k, e.jobs, money2(e.sales), money2(e.collected), money2(e.sales / e.jobs)]); });
    R.foot = [['TOTAL', tj, money2(ts), money2(tc), tj ? money2(ts / tj) : '—']];
  }

  else if (name === 'exp_account') {
    R.cols = ['Account', 'Type', 'Amount', '% of total'];
    const tot = accountTotals(T, from, to); let total = 0; const rows = [];
    for (const a of accountsOfType(['cogs', 'expense'])) { const e = tot[a.id]; if (!e) continue; const v = e.dr - e.cr; if (!v) continue; rows.push([a, v]); total += v; }
    rows.sort((x, y) => y[1] - x[1]).forEach(([a, v]) => R.rows.push([a.number + ' ' + a.name, a.type === 'cogs' ? 'Job cost' : 'Overhead', money2(v), total ? (v / total * 100).toFixed(1) + '%' : '—']));
    R.foot = [['TOTAL', '', money2(total), '']];
  }

  else if (name === 'exp_vendor') {
    R.cols = ['Vendor', 'Bills', 'Billed', 'Paid', 'Unpaid', '1099?'];
    const by = {};
    for (const b of state.bills) {
      if (!inRange(b.date, from, to)) continue;
      const key = b.vendorId || ('name:' + (b.vendorName || 'Vendor'));
      const e = by[key] || (by[key] = { name: vendorName(b.vendorId) || b.vendorName || 'Vendor', n: 0, billed: 0, paid: 0, v: getVendor(b.vendorId) });
      e.n++; e.billed += num(b.amount); if (b.paid) e.paid += num(b.amount);
    }
    let tb = 0, tp = 0;
    Object.values(by).sort((a, b) => b.billed - a.billed).forEach(e => { tb += e.billed; tp += e.paid; R.rows.push([e.name, e.n, money2(e.billed), money2(e.paid), money2(e.billed - e.paid), e.v && e.v.is1099 ? 'Yes' : '']); });
    R.foot = [['TOTAL', '', money2(tb), money2(tp), money2(tb - tp), '']];
  }

  else if (name === 'salestax') {
    R.cols = ['Month', 'Taxable sales', 'Tax collected'];
    const by = {}; let ts = 0, tt = 0;
    for (const j of state.jobs) {
      if (!jobRecognized(j) || !inRange(recognitionDate(j), from, to) || !jobTax(j)) continue;
      const m = recognitionDate(j).slice(0, 7); const e = by[m] || (by[m] = [0, 0]); e[0] += jobTotal(j); e[1] += jobTax(j);
    }
    Object.keys(by).sort().forEach(m => { ts += by[m][0]; tt += by[m][1]; R.rows.push([MONTHS[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4), money2(by[m][0]), money2(by[m][1])]); });
    R.foot = [['TOTAL', money2(ts), money2(tt)]];
    R.notes = 'Sales tax is applied per job at the rate set in Settings. Confirm taxability of your services and materials with your CPA.';
  }

  else if (name === 'payroll') {
    R.cols = ['Employee', 'Position', 'Pay type', 'Jobs', 'Hours', 'Gross pay'];
    const by = {};
    for (const j of state.jobs) {
      if (!inRange(jobDate(j), from, to)) continue;
      for (const l of j.labor || []) {
        const emp = getEmployee(l.employeeId); const key = l.employeeId || l.name;
        const e = by[key] || (by[key] = { name: emp ? emp.name : (l.name || 'Former employee'), pos: emp ? emp.position || '' : '', type: emp ? (emp.payType === 'hourly' ? 'Hourly' : 'Per job') : '', jobs: new Set(), hours: 0, pay: 0 });
        e.jobs.add(j.id); e.hours += num(l.hours); e.pay += num(l.amount);
      }
    }
    let th = 0, tp = 0;
    Object.values(by).sort((a, b) => b.pay - a.pay).forEach(e => { th += e.hours; tp += e.pay; R.rows.push([e.name, e.pos, e.type, e.jobs.size, e.hours ? e.hours.toFixed(2) : '—', money2(e.pay)]); });
    R.foot = [['TOTAL', '', '', '', th ? th.toFixed(2) : '—', money2(tp)]];
    R.notes = 'Gross crew pay recorded on jobs by job date. Payroll taxes and withholdings are not calculated here.';
  }

  else if (name === 'form1099') {
    const year = (to || todayISO()).slice(0, 4);
    R.cols = ['Vendor', 'Tax ID', 'W-9 on file', 'Paid in ' + year, '1099-NEC'];
    R.notes = 'Vendors flagged as 1099-eligible. A 1099-NEC is generally required for non-employee services paid $600 or more in the calendar year — confirm with your CPA.';
    for (const v of state.vendors) {
      if (!v.is1099) continue;
      const paid = state.bills.filter(b => b.vendorId === v.id && b.paid && (b.paidDate || b.date).slice(0, 4) === year).reduce((s, b) => s + num(b.amount), 0);
      R.rows.push([v.name, v.taxId ? '••••' + String(v.taxId).slice(-4) : '—', v.w9 ? 'Yes' : 'MISSING', money2(paid), paid >= 600 ? 'REQUIRED' : 'below $600']);
    }
  }

  else if (name === 'mileage') {
    R.cols = ['Date', 'Purpose / job', 'Miles', 'Deduction'];
    const rate = num(state.settings.mileageRate); let tm = 0;
    for (const m of state.mileage.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      if (!inRange(m.date, from, to)) continue;
      tm += num(m.miles);
      const j = m.jobId ? state.jobs.find(x => x.id === m.jobId) : null;
      R.rows.push([dateLabel(m.date), (m.purpose || '') + (j ? ' — ' + j.address : ''), num(m.miles).toFixed(1), money2(num(m.miles) * rate)]);
    }
    R.foot = [['TOTAL @ ' + money2(rate) + '/mile', '', tm.toFixed(1), money2(tm * rate)]];
    R.notes = 'IRS standard mileage rate is set in Settings — update it each January.';
  }

  else if (name === 'trial') {
    R.cols = ['Account', 'Debit', 'Credit'];
    const tot = accountTotals(T, '', to); let td = 0, tc = 0;
    for (const a of state.accounts.slice().sort((x, y) => x.number - y.number)) {
      const e = tot[a.id]; if (!e) continue; const bal = e.dr - e.cr; if (Math.abs(bal) < 0.005) continue;
      if (bal > 0) td += bal; else tc += -bal;
      R.rows.push([a.number + ' ' + a.name, bal > 0 ? money2(bal) : '', bal < 0 ? money2(-bal) : '']);
    }
    R.foot = [['TOTAL', money2(td), money2(tc)]];
    R.summary = { balanced: Math.abs(td - tc) < 0.01 };
  }

  else if (name === 'gl') {
    R.cols = ['Date', 'Type', 'Description', 'Ref', 'Account', 'Debit', 'Credit'];
    const filter = opts.account || '';
    for (const t of T) {
      if (!inRange(t.date, from, to)) continue;
      for (const l of t.lines) {
        if (filter && l.acct !== filter) continue;
        R.rows.push([dateLabel(t.date), t.kind, t.desc, t.ref, acctLabel(l.acct), l.dr ? money2(l.dr) : '', l.cr ? money2(l.cr) : '']);
      }
    }
  }

  return R;
}

/* ---------- CSV / exports ---------- */

function csvCell(v) {
  if (v && typeof v === 'object') v = v.b || v.h || '';
  return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
}
function toCsv(cols, rows, foot) {
  return [cols.map(csvCell).join(',')].concat(rows.map(r => r.map(csvCell).join(',')), (foot || []).map(r => r.map(csvCell).join(','))).join('\r\n');
}
function reportToCsv(name, from, to, opts) {
  const R = reportData(name, from, to, opts || {});
  return toCsv(R.cols, R.rows.map(r => r.map(c => (c && typeof c === 'object') ? (c.b || c.h || '') : c)), R.foot);
}
function reportFileName(name, from, to) { return name + '_' + (from || 'all') + '_to_' + (to || 'all') + '.csv'; }

/* Bank-style 3-column CSV that QuickBooks / Xero accept as a transaction import. */
function bankImportCsv(accountId, from, to) {
  const T = buildLedger(); const rows = [];
  for (const t of T) {
    if (!inRange(t.date, from, to)) continue;
    for (const l of t.lines) if (l.acct === accountId) rows.push([t.date, t.desc, (l.dr - l.cr).toFixed(2)]);
  }
  return toCsv(['Date', 'Description', 'Amount'], rows);
}

/* Everything an accountant asks for at year end, in one click. */
async function exportAccountantPackage(from, to) {
  const files = [
    ['profit-and-loss-accrual', reportToCsv('pnl', from, to, { basis: 'accrual' })],
    ['profit-and-loss-cash', reportToCsv('pnl', from, to, { basis: 'cash' })],
    ['balance-sheet', reportToCsv('balance', from, to, {})],
    ['cash-flow', reportToCsv('cashflow', from, to, {})],
    ['general-ledger', reportToCsv('gl', from, to, {})],
    ['trial-balance', reportToCsv('trial', from, to, {})],
    ['ar-aging', reportToCsv('ar', from, to, {})],
    ['ap-aging', reportToCsv('ap', from, to, {})],
    ['job-costing', reportToCsv('jobcost', from, to, {})],
    ['work-in-progress', reportToCsv('wip', from, to, {})],
    ['expenses-by-account', reportToCsv('exp_account', from, to, {})],
    ['expenses-by-vendor', reportToCsv('exp_vendor', from, to, {})],
    ['sales-tax', reportToCsv('salestax', from, to, {})],
    ['payroll-summary', reportToCsv('payroll', from, to, {})],
    ['1099-vendors', reportToCsv('form1099', from, to, {})],
    ['mileage', reportToCsv('mileage', from, to, {})],
    ['bank-transactions-' + defaultBank(), bankImportCsv(defaultBank(), from, to)],
  ];
  const stamp = (from || 'all') + '_to_' + (to || 'all');
  for (const [name, csv] of files) {
    downloadFile('NGPR_' + name + '_' + stamp + '.csv', csv, 'text/csv');
    await new Promise(r => setTimeout(r, 350));
  }
  logAudit('export', 'accountant-package', '', stamp);
  saveState();
  toast(files.length + ' report files downloaded');
}

/* ---------- Accounting view ---------- */

const ACCT_TABS = [
  ['overview', 'Overview'], ['reports', 'Reports'], ['bills', 'Bills & Expenses'], ['vendors', 'Vendors'],
  ['register', 'Register'], ['reconcile', 'Reconcile'], ['accounts', 'Chart of Accounts'], ['documents', 'Documents'], ['audit', 'Audit Log'],
];

function acctUi() {
  if (!ui.acct) {
    const fy = fiscalYearRange();
    ui.acct = { tab: 'overview', from: fy.from, to: todayISO(), basis: state.settings.accountingBasis || 'accrual', report: 'pnl', glAcct: '', regAcct: defaultBank(), billFilter: 'all', docSearch: '', stmtDate: todayISO(), stmtBalance: '', imported: [] };
  }
  return ui.acct;
}

function periodBarHtml(a, showBasis) {
  const fy = fiscalYearRange();
  return `
    <div class="toolbar">
      <span class="hint" style="font-weight:600">Period</span>
      <input type="date" data-field="acct-from" value="${esc(a.from)}" aria-label="From">
      <input type="date" data-field="acct-to" value="${esc(a.to)}" aria-label="To">
      <button class="btn small" data-action="acct-period" data-p="fy">This fiscal year</button>
      <button class="btn small" data-action="acct-period" data-p="lastfy">Last fiscal year</button>
      <button class="btn small" data-action="acct-period" data-p="month">This month</button>
      <button class="btn small" data-action="acct-period" data-p="quarter">This quarter</button>
      <button class="btn small" data-action="acct-period" data-p="all">All time</button>
      ${showBasis ? `<div class="seg" role="group" aria-label="Basis">
        <button data-action="acct-basis" data-basis="accrual" class="${a.basis === 'accrual' ? 'active' : ''}">Accrual</button>
        <button data-action="acct-basis" data-basis="cash" class="${a.basis === 'cash' ? 'active' : ''}">Cash</button>
      </div>` : ''}
    </div>`;
}

function renderAccounting() {
  const a = acctUi();
  const tabs = ACCT_TABS.map(([k, l]) => `<button data-action="acct-tab" data-tab="${k}" class="${a.tab === k ? 'active' : ''}">${l}</button>`).join('');
  let body = '';
  if (a.tab === 'overview') body = acctOverviewHtml(a);
  else if (a.tab === 'reports') body = acctReportsHtml(a);
  else if (a.tab === 'bills') body = acctBillsHtml(a);
  else if (a.tab === 'vendors') body = acctVendorsHtml(a);
  else if (a.tab === 'register') body = acctRegisterHtml(a);
  else if (a.tab === 'reconcile') body = acctReconcileHtml(a);
  else if (a.tab === 'accounts') body = acctAccountsHtml(a);
  else if (a.tab === 'documents') body = '<div class="card" id="acct-docs"><p class="hint">Loading documents…</p></div>';
  else if (a.tab === 'audit') body = acctAuditHtml(a);
  $('#view-accounting').innerHTML = `
    <div class="page-head">
      <div>
        <h1>Accounting</h1>
        <p>Double-entry books built automatically from your jobs, payments, expenses, and crew pay — plus bills, vendors, reconciliation, and every report your CPA needs.</p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn" data-action="acct-package">📦 Accountant package</button>
        ${a.tab !== 'overview' ? '' : '<button class="btn primary" data-action="acct-tab" data-tab="reports">View reports</button>'}
      </div>
    </div>
    <div class="seg acct-tabs" role="tablist">${tabs}</div>
    ${body}`;
  if (a.tab === 'documents') renderDocuments(a);
}

function acctOverviewHtml(a) {
  const T = buildLedger();
  const today = todayISO();
  const fy = fiscalYearRange();
  const cash = bankAccounts().filter(x => x.sub === 'bank').reduce((s, x) => s + accountBalance(T, x.id, today), 0);
  const cards = bankAccounts().filter(x => x.sub === 'card').reduce((s, x) => s + accountBalance(T, x.id, today), 0);
  const ar = accountBalance(T, 'a1100', today), ap = accountBalance(T, 'a2000', today);
  const tax = accountBalance(T, 'a2300', today), wages = accountBalance(T, 'a2200', today), dep = accountBalance(T, 'a2400', today);
  const ni = netIncome(T, fy.from, today);
  const unpaidBills = state.bills.filter(b => !b.paid).length;
  const uncleared = T.filter(t => t.lines.some(l => bankAccounts().some(b => b.id === l.acct) && !state.cleared[t.id + ':' + l.acct])).length;
  const sec = secConfig();
  const tile = (label, v, sub, neg) => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value${neg && v < 0 ? ' negative' : ''}">${money(v, true)}</div><div class="tile-sub"><span>${sub}</span></div></div>`;
  return `
    <div class="tiles">
      ${tile('Cash in bank', cash, 'All bank accounts today', true)}
      ${tile('Customers owe you (A/R)', ar, 'Invoiced, not yet collected')}
      ${tile('You owe vendors (A/P)', ap, unpaidBills + ' unpaid bill' + (unpaidBills === 1 ? '' : 's') + ' + unpaid job expenses')}
      ${tile('Net income — ' + fy.label + ' to date', ni, 'Accrual basis', true)}
    </div>
    <div class="tiles">
      ${tile('Wages payable', wages, 'Crew pay recorded, not yet paid out')}
      ${tile('Sales tax payable', tax, 'Collected on invoices')}
      ${tile('Customer deposits', dep, 'Paid on jobs not yet invoiced')}
      ${tile('Credit card balance', cards, 'Owed on cards', false)}
    </div>
    <div class="settings-grid">
      <div class="card">
        <h2>Books health</h2>
        <table class="data"><tbody>
          <tr><td>Passcode & encryption</td><td class="num">${sec ? '<span class="paid-tag">On ✓</span>' : '<span class="overdue-tag">OFF</span> <span class="hint">set one in Settings → Security</span>'}</td></tr>
          <tr><td>Accountant read-only login</td><td class="num">${sec && sec.acct ? '<span class="paid-tag">Set ✓</span>' : '<span class="hint">not set</span>'}</td></tr>
          <tr><td>Closing date (period lock)</td><td class="num">${state.settings.closingDate ? '<b>' + dateLabel(state.settings.closingDate) + '</b>' : '<span class="hint">none</span>'}</td></tr>
          <tr><td>Bank transactions not yet reconciled</td><td class="num">${uncleared ? '<b>' + uncleared + '</b>' : '<span class="paid-tag">0 ✓</span>'}</td></tr>
          <tr><td>Vendors flagged 1099 without a W-9</td><td class="num">${state.vendors.filter(v => v.is1099 && !v.w9).length || '<span class="paid-tag">0 ✓</span>'}</td></tr>
          <tr><td>Audit log entries</td><td class="num">${(state.audit || []).length}</td></tr>
        </tbody></table>
      </div>
      <div class="card">
        <h2>What your accountant gets</h2>
        <p class="card-sub">The 📦 Accountant package downloads 17 CSV reports for any period: P&L (accrual and cash), balance sheet, cash flow, general ledger, trial balance, A/R and A/P aging, job costing, WIP, expenses by account and vendor, sales tax, payroll, 1099 vendors, mileage, and a QuickBooks/Xero-ready bank transaction file.</p>
        <p class="card-sub">Or give them the read-only accountant passcode (Settings → Security) and let them work directly in the app — they can view and export everything but change nothing.</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn primary" data-action="acct-package">📦 Download accountant package</button>
          <button class="btn" data-action="nav" data-view="settings">Security settings</button>
        </div>
      </div>
    </div>`;
}

function reportTableHtml(R) {
  const cell = c => (c && typeof c === 'object') ? (c.h ? `<b class="rep-h">${esc(c.h)}</b>` : `<b>${esc(c.b)}</b>`) : esc(c);
  const isNum = (c, i) => i > 0 && typeof c !== 'object' && /^[-−$0-9.,%—]*$/.test(String(c));
  return `
    <div class="table-wrap"><table class="data rep">
      <thead><tr>${R.cols.map((c, i) => `<th class="${i > 0 ? 'num' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${R.rows.length ? R.rows.map(r => `<tr class="${r[0] && r[0].h ? 'rep-section' : ''}">${r.map((c, i) => `<td class="${isNum(c, i) || (i > 0 && c && typeof c === 'object') ? 'num' : ''}">${cell(c)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${R.cols.length}" class="hint">Nothing in this period.</td></tr>`}</tbody>
      ${R.foot.length ? `<tfoot>${R.foot.map(r => `<tr class="rep-total">${r.map((c, i) => `<td class="${i > 0 ? 'num' : ''}"><b>${esc(c)}</b></td>`).join('')}</tr>`).join('')}</tfoot>` : ''}
    </table></div>`;
}

function acctReportsHtml(a) {
  const opts = { basis: a.basis, account: a.glAcct };
  const R = reportData(a.report, a.from, a.to, opts);
  const s = state.settings;
  return `
    <div class="card">
      <div class="toolbar">
        <select data-field="acct-report" aria-label="Report">${REPORTS.map(([k, l]) => `<option value="${k}" ${a.report === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${a.report === 'gl' ? `<select data-field="acct-glacct" aria-label="Account"><option value="">All accounts</option>${accountOptions(a.glAcct)}</select>` : ''}
        <div class="spacer"></div>
        <button class="btn small" data-action="acct-report-csv">Export CSV</button>
        <button class="btn small" data-action="acct-print">Print</button>
      </div>
      ${periodBarHtml(a, a.report === 'pnl')}
      <div class="rep-head">
        <div><b>${esc(s.companyName)} ${esc(s.tagline)}</b><br><span class="hint">${esc(R.title)} · ${dateLabel(a.from)} – ${dateLabel(a.to)}</span></div>
        ${R.notes ? `<p class="hint" style="max-width:520px">${esc(R.notes)}</p>` : ''}
      </div>
      ${reportTableHtml(R)}
    </div>`;
}

/* ---------- Bills & Expenses ---------- */

function acctBillsHtml(a) {
  const bills = state.bills.slice().filter(b => a.billFilter === 'all' || (a.billFilter === 'unpaid' ? !b.paid : b.paid)).sort((x, y) => y.date.localeCompare(x.date));
  const unpaid = state.bills.filter(b => !b.paid).reduce((s, b) => s + num(b.amount), 0);
  const miles = state.mileage.slice().sort((x, y) => y.date.localeCompare(x.date)).slice(0, 12);
  return `
    <div class="card">
      <div class="toolbar">
        <select data-field="acct-billfilter"><option value="all" ${a.billFilter === 'all' ? 'selected' : ''}>All bills & expenses</option><option value="unpaid" ${a.billFilter === 'unpaid' ? 'selected' : ''}>Unpaid only</option><option value="paid" ${a.billFilter === 'paid' ? 'selected' : ''}>Paid only</option></select>
        <span class="hint">Unpaid: <b>${money(unpaid, true)}</b></span>
        <div class="spacer"></div>
        <button class="btn primary" data-action="acct-new-bill">+ Add bill / expense</button>
      </div>
      <p class="card-sub">Overhead and business costs that aren't tied to one job — rent, insurance, fuel, software, tools, subscriptions. Job-specific costs go on the job itself.</p>
      ${bills.length === 0 ? '<div class="empty"><h3>No bills yet</h3><p>Add a bill when it arrives, then mark it paid when you pay it — that keeps A/P aging and cash flow accurate.</p></div>' : `
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Date</th><th>Vendor</th><th>Account</th><th>Ref</th><th class="num">Amount</th><th>Status</th></tr></thead>
        <tbody>${bills.map(b => `
          <tr class="rowlink" data-action="acct-open-bill" data-id="${esc(b.id)}">
            <td>${dateLabel(b.date)}</td>
            <td><b>${esc(vendorName(b.vendorId) || b.vendorName || '—')}</b>${b.memo ? `<br><span class="hint">${esc(b.memo)}</span>` : ''}</td>
            <td>${esc(acctLabel(b.accountId))}</td>
            <td>${esc(b.ref || '—')}</td>
            <td class="num">${money(num(b.amount), true)}</td>
            <td>${b.paid ? '<span class="paid-tag">Paid ✓ ' + dateLabel(b.paidDate || b.date) + '</span>' : (b.dueDate && b.dueDate < todayISO() ? '<span class="overdue-tag">OVERDUE</span>' : '<span class="hint">Unpaid' + (b.dueDate ? ' · due ' + dateLabel(b.dueDate) : '') + '</span>')}</td>
          </tr>`).join('')}</tbody>
      </table></div>`}
    </div>
    <div class="card">
      <div class="toolbar"><h2 style="margin:0">Mileage log</h2><div class="spacer"></div><button class="btn small" data-action="acct-new-mileage">+ Log miles</button></div>
      <p class="card-sub">Business miles at ${money(num(state.settings.mileageRate), true)}/mile (set the current IRS rate in Settings).</p>
      ${miles.length === 0 ? '<p class="hint">No mileage logged.</p>' : `<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Purpose</th><th class="num">Miles</th><th class="num">Deduction</th><th></th></tr></thead>
        <tbody>${miles.map(m => `<tr><td>${dateLabel(m.date)}</td><td>${esc(m.purpose || '')}</td><td class="num">${num(m.miles).toFixed(1)}</td><td class="num">${money(num(m.miles) * num(state.settings.mileageRate), true)}</td><td class="num"><button class="btn-icon" data-action="acct-del-mileage" data-id="${esc(m.id)}" title="Delete">✕</button></td></tr>`).join('')}</tbody></table></div>`}
    </div>`;
}

function openBillDialog(billId, prefill) {
  const dlg = $('#acct-dialog');
  const b = billId ? state.bills.find(x => x.id === billId) : null;
  const v = b || Object.assign({ date: todayISO(), vendorName: '', accountId: 'a6990', amount: '', memo: '', ref: '', dueDate: '', paid: false, paidDate: '', paidFrom: defaultBank(), method: 'Card' }, prefill || {});
  const vName = b ? (vendorName(b.vendorId) || b.vendorName || '') : (v.vendorName || '');
  dlg.dataset.kind = 'bill';
  dlg.dataset.id = b ? b.id : '';
  dlg.innerHTML = `
    <div class="dialog-head"><h2>${b ? 'Bill / expense' : 'New bill / expense'}</h2><button class="btn-icon" data-action="acct-dlg-close" aria-label="Close">✕</button></div>
    <div class="dialog-body">
      <div class="form-grid">
        <div class="field"><label>Vendor *</label><input id="bd-vendor" type="text" value="${esc(vName)}" list="vendor-datalist" autocomplete="off"><datalist id="vendor-datalist">${state.vendors.map(x => `<option value="${esc(x.name)}"></option>`).join('')}</datalist></div>
        <div class="field"><label>Bill date *</label><input id="bd-date" type="date" value="${esc(v.date)}"></div>
        <div class="field"><label>Account (what it's for) *</label><select id="bd-account">${accountOptions(v.accountId, ['expense', 'cogs', 'asset', 'liability', 'equity'])}</select></div>
        <div class="field"><label>Amount *</label><input id="bd-amount" type="number" min="0" step="0.01" value="${esc(v.amount)}"></div>
        <div class="field"><label>Invoice / reference #</label><input id="bd-ref" type="text" value="${esc(v.ref || '')}"></div>
        <div class="field"><label>Due date</label><input id="bd-due" type="date" value="${esc(v.dueDate || '')}"></div>
        <div class="field span-2"><label>Memo</label><input id="bd-memo" type="text" value="${esc(v.memo || '')}" placeholder="What was this for?"></div>
        <div class="field span-2"><label class="paid-check" style="font-size:14px"><input type="checkbox" id="bd-paid" ${v.paid ? 'checked' : ''}> Paid</label></div>
        <div class="field"><label>Paid on</label><input id="bd-paiddate" type="date" value="${esc(v.paidDate || v.date)}"></div>
        <div class="field"><label>Paid from</label><select id="bd-paidfrom">${bankAccounts().map(x => `<option value="${esc(x.id)}" ${x.id === (v.paidFrom || defaultBank()) ? 'selected' : ''}>${x.number} · ${esc(x.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Method</label><select id="bd-method">${PAYMENT_METHODS.map(m => `<option ${m === v.method ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      </div>
      ${b ? `
      <h2 style="margin-top:20px">Receipt / invoice</h2>
      <div class="file-rows" id="ac-files"><p class="hint">Loading…</p></div>
      <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
        <label class="btn small" style="cursor:pointer;">+ Attach file<input type="file" id="ac-file-input" multiple hidden></label>
        <label class="btn small" style="cursor:pointer;">📷 Take photo<input type="file" id="ac-photo-input" accept="image/*" capture="environment" hidden></label>
      </div>` : '<p class="hint" style="margin-top:14px">Save the bill first to attach the receipt.</p>'}
    </div>
    <div class="dialog-foot">
      ${b ? '<button class="btn danger" data-action="acct-del-bill">Delete</button>' : '<span></span>'}
      <div class="grow"></div>
      <button class="btn" data-action="acct-dlg-close">Cancel</button>
      <button class="btn primary" data-action="acct-save-bill">${b ? 'Save changes' : 'Add bill'}</button>
    </div>`;
  dlg.showModal();
  if (b) renderOwnerFiles('bill:' + b.id, '#ac-files');
}

function saveBillFromDialog() {
  const dlg = $('#acct-dialog');
  const id = dlg.dataset.id;
  const existing = id ? state.bills.find(x => x.id === id) : null;
  const vname = $('#bd-vendor').value.trim();
  const date = $('#bd-date').value;
  const amount = num($('#bd-amount').value);
  if (!vname) { toast('Enter the vendor'); $('#bd-vendor').focus(); return; }
  if (!date) { toast('Enter the bill date'); return; }
  if (amount <= 0) { toast('Enter the amount'); return; }
  if (isClosed(date) || (existing && isClosed(existing.date))) { toast('That period is closed (closing date ' + dateLabel(state.settings.closingDate) + '). Change it in Settings to edit.'); return; }
  const vendor = ensureVendor(vname);
  const b = existing || { id: uid(), createdAt: new Date().toISOString() };
  Object.assign(b, {
    date, vendorId: vendor.id, vendorName: vendor.name, accountId: $('#bd-account').value, amount,
    ref: $('#bd-ref').value.trim(), dueDate: $('#bd-due').value, memo: $('#bd-memo').value.trim(),
    paid: $('#bd-paid').checked, paidDate: $('#bd-paid').checked ? ($('#bd-paiddate').value || date) : '',
    paidFrom: $('#bd-paidfrom').value, method: $('#bd-method').value,
  });
  if (!existing) state.bills.push(b);
  logAudit(existing ? 'update' : 'create', 'bill', b.id, vendor.name + ' ' + money(amount, true) + (b.paid ? ' (paid)' : ''));
  saveState();
  dlg.close();
  renderAccounting();
  toast(existing ? 'Bill updated' : 'Bill added');
}

function openMileageDialog() {
  const dlg = $('#acct-dialog');
  dlg.dataset.kind = 'mileage'; dlg.dataset.id = '';
  dlg.innerHTML = `
    <div class="dialog-head"><h2>Log mileage</h2><button class="btn-icon" data-action="acct-dlg-close" aria-label="Close">✕</button></div>
    <div class="dialog-body"><div class="form-grid">
      <div class="field"><label>Date</label><input id="md-date" type="date" value="${todayISO()}"></div>
      <div class="field"><label>Miles</label><input id="md-miles" type="number" min="0" step="0.1"></div>
      <div class="field span-2"><label>Purpose</label><input id="md-purpose" type="text" placeholder="e.g. supplier run, estimate visit"></div>
      <div class="field span-2"><label>Job (optional)</label><select id="md-job"><option value="">—</option>${state.jobs.map(j => `<option value="${esc(j.id)}">${esc(j.address)}</option>`).join('')}</select></div>
    </div></div>
    <div class="dialog-foot"><div class="grow"></div><button class="btn" data-action="acct-dlg-close">Cancel</button><button class="btn primary" data-action="acct-save-mileage">Add</button></div>`;
  dlg.showModal();
}

/* ---------- Vendors ---------- */

function acctVendorsHtml() {
  const year = todayISO().slice(0, 4);
  const rows = state.vendors.slice().sort((a, b) => a.name.localeCompare(b.name)).map(v => {
    const bills = state.bills.filter(b => b.vendorId === v.id);
    const ytd = bills.filter(b => b.paid && (b.paidDate || b.date).slice(0, 4) === year).reduce((s, b) => s + num(b.amount), 0);
    const open = bills.filter(b => !b.paid).reduce((s, b) => s + num(b.amount), 0);
    return { v, n: bills.length, ytd, open };
  });
  return `
    <div class="card">
      <div class="toolbar"><p class="card-sub" style="margin:0">Suppliers, subcontractors, and anyone you pay. Flag subcontractors for 1099 tracking and note whether you have their W-9.</p><div class="spacer"></div><button class="btn primary" data-action="acct-new-vendor">+ Add vendor</button></div>
      ${rows.length === 0 ? '<div class="empty"><h3>No vendors yet</h3><p>Vendors are created automatically when you add a bill.</p></div>' : `
      <div class="table-wrap"><table class="data"><thead><tr><th>Vendor</th><th>Phone</th><th>1099</th><th>W-9</th><th class="num">Bills</th><th class="num">Paid ${year}</th><th class="num">Open balance</th></tr></thead>
      <tbody>${rows.map(({ v, n, ytd, open }) => `
        <tr class="rowlink" data-action="acct-open-vendor" data-id="${esc(v.id)}">
          <td><b>${esc(v.name)}</b>${v.email ? `<br><span class="hint">${esc(v.email)}</span>` : ''}</td>
          <td>${esc(v.phone || '—')}</td>
          <td>${v.is1099 ? '<span class="badge quoted"><span class="dot"></span>1099</span>' : '—'}</td>
          <td>${v.is1099 ? (v.w9 ? '<span class="paid-tag">On file ✓</span>' : '<span class="overdue-tag">MISSING</span>') : '—'}</td>
          <td class="num">${n}</td><td class="num">${money(ytd, true)}</td><td class="num">${open ? '<b>' + money(open, true) + '</b>' : '—'}</td>
        </tr>`).join('')}</tbody></table></div>`}
    </div>`;
}

function openVendorDialog(vendorId) {
  const dlg = $('#acct-dialog');
  const v = vendorId ? getVendor(vendorId) : null;
  dlg.dataset.kind = 'vendor'; dlg.dataset.id = v ? v.id : '';
  dlg.innerHTML = `
    <div class="dialog-head"><h2>${v ? 'Vendor' : 'New vendor'}</h2><button class="btn-icon" data-action="acct-dlg-close" aria-label="Close">✕</button></div>
    <div class="dialog-body"><div class="form-grid">
      <div class="field span-2"><label>Name *</label><input id="vd-name" type="text" value="${esc(v ? v.name : '')}"></div>
      <div class="field"><label>Phone</label><input id="vd-phone" type="tel" value="${esc(v ? v.phone : '')}"></div>
      <div class="field"><label>Email</label><input id="vd-email" type="email" value="${esc(v ? v.email : '')}"></div>
      <div class="field span-2"><label>Address</label><input id="vd-address" type="text" value="${esc(v ? v.address : '')}"></div>
      <div class="field"><label>Tax ID (EIN / SSN)</label><input id="vd-taxid" type="text" value="${esc(v ? v.taxId : '')}" placeholder="Stored for 1099s; masked in reports"></div>
      <div class="field"><label>&nbsp;</label>
        <label class="paid-check" style="font-size:14px"><input type="checkbox" id="vd-1099" ${v && v.is1099 ? 'checked' : ''}> 1099-eligible (subcontractor / services)</label>
        <label class="paid-check" style="font-size:14px"><input type="checkbox" id="vd-w9" ${v && v.w9 ? 'checked' : ''}> W-9 on file</label></div>
      <div class="field span-2"><label>Notes</label><textarea id="vd-notes">${esc(v ? v.notes : '')}</textarea></div>
    </div></div>
    <div class="dialog-foot">${v ? '<button class="btn danger" data-action="acct-del-vendor">Delete</button>' : '<span></span>'}<div class="grow"></div><button class="btn" data-action="acct-dlg-close">Cancel</button><button class="btn primary" data-action="acct-save-vendor">${v ? 'Save changes' : 'Add vendor'}</button></div>`;
  dlg.showModal();
}

function saveVendorFromDialog() {
  const dlg = $('#acct-dialog');
  const id = dlg.dataset.id;
  const name = $('#vd-name').value.trim();
  if (!name) { toast('Enter the vendor name'); return; }
  const v = (id && getVendor(id)) || { id: uid(), createdAt: new Date().toISOString() };
  const isNew = !id;
  Object.assign(v, { name, phone: $('#vd-phone').value.trim(), email: $('#vd-email').value.trim(), address: $('#vd-address').value.trim(), taxId: $('#vd-taxid').value.trim(), is1099: $('#vd-1099').checked, w9: $('#vd-w9').checked, notes: $('#vd-notes').value.trim() });
  if (isNew) state.vendors.push(v);
  state.bills.forEach(b => { if (b.vendorId === v.id) b.vendorName = v.name; });
  logAudit(isNew ? 'create' : 'update', 'vendor', v.id, name);
  saveState(); dlg.close(); renderAccounting(); toast(isNew ? 'Vendor added' : 'Vendor updated');
}

/* ---------- Register (general ledger view) + journal entries ---------- */

function acctRegisterHtml(a) {
  const T = buildLedger();
  const isBank = bankAccounts().some(b => b.id === a.regAcct);
  const accountSel = `<select data-field="acct-regacct" aria-label="Account"><option value="">All transactions (journal view)</option>${accountOptions(a.regAcct)}</select>`;
  let rows = '', running = 0;
  const A = acct(a.regAcct);
  for (const t of T) {
    if (!inRange(t.date, a.from, a.to)) continue;
    if (a.regAcct) {
      for (const l of t.lines) {
        if (l.acct !== a.regAcct) continue;
        running += signedBalance(A, l.dr, l.cr);
        const key = t.id + ':' + l.acct;
        rows += `<tr><td>${dateLabel(t.date)}</td><td>${esc(t.kind)}</td><td>${esc(t.desc)}${t.ref ? ` <span class="hint">#${esc(t.ref)}</span>` : ''}</td>
          <td class="num">${l.dr ? money(l.dr, true) : ''}</td><td class="num">${l.cr ? money(l.cr, true) : ''}</td><td class="num"><b>${money(running, true)}</b></td>
          ${isBank ? `<td><input type="checkbox" data-clear="${esc(key)}" ${state.cleared[key] ? 'checked' : ''} aria-label="Cleared"></td>` : ''}
          ${t.journalId ? `<td><button class="btn small" data-action="acct-open-je" data-id="${esc(t.journalId)}">Edit</button></td>` : (t.billId ? `<td><button class="btn small" data-action="acct-open-bill" data-id="${esc(t.billId)}">Open</button></td>` : (t.jobId ? `<td><button class="btn small" data-action="open-job" data-id="${esc(t.jobId)}">Job</button></td>` : '<td></td>'))}</tr>`;
      }
    } else {
      rows += `<tr class="rep-section"><td>${dateLabel(t.date)}</td><td>${esc(t.kind)}</td><td colspan="3"><b>${esc(t.desc)}</b>${t.ref ? ` <span class="hint">#${esc(t.ref)}</span>` : ''}</td>
        <td>${t.journalId ? `<button class="btn small" data-action="acct-open-je" data-id="${esc(t.journalId)}">Edit</button>` : (t.billId ? `<button class="btn small" data-action="acct-open-bill" data-id="${esc(t.billId)}">Open</button>` : (t.jobId ? `<button class="btn small" data-action="open-job" data-id="${esc(t.jobId)}">Job</button>` : ''))}</td></tr>` +
        t.lines.map(l => `<tr><td></td><td></td><td class="hint" style="padding-left:24px">${esc(acctLabel(l.acct))}</td><td class="num">${l.dr ? money(l.dr, true) : ''}</td><td class="num">${l.cr ? money(l.cr, true) : ''}</td><td></td></tr>`).join('');
    }
  }
  return `
    <div class="card">
      <div class="toolbar">${accountSel}<div class="spacer"></div><button class="btn primary" data-action="acct-new-je">+ Journal entry</button><button class="btn small" data-action="acct-opening">Opening balances</button></div>
      ${periodBarHtml(a, false)}
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Date</th><th>Type</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">${a.regAcct ? 'Balance' : ''}</th>${isBank ? '<th>Cleared</th>' : ''}<th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="hint">No transactions in this period.</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

function jeLineHtml(l) {
  l = l || { accountId: '', debit: '', credit: '' };
  return `<div class="expense-row je-row"><select data-je="acct"><option value="">Account…</option>${accountOptions(l.accountId)}</select><input type="number" min="0" step="0.01" placeholder="Debit" value="${l.debit === '' ? '' : esc(l.debit)}" data-je="dr"><input type="number" min="0" step="0.01" placeholder="Credit" value="${l.credit === '' ? '' : esc(l.credit)}" data-je="cr"><button type="button" class="btn-icon" data-action="acct-je-remove" aria-label="Remove line">✕</button></div>`;
}

function openJournalDialog(jeId, prefill) {
  const dlg = $('#acct-dialog');
  const je = jeId ? state.journal.find(x => x.id === jeId) : null;
  const v = je || Object.assign({ date: todayISO(), memo: '', ref: '', lines: [{}, {}] }, prefill || {});
  dlg.dataset.kind = 'je'; dlg.dataset.id = je ? je.id : '';
  dlg.innerHTML = `
    <div class="dialog-head"><h2>${je ? 'Journal entry' : 'New journal entry'}</h2><button class="btn-icon" data-action="acct-dlg-close" aria-label="Close">✕</button></div>
    <div class="dialog-body">
      <div class="form-grid">
        <div class="field"><label>Date *</label><input id="je-date" type="date" value="${esc(v.date)}"></div>
        <div class="field"><label>Reference</label><input id="je-ref" type="text" value="${esc(v.ref || '')}"></div>
        <div class="field span-2"><label>Memo *</label><input id="je-memo" type="text" value="${esc(v.memo || '')}" placeholder="Why this entry exists — your accountant will read this"></div>
      </div>
      <h2 style="margin-top:18px">Lines</h2>
      <p class="card-sub">Debits must equal credits.</p>
      <div class="expense-rows" id="je-lines">${(v.lines || []).map(jeLineHtml).join('')}</div>
      <button type="button" class="btn small" style="margin-top:10px" data-action="acct-je-add">+ Add line</button>
      <div class="calc-strip" id="je-calc"></div>
    </div>
    <div class="dialog-foot">${je ? '<button class="btn danger" data-action="acct-del-je">Delete</button>' : '<span></span>'}<div class="grow"></div><button class="btn" data-action="acct-dlg-close">Cancel</button><button class="btn primary" data-action="acct-save-je">${je ? 'Save changes' : 'Post entry'}</button></div>`;
  dlg.showModal();
  jeRecalc();
}

function readJeLines() {
  return $$('#je-lines .je-row').map(r => ({ accountId: $('[data-je="acct"]', r).value, debit: num($('[data-je="dr"]', r).value), credit: num($('[data-je="cr"]', r).value) })).filter(l => l.accountId && (l.debit || l.credit));
}

function jeRecalc() {
  const el = $('#je-calc'); if (!el) return;
  const lines = readJeLines();
  const dr = lines.reduce((s, l) => s + l.debit, 0), cr = lines.reduce((s, l) => s + l.credit, 0);
  const ok = Math.abs(dr - cr) < 0.005 && dr > 0;
  el.innerHTML = `<div><div class="calc-label">Debits</div><div class="calc-value">${money(dr, true)}</div></div><div><div class="calc-label">Credits</div><div class="calc-value">${money(cr, true)}</div></div><div><div class="calc-label">Status</div><div class="calc-value ${ok ? 'positive' : 'negative'}">${ok ? 'Balanced ✓' : 'Off by ' + money(Math.abs(dr - cr), true)}</div></div>`;
}

function saveJournalFromDialog() {
  const dlg = $('#acct-dialog');
  const id = dlg.dataset.id;
  const date = $('#je-date').value, memo = $('#je-memo').value.trim();
  const lines = readJeLines();
  const dr = lines.reduce((s, l) => s + l.debit, 0), cr = lines.reduce((s, l) => s + l.credit, 0);
  if (!date) { toast('Enter a date'); return; }
  if (!memo) { toast('Enter a memo'); return; }
  if (lines.length < 2 || Math.abs(dr - cr) >= 0.005 || dr <= 0) { toast('Debits must equal credits (at least two lines)'); return; }
  const existing = id ? state.journal.find(x => x.id === id) : null;
  if (isClosed(date) || (existing && isClosed(existing.date))) { toast('That period is closed (closing date ' + dateLabel(state.settings.closingDate) + ').'); return; }
  const je = existing || { id: uid(), createdAt: new Date().toISOString() };
  Object.assign(je, { date, memo, ref: $('#je-ref').value.trim(), lines });
  if (!existing) state.journal.push(je);
  logAudit(existing ? 'update' : 'create', 'journal', je.id, memo + ' ' + money(dr, true));
  saveState(); dlg.close(); renderAccounting(); toast(existing ? 'Entry updated' : 'Entry posted');
}

/* ---------- Reconcile ---------- */

function parseBankCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const split = l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); };
  const head = split(lines[0]).map(h => h.toLowerCase());
  const idx = names => head.findIndex(h => names.some(n => h.includes(n)));
  const iDate = idx(['date']), iDesc = idx(['description', 'memo', 'payee', 'name', 'details']), iAmt = idx(['amount']), iDr = idx(['debit', 'withdrawal']), iCr = idx(['credit', 'deposit']);
  const toIso = s => { const d = new Date(s); return isNaN(d) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const rows = [];
  for (const l of lines.slice(1)) {
    const c = split(l); if (c.length < 2) continue;
    const date = iDate >= 0 ? toIso(c[iDate]) : ''; if (!date) continue;
    let amount = 0;
    if (iAmt >= 0) amount = num(c[iAmt].replace(/[$,]/g, ''));
    else amount = num((c[iCr] || '0').replace(/[$,]/g, '')) - num((c[iDr] || '0').replace(/[$,]/g, ''));
    rows.push({ date, desc: iDesc >= 0 ? c[iDesc] : '', amount: r2(amount) });
  }
  return rows;
}

/* Match imported statement lines to uncleared register lines by amount within a week. */
function autoMatchStatement(accountId, imported) {
  const T = buildLedger(); const A = acct(accountId);
  const candidates = [];
  for (const t of T) for (const l of t.lines) if (l.acct === accountId) candidates.push({ key: t.id + ':' + accountId, date: t.date, amount: r2(A.type === 'liability' ? l.cr - l.dr : l.dr - l.cr), desc: t.desc });
  let matched = 0;
  for (const row of imported) {
    row.matched = null;
    const hit = candidates.find(c => !state.cleared[c.key] && !c.used && Math.abs(c.amount - row.amount) < 0.005 && Math.abs(daysBetween(c.date, row.date)) <= 7);
    if (hit) { hit.used = true; state.cleared[hit.key] = true; row.matched = hit.desc; matched++; }
  }
  return matched;
}

function acctReconcileHtml(a) {
  const T = buildLedger(); const A = acct(a.regAcct) || bankAccounts()[0];
  if (!A) return '<div class="card"><p class="hint">Add a bank account in Chart of Accounts first.</p></div>';
  const accountSel = `<select data-field="acct-regacct" aria-label="Bank account">${bankAccounts().map(x => `<option value="${esc(x.id)}" ${x.id === A.id ? 'selected' : ''}>${x.number} · ${esc(x.name)}</option>`).join('')}</select>`;
  let clearedBal = 0, unclearedCount = 0, uncleared = [];
  for (const t of T) for (const l of t.lines) {
    if (l.acct !== A.id || t.date > a.stmtDate) continue;
    const key = t.id + ':' + A.id; const amt = signedBalance(A, l.dr, l.cr);
    if (state.cleared[key]) clearedBal += amt; else { unclearedCount++; uncleared.push({ key, t, amt }); }
  }
  const stmt = a.stmtBalance === '' ? null : num(a.stmtBalance);
  const diff = stmt == null ? null : r2(stmt - clearedBal);
  const imported = a.imported || [];
  return `
    <div class="card">
      <div class="toolbar">${accountSel}<span class="hint">Statement ending</span><input type="date" data-field="acct-stmtdate" value="${esc(a.stmtDate)}"><input type="number" step="0.01" placeholder="Ending balance" data-field="acct-stmtbal" value="${esc(a.stmtBalance)}" style="width:150px"></div>
      <div class="calc-strip">
        <div><div class="calc-label">Cleared balance</div><div class="calc-value">${money(clearedBal, true)}</div></div>
        <div><div class="calc-label">Statement balance</div><div class="calc-value">${stmt == null ? '—' : money(stmt, true)}</div></div>
        <div><div class="calc-label">Difference</div><div class="calc-value ${diff == null ? '' : (Math.abs(diff) < 0.005 ? 'positive' : 'negative')}">${diff == null ? '—' : (Math.abs(diff) < 0.005 ? 'Reconciled ✓' : money(diff, true))}</div></div>
        <div><div class="calc-label">Uncleared items</div><div class="calc-value">${unclearedCount}</div></div>
      </div>
      <p class="card-sub" style="margin-top:14px">Tick each transaction as it appears on your bank statement (Register tab, or import the statement below). When the difference reaches $0.00, the account is reconciled.</p>
      <div class="toolbar"><label class="btn small" style="cursor:pointer">📥 Import bank statement CSV<input type="file" id="acct-stmt-file" accept=".csv,text/csv" hidden></label><span class="hint">Any bank export with Date, Description, and Amount (or Debit/Credit) columns. Matching lines are cleared automatically.</span></div>
      ${imported.length ? `
        <h2 style="margin-top:12px">Imported statement lines</h2>
        <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th>Match</th><th></th></tr></thead>
        <tbody>${imported.map((r, i) => `<tr><td>${dateLabel(r.date)}</td><td>${esc(r.desc)}</td><td class="num">${money(r.amount, true)}</td>
          <td>${r.matched ? '<span class="paid-tag">Matched ✓</span> <span class="hint">' + esc(r.matched) + '</span>' : '<span class="overdue-tag">NOT IN BOOKS</span>'}</td>
          <td class="num" style="white-space:nowrap">${r.matched ? '' : (r.amount < 0 ? `<button class="btn small" data-action="acct-import-expense" data-i="${i}">Record as expense</button>` : `<button class="btn small" data-action="acct-import-deposit" data-i="${i}">Record as deposit</button>`)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <h2 style="margin-top:16px">Uncleared through ${dateLabel(a.stmtDate)}</h2>
      ${uncleared.length === 0 ? '<p class="hint">Everything is cleared.</p>' : `<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th>Cleared</th></tr></thead>
        <tbody>${uncleared.map(u => `<tr><td>${dateLabel(u.t.date)}</td><td>${esc(u.t.desc)}</td><td class="num">${money(u.amt, true)}</td><td><input type="checkbox" data-clear="${esc(u.key)}" aria-label="Cleared"></td></tr>`).join('')}</tbody></table></div>`}
    </div>`;
}

/* ---------- Chart of accounts ---------- */

function acctAccountsHtml() {
  const T = buildLedger(); const today = todayISO();
  return `
    <div class="card">
      <div class="toolbar"><p class="card-sub" style="margin:0">Your chart of accounts. Numbering follows the standard 1000s assets / 2000s liabilities / 3000s equity / 4000s income / 5000s job costs / 6000s overhead.</p><div class="spacer"></div><button class="btn primary" data-action="acct-new-account">+ Add account</button></div>
      ${ACCOUNT_TYPES.map(([t, label]) => `
        <h2 style="margin-top:16px">${label}</h2>
        <div class="table-wrap"><table class="data"><thead><tr><th style="width:90px">Number</th><th>Name</th><th>Kind</th><th class="num">Balance today</th><th></th></tr></thead>
        <tbody>${accountsOfType([t]).map(x => `<tr><td>${x.number}</td><td><b>${esc(x.name)}</b>${x.id === defaultBank() ? ' <span class="hint">(default bank)</span>' : ''}</td><td class="hint">${esc(x.sub || '')}</td><td class="num">${money(accountBalance(T, x.id, today), true)}</td><td class="num"><button class="btn small" data-action="acct-open-account" data-id="${esc(x.id)}">Edit</button></td></tr>`).join('')}</tbody></table></div>`).join('')}
    </div>`;
}

function openAccountDialog(accountId) {
  const dlg = $('#acct-dialog'); const x = accountId ? acct(accountId) : null;
  dlg.dataset.kind = 'account'; dlg.dataset.id = x ? x.id : '';
  dlg.innerHTML = `
    <div class="dialog-head"><h2>${x ? 'Account' : 'New account'}</h2><button class="btn-icon" data-action="acct-dlg-close" aria-label="Close">✕</button></div>
    <div class="dialog-body"><div class="form-grid">
      <div class="field"><label>Number *</label><input id="ad-number" type="number" value="${x ? x.number : ''}"></div>
      <div class="field"><label>Type *</label><select id="ad-type" ${x && x.system ? 'disabled' : ''}>${ACCOUNT_TYPES.map(([t, l]) => `<option value="${t}" ${x && x.type === t ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field span-2"><label>Name *</label><input id="ad-name" type="text" value="${esc(x ? x.name : '')}"></div>
      <div class="field"><label>Kind</label><select id="ad-sub"><option value="">—</option><option value="bank" ${x && x.sub === 'bank' ? 'selected' : ''}>Bank / cash account</option><option value="card" ${x && x.sub === 'card' ? 'selected' : ''}>Credit card</option><option value="fixed" ${x && x.sub === 'fixed' ? 'selected' : ''}>Fixed asset</option></select></div>
      <div class="field"><label>&nbsp;</label><label class="paid-check" style="font-size:14px"><input type="checkbox" id="ad-active" ${!x || x.active !== false ? 'checked' : ''}> Active</label></div>
    </div>${x && x.system ? '<p class="hint" style="margin-top:12px">This is a system account used by automatic entries — you can rename it but not change its type.</p>' : ''}</div>
    <div class="dialog-foot"><div class="grow"></div><button class="btn" data-action="acct-dlg-close">Cancel</button><button class="btn primary" data-action="acct-save-account">Save</button></div>`;
  dlg.showModal();
}

function saveAccountFromDialog() {
  const dlg = $('#acct-dialog'); const id = dlg.dataset.id;
  const number = Math.round(num($('#ad-number').value)), name = $('#ad-name').value.trim();
  if (!number || !name) { toast('Enter a number and name'); return; }
  const x = (id && acct(id)) || { id: uid(), system: false };
  const isNew = !id;
  if (!x.system) x.type = $('#ad-type').value;
  Object.assign(x, { number, name, sub: $('#ad-sub').value, active: $('#ad-active').checked });
  if (isNew) state.accounts.push(x);
  logAudit(isNew ? 'create' : 'update', 'account', x.id, number + ' ' + name);
  saveState(); dlg.close(); renderAccounting(); toast('Account saved');
}

/* ---------- Documents center ---------- */

function ownerLabelForFile(f) {
  if (String(f.jobId).startsWith('bill:')) { const b = state.bills.find(x => x.id === f.jobId.slice(5)); return b ? 'Bill — ' + (vendorName(b.vendorId) || b.vendorName || '') + ' ' + dateLabel(b.date) : 'Bill'; }
  const j = state.jobs.find(x => x.id === f.jobId); return j ? 'Job — ' + j.address : 'Job';
}

async function renderDocuments(a) {
  const box = $('#acct-docs'); if (!box) return;
  let files = [];
  try { files = await rawAllFiles(); } catch (err) { box.innerHTML = '<p class="hint">File storage is not available in this browser.</p>'; return; }
  const q = (a.docSearch || '').toLowerCase();
  const rows = files.map(f => ({ f, owner: ownerLabelForFile(f) })).filter(r => !q || r.f.name.toLowerCase().includes(q) || r.owner.toLowerCase().includes(q)).sort((x, y) => (y.f.addedAt || '').localeCompare(x.f.addedAt || ''));
  const total = files.reduce((s, f) => s + (f.size || 0), 0);
  box.innerHTML = `
    <div class="toolbar"><input type="search" placeholder="Search documents…" value="${esc(a.docSearch || '')}" data-field="acct-docsearch"><span class="hint">${files.length} file${files.length === 1 ? '' : 's'} · ${fmtSize(total)}${secConfig() ? ' · encrypted at rest 🔒' : ''}</span></div>
    <p class="card-sub">Every invoice, receipt, contract, and photo attached anywhere in the app, in one place.</p>
    ${rows.length === 0 ? '<div class="empty"><h3>No documents</h3><p>Attach files on jobs and bills and they show up here.</p></div>' : `
    <div class="table-wrap"><table class="data"><thead><tr><th>Document</th><th>Belongs to</th><th>Added</th><th class="num">Size</th><th></th></tr></thead>
    <tbody>${rows.map(({ f, owner }) => `<tr><td><b>${esc(f.name)}</b></td><td>${esc(owner)}</td><td>${dateLabel((f.addedAt || '').slice(0, 10))}</td><td class="num">${fmtSize(f.size || 0)}</td>
      <td class="num" style="white-space:nowrap"><button class="btn small" data-action="file-open" data-id="${esc(f.id)}">View</button> <button class="btn small" data-action="file-download" data-id="${esc(f.id)}">Download</button></td></tr>`).join('')}</tbody></table></div>`}`;
}

/* Attachment list for any owner key (job id or 'bill:<id>'). */
async function renderOwnerFiles(ownerKey, containerSel) {
  const box = $(containerSel); if (!box) return;
  let files = [];
  try { files = await getJobFiles(ownerKey); } catch (err) { box.innerHTML = '<p class="hint">File storage is not available.</p>'; return; }
  if (!$(containerSel)) return;
  if (!files.length) { $(containerSel).innerHTML = '<p class="hint" style="margin:4px 0">No files attached yet.</p>'; return; }
  $(containerSel).innerHTML = files.map(f => `
    <div class="file-row">
      ${f.blob && f.type && f.type.startsWith('image/') ? `<img class="file-thumb" src="${URL.createObjectURL(f.blob)}" alt="">` : '<span class="file-icon">📄</span>'}
      <div class="file-meta"><b title="${esc(f.name)}">${esc(f.name)}</b><span class="hint">${fmtSize(f.size)} · added ${dateLabel((f.addedAt || '').slice(0, 10))}</span></div>
      <div class="file-actions"><button type="button" class="btn small" data-action="file-open" data-id="${esc(f.id)}">View</button><button type="button" class="btn small" data-action="file-download" data-id="${esc(f.id)}">Download</button><button type="button" class="btn-icon" data-action="file-delete" data-id="${esc(f.id)}" title="Delete file" aria-label="Delete file">✕</button></div>
    </div>`).join('');
}

/* ---------- Audit log ---------- */

function acctAuditHtml() {
  const rows = (state.audit || []).slice().reverse().slice(0, 500);
  return `
    <div class="card">
      <div class="toolbar"><p class="card-sub" style="margin:0">Every change to money records, settings, security, and data — newest first. This log cannot be edited from the app.</p><div class="spacer"></div><button class="btn small" data-action="acct-audit-csv">Export CSV</button></div>
      ${rows.length === 0 ? '<p class="hint">No activity recorded yet.</p>' : `<div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td style="white-space:nowrap">${esc(r.ts.replace('T', ' ').slice(0, 16))}</td><td>${esc(r.user)}</td><td>${esc(r.action)}</td><td>${esc(r.entity)}</td><td>${esc(r.summary)}</td></tr>`).join('')}</tbody></table></div>`}
    </div>`;
}

/* ---------- Security UI (settings card + lock screen) ---------- */

function securityCardHtml() {
  const cfg = secConfig();
  return `
    <div class="card">
      <h2>Security &amp; access</h2>
      ${cfg ? `
        <p class="card-sub">🔒 <b>Passcode protection is on.</b> All data and attached files are encrypted on this device (AES-256) and the app locks after ${num(cfg.autoLockMin) || 0} minutes idle. You are signed in as <b>${session.role === 'accountant' ? 'accountant (read-only)' : 'owner'}</b>.</p>
        ${session.role === 'owner' ? `
        <div class="form-grid">
          <div class="field"><label>Auto-lock after (minutes, 0 = never)</label><input type="number" min="0" step="1" id="sec-autolock" value="${num(cfg.autoLockMin)}"></div>
          <div class="field"><label>&nbsp;</label><button class="btn" data-action="sec-autolock-save">Save auto-lock</button></div>
          <div class="field"><label>New owner passcode</label><input type="password" id="sec-new-owner" autocomplete="new-password"></div>
          <div class="field"><label>&nbsp;</label><button class="btn" data-action="sec-change-owner">Change owner passcode</button></div>
          <div class="field"><label>Accountant passcode (read-only access)</label><input type="password" id="sec-acct" autocomplete="new-password" placeholder="${cfg.acct ? 'Set — enter a new one to replace' : 'Not set'}"></div>
          <div class="field"><label>&nbsp;</label><button class="btn" data-action="sec-set-acct">${cfg.acct ? 'Replace' : 'Create'} accountant passcode</button>${cfg.acct ? ' <button class="btn small" data-action="sec-remove-acct">Remove</button>' : ''}</div>
        </div>
        <p class="hint" style="margin-top:10px">Give the accountant passcode to your CPA or bookkeeper: they can open the app, view everything, and export any report, but cannot add, change, or delete anything.</p>
        <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;"><button class="btn" data-action="sec-lock">🔒 Lock now</button><button class="btn danger" data-action="sec-disable">Turn off passcode protection</button></div>` : ''}` : `
        <p class="card-sub">Protect your books with a passcode. When it's on, everything the app stores on this device — jobs, customers, financials, and every attached file — is encrypted with AES-256, the app locks itself when idle, and you can create a separate <b>read-only passcode for your accountant</b>.</p>
        <div class="form-grid">
          <div class="field"><label>Owner passcode (6+ characters)</label><input type="password" id="sec-pass1" autocomplete="new-password"></div>
          <div class="field"><label>Confirm passcode</label><input type="password" id="sec-pass2" autocomplete="new-password"></div>
        </div>
        <p class="hint" style="margin:8px 0 12px"><b>Important:</b> there is no "forgot passcode" recovery — if it's lost, the only way back is restoring a backup file. Keep a recent backup (below) somewhere safe.</p>
        <button class="btn primary" data-action="sec-enable">Turn on passcode protection</button>`}
    </div>`;
}

function showLockScreen(msg) {
  const el = $('#lock-screen');
  const s = state.settings;
  el.innerHTML = `
    <div class="lock-card">
      <img src="assets/logo.png" alt="">
      <h1>Books are locked</h1>
      <p>Enter your passcode to continue. Accountants use their read-only passcode.</p>
      <form id="lock-form" autocomplete="off">
        <input type="password" id="lock-pass" placeholder="Passcode" autocomplete="current-password" autofocus>
        <button class="btn primary" type="submit">Unlock</button>
      </form>
      <p class="lock-msg ${msg ? 'err' : ''}" id="lock-msg">${esc(msg || '')}</p>
      <p class="hint">Lost your passcode? Restore a backup file from a fresh browser profile.</p>
    </div>`;
  el.hidden = false;
  document.body.classList.add('locked');
  document.body.classList.remove('readonly');
  setTimeout(() => { const i = $('#lock-pass'); if (i) i.focus(); }, 50);
}

function hideLockScreen() {
  $('#lock-screen').hidden = true;
  document.body.classList.remove('locked');
}

async function handleUnlockSubmit() {
  const pass = $('#lock-pass').value;
  const msgEl = $('#lock-msg');
  msgEl.textContent = 'Checking…'; msgEl.classList.remove('err');
  try {
    const role = await unlockWithPasscode(pass);
    if (!role) { showLockScreen('Wrong passcode'); return; }
    hideLockScreen();
    applyRole();
    applyBrand();
    touchActivity();
    ui.acct = null;
    renderView();
    toast(role === 'accountant' ? 'Signed in as accountant (read-only)' : 'Unlocked');
  } catch (err) {
    console.error(err);
    showLockScreen('Could not unlock — ' + (err.message || 'error'));
  }
}

function applyRole() {
  document.body.classList.toggle('readonly', session.role === 'accountant');
  const badge = $('#role-badge');
  if (badge) { badge.hidden = session.role !== 'accountant'; }
  const lockBtn = $('#lock-btn');
  if (lockBtn) lockBtn.hidden = !secConfig();
}

async function enableSecurity(pass1, pass2) {
  if (!pass1 || pass1.length < 6) { toast('Passcode must be at least 6 characters'); return; }
  if (pass1 !== pass2) { toast('Passcodes don’t match'); return; }
  const salt = bufToB64(crypto.getRandomValues(new Uint8Array(16)));
  const iterations = 210000;
  const kek = await deriveKek(pass1, salt, iterations);
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const owner = await wrapDek(dek, kek);
  localStorage.setItem(SEC_KEY, JSON.stringify({ v: 1, salt, iterations, owner, acct: null, autoLockMin: 10 }));
  session.dek = dek; session.role = 'owner'; session.locked = false;
  logAudit('security', 'passcode', '', 'Passcode protection enabled');
  saveState();
  await resealAllFiles();
  applyRole(); touchActivity(); renderSettings();
  toast('Passcode protection is on — data is now encrypted');
}

async function disableSecurity() {
  if (session.role !== 'owner') return;
  if (!confirm('Turn off passcode protection? Data on this device will be stored unencrypted again.')) return;
  logAudit('security', 'passcode', '', 'Passcode protection disabled');
  await resealAllFiles(null);
  session.dek = null;
  localStorage.removeItem(SEC_KEY);
  clearTimeout(session.lockTimer);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  applyRole(); renderSettings();
  toast('Passcode protection is off');
}

async function setWrappedPasscode(slot, pass) {
  if (session.role !== 'owner' || !session.dek) return;
  if (!pass || pass.length < 6) { toast('Passcode must be at least 6 characters'); return; }
  const cfg = secConfig();
  const kek = await deriveKek(pass, cfg.salt, cfg.iterations);
  cfg[slot] = await wrapDek(session.dek, kek);
  localStorage.setItem(SEC_KEY, JSON.stringify(cfg));
  logAudit('security', 'passcode', '', slot === 'owner' ? 'Owner passcode changed' : 'Accountant passcode set');
  saveState(); renderSettings();
  toast(slot === 'owner' ? 'Owner passcode changed' : 'Accountant passcode saved');
}

/* ---------- Settings: accounting card ---------- */

function accountingSettingsHtml() {
  const s = state.settings;
  return `
    <div class="card">
      <h2>Accounting</h2>
      <p class="card-sub">Settings your accountant will care about. Changes are recorded in the audit log.</p>
      <div class="form-grid">
        <div class="field"><label for="set-fy">Fiscal year starts in</label><select id="set-fy" data-setting="fiscalYearStart">${MONTHS.map((m, i) => `<option value="${i + 1}" ${num(s.fiscalYearStart) === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="field"><label for="set-basis">Default report basis</label><select id="set-basis" data-setting="accountingBasis"><option value="accrual" ${s.accountingBasis !== 'cash' ? 'selected' : ''}>Accrual</option><option value="cash" ${s.accountingBasis === 'cash' ? 'selected' : ''}>Cash</option></select></div>
        <div class="field"><label for="set-closing">Closing date (period lock)</label><input id="set-closing" type="date" value="${esc(s.closingDate || '')}" data-setting="closingDate"><span class="hint">Money records dated on or before this date can’t be edited. Set it after your CPA closes a period.</span></div>
        <div class="field"><label for="set-tax">Sales tax rate (%) for new jobs</label><input id="set-tax" type="number" min="0" step="0.001" value="${esc(s.salesTaxRate)}" data-setting="salesTaxRate"><span class="hint">Leave 0 if you don’t charge sales tax. Adjustable per job.</span></div>
        <div class="field"><label for="set-mileage">IRS mileage rate ($/mile)</label><input id="set-mileage" type="number" min="0" step="0.005" value="${esc(s.mileageRate)}" data-setting="mileageRate"></div>
        <div class="field"><label for="set-bank">Default bank account</label><select id="set-bank" data-setting="defaultBankAccountId">${bankAccounts().filter(b => b.sub === 'bank').map(b => `<option value="${esc(b.id)}" ${b.id === defaultBank() ? 'selected' : ''}>${b.number} · ${esc(b.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="set-ein">Company EIN</label><input id="set-ein" type="text" value="${esc(s.ein || '')}" data-setting="ein" placeholder="XX-XXXXXXX"></div>
        <div class="field"><label for="set-user">Your name (for the audit log)</label><input id="set-user" type="text" value="${esc(s.userName || 'Owner')}" data-setting="userName"></div>
      </div>
    </div>`;
}

/* ---------- Action router (called from main.js) ---------- */

function acctPeriod(p) {
  const a = acctUi(); const t = todayISO();
  if (p === 'fy') { const fy = fiscalYearRange(); a.from = fy.from; a.to = t < fy.to ? t : fy.to; }
  else if (p === 'lastfy') { const fy = fiscalYearRange(); const d = new Date(fy.from + 'T12:00:00'); d.setDate(d.getDate() - 1); const last = fiscalYearRange(d.toISOString().slice(0, 10)); a.from = last.from; a.to = last.to; }
  else if (p === 'month') { a.from = t.slice(0, 8) + '01'; a.to = t; }
  else if (p === 'quarter') { const m = Number(t.slice(5, 7)); const qs = m - ((m - 1) % 3); a.from = t.slice(0, 5) + String(qs).padStart(2, '0') + '-01'; a.to = t; }
  else if (p === 'all') { a.from = ''; a.to = t; }
}

function acctAction(action, el) {
  const a = acctUi();
  const dlg = $('#acct-dialog');
  switch (action) {
    case 'acct-tab': a.tab = el.dataset.tab; showView('accounting'); return true;
    case 'acct-period': acctPeriod(el.dataset.p); renderAccounting(); return true;
    case 'acct-basis': a.basis = el.dataset.basis; renderAccounting(); return true;
    case 'acct-print': window.print(); return true;
    case 'acct-package': exportAccountantPackage(a.from, a.to); return true;
    case 'acct-report-csv': downloadFile('NGPR_' + reportFileName(a.report, a.from, a.to), reportToCsv(a.report, a.from, a.to, { basis: a.basis, account: a.glAcct }), 'text/csv'); toast('Report exported'); return true;
    case 'acct-audit-csv': downloadFile('NGPR_audit-log.csv', toCsv(['When', 'Who', 'Action', 'Record', 'Details'], (state.audit || []).map(r => [r.ts, r.user, r.action, r.entity, r.summary])), 'text/csv'); return true;
    case 'acct-dlg-close': dlg.close(); return true;
    /* bills */
    case 'acct-new-bill': openBillDialog(null); return true;
    case 'acct-open-bill': openBillDialog(el.dataset.id); return true;
    case 'acct-save-bill': saveBillFromDialog(); return true;
    case 'acct-del-bill': {
      const b = state.bills.find(x => x.id === dlg.dataset.id);
      if (b && !isClosed(b.date) && confirm('Delete this bill?')) { state.bills = state.bills.filter(x => x.id !== b.id); deleteJobFiles('bill:' + b.id).catch(() => {}); logAudit('delete', 'bill', b.id, (vendorName(b.vendorId) || b.vendorName) + ' ' + money(num(b.amount), true)); saveState(); dlg.close(); renderAccounting(); toast('Bill deleted'); }
      else if (b && isClosed(b.date)) toast('That period is closed.');
      return true;
    }
    case 'acct-new-mileage': openMileageDialog(); return true;
    case 'acct-save-mileage': {
      const miles = num($('#md-miles').value); const date = $('#md-date').value;
      if (!date || miles <= 0) { toast('Enter a date and miles'); return true; }
      const m = { id: uid(), date, miles, purpose: $('#md-purpose').value.trim(), jobId: $('#md-job').value };
      state.mileage.push(m); logAudit('create', 'mileage', m.id, miles + ' mi'); saveState(); dlg.close(); renderAccounting(); toast('Mileage logged'); return true;
    }
    case 'acct-del-mileage': state.mileage = state.mileage.filter(m => m.id !== el.dataset.id); logAudit('delete', 'mileage', el.dataset.id, ''); saveState(); renderAccounting(); return true;
    /* vendors */
    case 'acct-new-vendor': openVendorDialog(null); return true;
    case 'acct-open-vendor': openVendorDialog(el.dataset.id); return true;
    case 'acct-save-vendor': saveVendorFromDialog(); return true;
    case 'acct-del-vendor': {
      const v = getVendor(dlg.dataset.id);
      if (v && confirm(`Delete "${v.name}"? Their bills are kept.`)) { state.vendors = state.vendors.filter(x => x.id !== v.id); logAudit('delete', 'vendor', v.id, v.name); saveState(); dlg.close(); renderAccounting(); toast('Vendor deleted'); }
      return true;
    }
    /* journal */
    case 'acct-new-je': openJournalDialog(null); return true;
    case 'acct-open-je': openJournalDialog(el.dataset.id); return true;
    case 'acct-opening': openJournalDialog(null, { memo: 'Opening balances', lines: [{ accountId: 'a1000' }, { accountId: 'a3000' }] }); return true;
    case 'acct-je-add': $('#je-lines').insertAdjacentHTML('beforeend', jeLineHtml()); return true;
    case 'acct-je-remove': el.closest('.je-row').remove(); jeRecalc(); return true;
    case 'acct-save-je': saveJournalFromDialog(); return true;
    case 'acct-del-je': {
      const je = state.journal.find(x => x.id === dlg.dataset.id);
      if (je && !isClosed(je.date) && confirm('Delete this journal entry?')) { state.journal = state.journal.filter(x => x.id !== je.id); logAudit('delete', 'journal', je.id, je.memo); saveState(); dlg.close(); renderAccounting(); toast('Entry deleted'); }
      else if (je && isClosed(je.date)) toast('That period is closed.');
      return true;
    }
    /* accounts */
    case 'acct-new-account': openAccountDialog(null); return true;
    case 'acct-open-account': openAccountDialog(el.dataset.id); return true;
    case 'acct-save-account': saveAccountFromDialog(); return true;
    /* reconcile imports */
    case 'acct-import-expense': { const r = a.imported[Number(el.dataset.i)]; openBillDialog(null, { date: r.date, vendorName: r.desc.slice(0, 60), amount: Math.abs(r.amount), paid: true, paidDate: r.date, paidFrom: a.regAcct, memo: 'Imported from bank statement' }); return true; }
    case 'acct-import-deposit': { const r = a.imported[Number(el.dataset.i)]; openJournalDialog(null, { date: r.date, memo: 'Deposit: ' + r.desc.slice(0, 80), lines: [{ accountId: a.regAcct, debit: Math.abs(r.amount), credit: '' }, { accountId: 'a4900', debit: '', credit: Math.abs(r.amount) }] }); return true; }
    /* security */
    case 'sec-enable': enableSecurity($('#sec-pass1').value, $('#sec-pass2').value); return true;
    case 'sec-disable': disableSecurity(); return true;
    case 'sec-lock': lockSession(); showLockScreen(); return true;
    case 'sec-change-owner': setWrappedPasscode('owner', $('#sec-new-owner').value); return true;
    case 'sec-set-acct': setWrappedPasscode('acct', $('#sec-acct').value); return true;
    case 'sec-remove-acct': { const cfg = secConfig(); if (cfg) { cfg.acct = null; localStorage.setItem(SEC_KEY, JSON.stringify(cfg)); logAudit('security', 'passcode', '', 'Accountant passcode removed'); saveState(); renderSettings(); toast('Accountant passcode removed'); } return true; }
    case 'sec-autolock-save': { const cfg = secConfig(); if (cfg) { cfg.autoLockMin = Math.max(0, Math.round(num($('#sec-autolock').value))); localStorage.setItem(SEC_KEY, JSON.stringify(cfg)); touchActivity(); toast('Auto-lock updated'); } return true; }
  }
  return false;
}

/* Field changes inside the Accounting view. Unchanged values are ignored so a
   blur-triggered change event never re-renders under a click in progress. */
const ACCT_FIELD_KEYS = { 'acct-from': 'from', 'acct-to': 'to', 'acct-report': 'report', 'acct-glacct': 'glAcct', 'acct-regacct': 'regAcct', 'acct-billfilter': 'billFilter', 'acct-stmtdate': 'stmtDate', 'acct-stmtbal': 'stmtBalance', 'acct-docsearch': 'docSearch' };
function acctFieldChange(t) {
  const a = acctUi(); const k = ACCT_FIELD_KEYS[t.dataset.field];
  if (!k) return false;
  if (a[k] === t.value) return true;
  a[k] = t.value;
  if (k === 'docSearch') renderDocuments(a); else renderAccounting();
  return true;
}
