'use strict';

/* ============================================================
   Views
   ============================================================ */

function showView(name) {
  ui.view = name;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  renderView();
  window.scrollTo(0, 0);
}

function renderView() {
  if (ui.view === 'dashboard') renderDashboard();
  else if (ui.view === 'jobs') renderJobs();
  else if (ui.view === 'customers') renderCustomers();
  else if (ui.view === 'employees') renderEmployees();
  else if (ui.view === 'schedule') renderSchedule();
  else if (ui.view === 'scopes') renderScopes();
  else if (ui.view === 'pricing') renderPricing();
  else if (ui.view === 'accounting') renderAccounting();
  else if (ui.view === 'settings') renderSettings();
}

/* ---------- Dashboard ---------- */

function tileHtml(label, totals) {
  const negative = totals.profit < 0 ? ' negative' : '';
  return `
    <div class="tile">
      <div class="tile-label">${esc(label)}</div>
      <div class="tile-value${negative}">${money(totals.profit)}</div>
      <div class="tile-sub">
        <span>Revenue <b>${money(totals.revenue)}</b> · Expenses <b>${money(totals.expenses)}</b></span>
        <span>${totals.count} job${totals.count === 1 ? '' : 's'} completed</span>
      </div>
    </div>`;
}

function renderDashboard() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const quarter = Math.floor(month / 3);

  const rows = monthlyTotals(year);
  const monthTotals = rows[month];
  const quarterTotals = sumRows(rows.slice(quarter * 3, quarter * 3 + 3));
  const yearTotals = sumRows(rows);
  const allTime = allTimeTotals();

  const years = new Set([year]);
  for (const job of state.jobs) {
    if (REVENUE_STATUSES.includes(job.status)) years.add(Number(jobDate(job).slice(0, 4)));
  }
  if (!years.has(ui.chartYear)) ui.chartYear = year;
  const yearOptions = Array.from(years).sort((a, b) => b - a)
    .map(y => `<option value="${y}" ${y === ui.chartYear ? 'selected' : ''}>${y}</option>`).join('');

  const recent = state.jobs.slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 6);

  const WON = ['scheduled', 'in-progress', 'completed', 'paid'];
  const followups = state.jobs
    .filter(j => j.followUp && j.followUp <= todayISO() && ['lead', 'quoted'].includes(j.status))
    .sort((a, b) => a.followUp.localeCompare(b.followUp));
  const bySales = new Map();
  let pLeads = 0, pQuoted = 0, pWon = 0, pReached = 0;
  for (const j of state.jobs) {
    const won = WON.includes(j.status);
    const reached = won || j.status === 'quoted';
    if (j.status === 'lead') pLeads++;
    if (j.status === 'quoted') pQuoted++;
    if (won) pWon++;
    if (reached) pReached++;
    const name = (j.scope && j.scope.salesman) ? j.scope.salesman : '';
    if (name) {
      const r = bySales.get(name) || { name, leads: 0, won: 0, reached: 0, revenue: 0 };
      r.leads++;
      if (won) { r.won++; r.revenue += jobTotal(j); }
      if (reached) r.reached++;
      bySales.set(name, r);
    }
  }
  const pipeline = {
    total: state.jobs.length, leads: pLeads, quoted: pQuoted, won: pWon,
    rate: pReached > 0 ? Math.round(pWon / pReached * 100) : 0,
    rows: Array.from(bySales.values()).sort((a, b) => b.revenue - a.revenue),
  };
  const owed = state.jobs
    .filter(j => REVENUE_STATUSES.includes(j.status) && num(j.price) > 0 && balanceDue(j) > 0.005)
    .sort((a, b) => jobDate(a).localeCompare(jobDate(b)));
  const owedTotal = owed.reduce((s, j) => s + balanceDue(j), 0);

  $('#view-dashboard').innerHTML = `
    <div class="page-head">
      <div>
        <h1>Dashboard</h1>
        <p>Earnings are counted from jobs marked <b>Completed</b> or <b>Paid</b>, on their completion date.</p>
      </div>
      <button class="btn primary" data-action="new-job">+ New Job</button>
    </div>

    <div class="tiles">
      ${tileHtml('This Month — ' + MONTHS[month] + ' ' + year, monthTotals)}
      ${tileHtml('This Quarter — Q' + (quarter + 1) + ' ' + year, quarterTotals)}
      ${tileHtml('This Year — ' + year, yearTotals)}
      ${tileHtml('All Time', allTime)}
    </div>

    ${followups.length > 0 ? `
    <div class="card followup-card">
      <h2>Follow-ups due — ${followups.length}</h2>
      <p class="card-sub">Leads and quotes with a follow-up date that's today or past. Click to open.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Address</th><th>Client</th><th>Source</th><th>Follow up</th><th>Status</th></tr></thead>
        <tbody>${followups.map(j => `
          <tr class="rowlink" data-action="open-job" data-id="${esc(j.id)}">
            <td><b>${esc(j.address)}</b></td><td>${esc(j.client || '—')}</td><td>${esc(j.leadSource || '—')}</td>
            <td>${dateLabel(j.followUp)}${j.followUp < todayISO() ? ' <span class="overdue-tag">OVERDUE</span>' : ''}</td>
            <td>${statusBadge(j.status)}</td>
          </tr>`).join('')}</tbody></table></div>
    </div>` : ''}

    ${pipeline.total > 0 ? `
    <div class="card pipeline-card">
      <h2>Sales pipeline</h2>
      <p class="card-sub">Leads ${pipeline.leads} · Quoted ${pipeline.quoted} · Won ${pipeline.won} · Close rate ${pipeline.rate}%</p>
      ${pipeline.rows.length ? `
      <div class="table-wrap"><table class="data"><thead><tr><th>Salesman</th><th class="num">Leads</th><th class="num">Won</th><th class="num">Close rate</th><th class="num">Revenue won</th></tr></thead>
        <tbody>${pipeline.rows.map(r => `
          <tr><td><b>${esc(r.name)}</b></td><td class="num">${r.leads}</td><td class="num">${r.won}</td>
          <td class="num">${r.reached > 0 ? Math.round(r.won / r.reached * 100) + '%' : '—'}</td><td class="num">${money(r.revenue)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>` : ''}

    ${owed.length > 0 ? `
    <div class="card owed-card">
      <h2>Money owed to you — ${money(owedTotal)}</h2>
      <p class="card-sub">Finished jobs that aren't fully paid. Click one to record a payment.</p>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Address</th><th>Client</th><th>Completed</th><th class="num">Balance due</th></tr></thead>
          <tbody>
            ${owed.map(j => `
              <tr class="rowlink" data-action="open-job" data-id="${esc(j.id)}">
                <td><b>${esc(j.address)}</b></td>
                <td>${esc(j.client || '—')}</td>
                <td>${dateLabel(j.completedDate)}</td>
                <td class="num"><b>${money(balanceDue(j))}</b>${isOverdue(j) ? ' <span class="overdue-tag">OVERDUE</span>' : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}

    <div class="card">
      <div class="chart-head">
        <div>
          <h2>Monthly ${esc(metricLabel(ui.chartMetric))}</h2>
          <p class="card-sub" style="margin-bottom:0">By month for the selected year. Hover a month for the full breakdown.</p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <div class="seg" role="group" aria-label="Chart metric">
            <button data-action="chart-metric" data-metric="revenue" class="${ui.chartMetric === 'revenue' ? 'active' : ''}">Revenue</button>
            <button data-action="chart-metric" data-metric="expenses" class="${ui.chartMetric === 'expenses' ? 'active' : ''}">Expenses</button>
            <button data-action="chart-metric" data-metric="profit" class="${ui.chartMetric === 'profit' ? 'active' : ''}">Profit</button>
          </div>
          <div class="field" style="min-width:96px">
            <select data-field="chart-year" aria-label="Chart year">${yearOptions}</select>
          </div>
        </div>
      </div>
      <div class="chart-box" id="chart-box"></div>
      <details class="chart-table">
        <summary>View as table</summary>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Month</th><th class="num">Revenue</th><th class="num">Expenses</th><th class="num">Profit</th><th class="num">Jobs</th></tr></thead>
            <tbody>
              ${monthlyTotals(ui.chartYear).map((r, i) => `
                <tr>
                  <td>${MONTHS[i]} ${ui.chartYear}</td>
                  <td class="num">${money(r.revenue)}</td>
                  <td class="num">${money(r.expenses)}</td>
                  <td class="num ${r.profit < 0 ? 'profit-neg' : ''}">${money(r.profit)}</td>
                  <td class="num">${r.count}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </details>
    </div>

    <div class="card">
      <h2>Recent jobs</h2>
      <p class="card-sub">The latest jobs you've added, any status.</p>
      ${recent.length === 0 ? `
        <div class="empty">
          <h3>No jobs yet</h3>
          <p>Add your first job, or build a quote on the Pricing Sheet.</p>
          <button class="btn primary" data-action="new-job">+ New Job</button>
        </div>` : `
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Address</th><th>Service</th><th>Status</th><th class="num">Contract</th><th class="num">Profit</th></tr></thead>
            <tbody>
              ${recent.map(j => `
                <tr class="rowlink" data-action="open-job" data-id="${esc(j.id)}">
                  <td>${esc(j.address)}</td>
                  <td>${esc(serviceName(j.serviceId))}</td>
                  <td>${statusBadge(j.status)}</td>
                  <td class="num">${money(jobTotal(j))}</td>
                  <td class="num ${jobProfit(j) < 0 ? 'profit-neg' : 'profit-pos'}">${money(jobProfit(j))}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
    </div>`;

  renderChart();
}

function metricLabel(m) {
  return m === 'revenue' ? 'Revenue' : m === 'expenses' ? 'Expenses' : 'Profit';
}

/* ---------- Chart (SVG bar chart) ---------- */

function niceCeil(x) {
  if (x <= 0) return 0;
  const k = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * k >= x - 1e-9) return m * k;
  }
  return 10 * k;
}

function niceStep(span) {
  const raw = span / 4;
  if (raw <= 0) return 1;
  const k = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * k >= raw - 1e-9) return m * k;
  }
  return 10 * k;
}

function roundedBarPath(x, yEnd, w, h, up) {
  /* Bar with a 4px-rounded data end; the baseline end stays square. */
  const r = Math.min(4, w / 2, h);
  if (h <= 0.5) return '';
  if (up) {
    const y0 = yEnd + h;
    return `M${x},${y0} L${x},${yEnd + r} Q${x},${yEnd} ${x + r},${yEnd} L${x + w - r},${yEnd} Q${x + w},${yEnd} ${x + w},${yEnd + r} L${x + w},${y0} Z`;
  }
  const yb = yEnd + h;
  return `M${x},${yEnd} L${x},${yb - r} Q${x},${yb} ${x + r},${yb} L${x + w - r},${yb} Q${x + w},${yb} ${x + w},${yb - r} L${x + w},${yEnd} Z`;
}

function renderChart() {
  const box = $('#chart-box');
  if (!box) return;

  const year = ui.chartYear;
  const metric = ui.chartMetric;
  const data = monthlyTotals(year);
  const vals = data.map(d => d[metric]);

  const W = 760, H = 280, L = 58, R = 12, T = 16, B = 30;
  const iw = W - L - R, ih = H - T - B;

  let max = Math.max(0, ...vals);
  let min = Math.min(0, ...vals);
  if (max === 0 && min === 0) max = 10000;
  max = niceCeil(max);
  min = min < 0 ? -niceCeil(-min) : 0;
  const span = max - min;
  const y = v => T + ((max - v) / span) * ih;

  const step = niceStep(span);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  if (!ticks.some(t => Math.abs(t) < 1e-9)) ticks.push(0);

  const slot = iw / 12;
  const barW = Math.min(40, slot * 0.6);
  const color = metric === 'revenue' ? 'var(--series-revenue)'
    : metric === 'expenses' ? 'var(--series-expenses)'
    : 'var(--series-profit)';

  let bars = '', hovers = '', labels = '', grid = '';

  for (const t of ticks) {
    const ty = y(t);
    const isBase = Math.abs(t) < 1e-9;
    grid += `<line x1="${L}" x2="${W - R}" y1="${ty}" y2="${ty}" class="${isBase ? 'baseline' : 'gridline'}"/>`;
    grid += `<text x="${L - 8}" y="${ty + 3.5}" text-anchor="end" class="axis-text">${moneyShort(t)}</text>`;
  }

  data.forEach((d, i) => {
    const v = d[metric];
    const x = L + slot * i + (slot - barW) / 2;
    const cx = L + slot * i + slot / 2;
    if (Math.abs(v) > 1e-9) {
      const up = v >= 0;
      const yEnd = up ? y(v) : y(0);
      const h = Math.abs(y(v) - y(0));
      bars += `<path d="${roundedBarPath(x, yEnd, barW, h, up)}" style="fill:${color}" data-bar="${i}"/>`;
    }
    labels += `<text x="${cx}" y="${H - 10}" text-anchor="middle" class="axis-text">${MONTHS[i]}</text>`;
    hovers += `<rect x="${L + slot * i}" y="${T}" width="${slot}" height="${ih}" class="hover-col" data-idx="${i}"/>`;
  });

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly ${metricLabel(metric)} for ${year}. Use the table view below for exact values.">
      ${grid}${bars}${labels}${hovers}
    </svg>`;

  const tooltip = $('#chart-tooltip');
  const svg = $('svg', box);

  svg.addEventListener('pointermove', e => {
    const col = e.target.closest('.hover-col');
    if (!col) { tooltip.hidden = true; return; }
    const i = Number(col.dataset.idx);
    const d = data[i];
    tooltip.innerHTML = `
      <h4>${MONTHS[i]} ${year} · ${d.count} job${d.count === 1 ? '' : 's'}</h4>
      <div class="tt-row"><span><span class="swatch" style="background:var(--series-revenue)"></span>Revenue</span><span>${money(d.revenue)}</span></div>
      <div class="tt-row"><span><span class="swatch" style="background:var(--series-expenses)"></span>Expenses</span><span>${money(d.expenses)}</span></div>
      <div class="tt-row"><span><span class="swatch" style="background:var(--series-profit)"></span>Profit</span><span>${money(d.profit)}</span></div>`;
    tooltip.hidden = false;
    const pad = 14;
    let tx = e.clientX + pad, ty = e.clientY + pad;
    const rect = tooltip.getBoundingClientRect();
    if (tx + rect.width > window.innerWidth - 8) tx = e.clientX - rect.width - pad;
    if (ty + rect.height > window.innerHeight - 8) ty = e.clientY - rect.height - pad;
    tooltip.style.left = tx + 'px';
    tooltip.style.top = ty + 'px';
  });
  svg.addEventListener('pointerleave', () => { tooltip.hidden = true; });
}

/* ---------- Jobs ---------- */

function filteredJobs() {
  const q = ui.jobSearch.trim().toLowerCase();
  return state.jobs
    .filter(j => ui.jobStatus === 'all' || j.status === ui.jobStatus)
    .filter(j => !q ||
      (j.address || '').toLowerCase().includes(q) ||
      (j.client || '').toLowerCase().includes(q) ||
      serviceName(j.serviceId).toLowerCase().includes(q))
    .sort((a, b) => jobDate(b).localeCompare(jobDate(a)));
}

function renderJobs() {
  const jobs = filteredJobs();
  const statusOptions = [['all', 'All statuses']].concat(STATUSES)
    .map(([v, l]) => `<option value="${v}" ${ui.jobStatus === v ? 'selected' : ''}>${l}</option>`).join('');

  $('#view-jobs').innerHTML = `
    <div class="page-head">
      <div>
        <h1>Jobs</h1>
        <p>Every job with its address, contract price, expenses, and profit. Click a row to open it.</p>
      </div>
      <button class="btn primary" data-action="new-job">+ New Job</button>
    </div>

    <div class="card">
      <div class="toolbar">
        <input type="search" placeholder="Search address, client, or service…" value="${esc(ui.jobSearch)}" data-field="job-search" aria-label="Search jobs">
        <select data-field="job-status" aria-label="Filter by status">${statusOptions}</select>
        <div class="spacer"></div>
        <button class="btn small" data-action="export-csv">Export CSV</button>
      </div>

      ${jobs.length === 0 ? `
        <div class="empty">
          <h3>${state.jobs.length === 0 ? 'No jobs yet' : 'No jobs match your filters'}</h3>
          <p>${state.jobs.length === 0 ? 'Add your first job to start tracking money in and out.' : 'Try clearing the search or status filter.'}</p>
          ${state.jobs.length === 0 ? '<button class="btn primary" data-action="new-job">+ New Job</button>' : ''}
        </div>` : `
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Address</th><th>Service</th><th>Status</th><th>Date</th>
                <th class="num">Total</th><th class="num">Costs</th><th class="num">Profit</th><th class="num">Margin</th><th class="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              ${jobs.map(j => {
                const profit = jobProfit(j);
                const bal = balanceDue(j);
                const balCell = jobTotal(j) <= 0 ? '—'
                  : bal <= 0.005 ? '<span class="paid-tag">Paid ✓</span>'
                  : `${money(bal)}${isOverdue(j) ? ' <span class="overdue-tag">OVERDUE</span>' : ''}`;
                return `
                <tr class="rowlink" data-action="open-job" data-id="${esc(j.id)}">
                  <td><b>${esc(j.address)}</b>${j.scope ? ' <span class="file-badge" title="Scope of Work form on file">\ud83d\udccb</span>' : ''}${j.client ? `<br><span class="hint">${esc(j.client)}</span>` : ''}</td>
                  <td>${esc(serviceName(j.serviceId))}${managerName(j) ? `<br><span class="hint">PM: ${esc(managerName(j))}</span>` : ''}</td>
                  <td>${statusBadge(j.status)}</td>
                  <td>${dateLabel(jobDate(j))}</td>
                  <td class="num">${money(jobTotal(j))}</td>
                  <td class="num">${money(jobCosts(j))}</td>
                  <td class="num ${profit < 0 ? 'profit-neg' : 'profit-pos'}">${money(profit)}</td>
                  <td class="num">${jobTotal(j) > 0 ? jobMargin(j).toFixed(0) + '%' : '—'}</td>
                  <td class="num">${balCell}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
    </div>`;

  /* Annotate rows that have invoices/documents attached. */
  $$('#view-jobs tr[data-action="open-job"]').forEach(row => {
    countJobFiles(row.dataset.id).then(n => {
      if (n > 0 && row.isConnected) {
        $('td b', row).insertAdjacentHTML('afterend',
          ` <span class="file-badge" title="${n} file${n === 1 ? '' : 's'} attached">📎${n}</span>`);
      }
    }).catch(() => {});
  });
}

/* ---------- Job dialog ---------- */

function expenseRowHtml(exp) {
  exp = exp || { desc: '', category: 'Materials', amount: '', paid: false };
  return `
    <div class="expense-row job-expense-row">
      <input type="text" placeholder="What was it for? (e.g. shingles, underlayment)" value="${esc(exp.desc)}" data-exp="desc">
      <select data-exp="category">
        ${EXPENSE_CATEGORIES.map(c => `<option ${c === exp.category ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <input type="number" min="0" step="0.01" placeholder="0.00" value="${exp.amount === '' ? '' : esc(exp.amount)}" data-exp="amount" aria-label="Expense amount">
      <label class="paid-check" title="Check once this bill has been paid">
        <input type="checkbox" data-exp="paid" ${exp.paid ? 'checked' : ''}>Paid
      </label>
      <button type="button" class="btn-icon" data-action="jd-remove-expense" title="Remove expense" aria-label="Remove expense">✕</button>
    </div>`;
}

function laborRowHtml(l) {
  l = l || { employeeId: '', name: '', hours: '', amount: '' };
  const emp = getEmployee(l.employeeId);
  const hourly = emp && emp.payType === 'hourly';
  return `
    <div class="expense-row labor-row">
      <select data-lab="employeeId" aria-label="Crew member">
        <option value="">Choose crew member…</option>
        ${l.employeeId && !emp ? `<option value="${esc(l.employeeId)}" selected>${esc(l.name || '(former employee)')}</option>` : ''}
        ${state.employees.map(e => `<option value="${esc(e.id)}" ${e.id === l.employeeId ? 'selected' : ''}>${esc(employeeLabel(e))} — ${payLabel(e)}</option>`).join('')}
      </select>
      <input type="number" min="0" step="0.25" placeholder="Hours" value="${l.hours === '' || l.hours == null || l.hours === 0 && !hourly ? '' : esc(l.hours)}" data-lab="hours" aria-label="Hours worked" ${hourly ? '' : 'disabled'}>
      <input type="number" min="0" step="0.01" placeholder="0.00" value="${l.amount === '' ? '' : esc(l.amount)}" data-lab="amount" aria-label="Pay for this job">
      <button type="button" class="btn-icon" data-action="jd-remove-labor" title="Remove crew member" aria-label="Remove crew member">✕</button>
    </div>`;
}

function jobExtraRowHtml(x) {
  x = x || { desc: '', amount: '' };
  return `
    <div class="expense-row" style="grid-template-columns: 1fr 130px 34px;">
      <input type="text" placeholder="e.g. Replace 4 sheets of sheathing" value="${esc(x.desc)}" data-jext="desc">
      <input type="number" min="0" step="0.01" placeholder="0.00" value="${x.amount === '' ? '' : esc(x.amount)}" data-jext="amount" aria-label="Charge amount">
      <button type="button" class="btn-icon" data-action="jd-remove-extra" title="Remove charge" aria-label="Remove charge">✕</button>
    </div>`;
}

function readDialogExtras() {
  return $$('#jd-extras .expense-row').map(row => ({
    id: uid(),
    desc: $('[data-jext="desc"]', row).value.trim(),
    amount: num($('[data-jext="amount"]', row).value),
  })).filter(x => x.desc !== '' || x.amount !== 0);
}

function paymentRowHtml(p) {
  p = p || { date: todayISO(), amount: '', method: 'Check', note: '' };
  return `
    <div class="expense-row payment-row">
      <input type="date" value="${esc(p.date)}" data-pay="date" aria-label="Payment date">
      <input type="number" min="0" step="0.01" placeholder="0.00" value="${p.amount === '' ? '' : esc(p.amount)}" data-pay="amount" aria-label="Payment amount">
      <select data-pay="method" aria-label="Payment method">
        ${PAYMENT_METHODS.map(m => `<option ${m === p.method ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
      <input type="text" placeholder="Note (e.g. deposit)" value="${esc(p.note)}" data-pay="note" aria-label="Payment note">
      <button type="button" class="btn-icon" data-action="jd-remove-payment" title="Remove payment" aria-label="Remove payment">✕</button>
    </div>`;
}

function openJobDialog(jobId) {
  const dlg = $('#job-dialog');
  const job = jobId ? state.jobs.find(j => j.id === jobId) : null;
  const j = job || {
    id: null, address: '', client: '', phone: '', email: '',
    serviceId: state.settings.services[0] ? state.settings.services[0].id : '',
    area: '', layers: 1, extras: [], price: '', status: 'lead',
    taxRate: num(state.settings.salesTaxRate),
    startDate: '', completedDate: '', notes: '', expenses: [],
  };
  const unitP = esc(unitPlural());

  dlg.innerHTML = `
    <div class="dialog-head">
      <h2>${job ? 'Edit Job' : 'New Job'}</h2>
      <button class="btn-icon" data-action="jd-close" aria-label="Close">✕</button>
    </div>
    <div class="dialog-body">
      <div class="form-grid">
        <div class="field span-2">
          <label for="jd-address">Property address *</label>
          <input id="jd-address" type="text" placeholder="123 Main St, City, State ZIP" value="${esc(j.address)}">
        </div>
        <div class="field">
          <label for="jd-client">Client name</label>
          <input id="jd-client" type="text" value="${esc(j.client)}" list="customer-datalist" autocomplete="off">
          <datalist id="customer-datalist">
            ${state.customers.map(c => `<option value="${esc(c.name)}"></option>`).join('')}
          </datalist>
        </div>
        <div class="field">
          <label for="jd-phone">Phone</label>
          <input id="jd-phone" type="tel" value="${esc(j.phone)}">
        </div>
        <div class="field span-2">
          <label for="jd-email">Client email</label>
          <input id="jd-email" type="email" placeholder="name@example.com" value="${esc(j.email || '')}">
        </div>
        <div class="field">
          <label for="jd-service">Service type</label>
          <select id="jd-service">${serviceOptions(j.serviceId)}</select>
        </div>
        <div class="field">
          <label for="jd-area">Roof size (${unitP})</label>
          <input id="jd-area" type="number" min="0" step="0.01" value="${esc(j.area)}">
        </div>
        <div class="field">
          <label for="jd-layers">Tear-off layers</label>
          <input id="jd-layers" type="number" min="1" step="1" value="${esc(j.layers || 1)}">
          <span class="hint">${money(num(state.settings.tearoffPerLayer), true)}/${esc(state.settings.unit)} extra for each layer beyond the first</span>
        </div>
        <div class="field">
          <label for="jd-price">Contract price (what you're charging)</label>
          <input id="jd-price" type="number" min="0" step="0.01" value="${esc(j.price)}">
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button type="button" class="btn" data-action="jd-use-suggested">Use suggested price</button>
        </div>
        <div class="field">
          <label for="jd-tax">Sales tax (%)</label>
          <input id="jd-tax" type="number" min="0" step="0.001" value="${esc(num(j.taxRate))}">
          <span class="hint">Added on the invoice. 0 = no sales tax.</span>
        </div>
        <div class="field">
          <label for="jd-status">Status</label>
          <select id="jd-status">
            ${STATUSES.map(([v, l]) => `<option value="${v}" ${v === j.status ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="jd-manager">Project manager</label>
          <select id="jd-manager">
            <option value="">— None assigned —</option>
            ${j.managerId && !getEmployee(j.managerId) ? `<option value="${esc(j.managerId)}" selected>(former employee)</option>` : ''}
            ${state.employees.map(e => `<option value="${esc(e.id)}" ${e.id === j.managerId ? 'selected' : ''}>${esc(employeeLabel(e))}</option>`).join('')}
          </select>
          ${state.employees.length === 0 ? '<span class="hint">Add your crew on the Employees page first.</span>' : ''}
        </div>
        <div class="field">
          <label for="jd-source">Lead source</label>
          <select id="jd-source">
            <option value="">— Unknown —</option>
            ${LEAD_SOURCES.map(x => `<option ${x === j.leadSource ? 'selected' : ''}>${x}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="jd-follow">Next follow-up</label>
          <input id="jd-follow" type="date" value="${esc(j.followUp || '')}">
          <span class="hint">Shows on the dashboard when due.</span>
        </div>
        <div class="field">
          <label for="jd-start">Start date</label>
          <input id="jd-start" type="date" value="${esc(j.startDate)}">
        </div>
        <div class="field">
          <label for="jd-completed">Completion date</label>
          <input id="jd-completed" type="date" value="${esc(j.completedDate)}">
        </div>
        <div class="field span-2">
          <label for="jd-notes">Notes</label>
          <textarea id="jd-notes" placeholder="Scope details, materials, crew, anything worth remembering…">${esc(j.notes)}</textarea>
        </div>
      </div>

      <h2 style="margin-top:20px">Additional charges (billed to customer)</h2>
      <p class="card-sub" style="margin-bottom:4px">Wood, sheathing, or other repairs found after tear-off — added to the invoice on top of the contract price.</p>
      <div class="expense-rows" id="jd-extras">
        ${(j.extras || []).map(jobExtraRowHtml).join('')}
      </div>
      <button type="button" class="btn small" style="margin-top:10px" data-action="jd-add-extra">+ Add charge</button>

      <h2 style="margin-top:20px">Expenses</h2>
      <p class="card-sub" style="margin-bottom:4px">Materials, labor, permits, dump fees — everything this job costs you.</p>
      <div class="expense-rows" id="jd-expenses">
        ${(j.expenses || []).map(expenseRowHtml).join('')}
      </div>
      <button type="button" class="btn small" style="margin-top:10px" data-action="jd-add-expense">+ Add expense</button>

      <h2 style="margin-top:20px">Crew labor</h2>
      <p class="card-sub" style="margin-bottom:4px">Who's working this job and what they're paid for it — hourly pay is calculated from hours × their rate, per-job pay fills in automatically. It all comes out of your profit below.</p>
      <div class="expense-rows" id="jd-labor">
        ${(j.labor || []).map(laborRowHtml).join('')}
      </div>
      ${state.employees.length === 0
        ? '<p class="hint" style="margin-top:8px">No employees yet — add your crew on the <b>Employees</b> page first.</p>'
        : '<button type="button" class="btn small" style="margin-top:10px" data-action="jd-add-labor">+ Add crew member</button>'}

      <h2 style="margin-top:20px">Payments received</h2>
      <p class="card-sub" style="margin-bottom:4px">Deposits and payments from the customer — the balance due updates below.</p>
      <div class="expense-rows" id="jd-payments">
        ${(j.payments || []).map(paymentRowHtml).join('')}
      </div>
      <button type="button" class="btn small" style="margin-top:10px" data-action="jd-add-payment">+ Add payment</button>

      <h2 style="margin-top:20px">Invoices &amp; documents</h2>
      <p class="card-sub" style="margin-bottom:4px">Supplier invoices, receipts, signed contracts, photos — kept with this job. Files save the moment you attach them.</p>
      <div class="file-rows" id="jd-files"><p class="hint" style="margin:4px 0">Loading…</p></div>
      <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
        <label class="btn small" style="cursor:pointer;">
          + Attach files
          <input type="file" id="jd-file-input" multiple hidden>
        </label>
        <label class="btn small" style="cursor:pointer;">
          📷 Take photo
          <input type="file" id="jd-photo-input" accept="image/*" capture="environment" hidden>
        </label>
      </div>

      <div class="calc-strip" id="jd-calc"></div>
    </div>
    <div class="dialog-foot">
      ${job ? '<button class="btn danger" data-action="jd-delete">Delete job</button>' : '<span></span>'}
      <button class="btn" data-action="jd-invoice" title="Saves the job and opens a printable customer invoice">🧾 Invoice</button>
      <button class="btn" data-action="jd-changeorder" title="Printable, signable change order for the additional charges">📝 Change order</button>
      <div class="grow"></div>
      <button class="btn" data-action="jd-close">Cancel</button>
      <button class="btn primary" data-action="jd-save">${job ? 'Save changes' : 'Add job'}</button>
    </div>`;

  dlgIsNew = !job;
  dlgSaved = false;
  dlgJobId = job ? job.id : uid();
  dlg.addEventListener('input', jobDialogRecalc);
  jobDialogRecalc();
  renderJobFiles();
  attachAddressAutocomplete($('#jd-address'));
  dlg.showModal();
}

function renderJobFiles() {
  if (!$('#jd-files')) return;
  getJobFiles(dlgJobId).then(files => {
    const box = $('#jd-files');
    if (!box) return;
    if (!files.length) {
      box.innerHTML = '<p class="hint" style="margin:4px 0">No files attached yet.</p>';
      return;
    }
    files.sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || '') || a.name.localeCompare(b.name));
    box.innerHTML = files.map(f => `
      <div class="file-row">
        ${f.blob && f.type && f.type.startsWith('image/') ? `<img class="file-thumb" src="${URL.createObjectURL(f.blob)}" alt="">` : '<span class="file-icon">📄</span>'}
        <div class="file-meta">
          <b title="${esc(f.name)}">${esc(f.name)}</b>
          <span class="hint">${fmtSize(f.size)} · added ${dateLabel((f.addedAt || '').slice(0, 10))}</span>
        </div>
        <div class="file-actions">
          <button type="button" class="btn small" data-action="file-open" data-id="${esc(f.id)}">View</button>
          <button type="button" class="btn small" data-action="file-download" data-id="${esc(f.id)}">Download</button>
          <button type="button" class="btn-icon" data-action="file-delete" data-id="${esc(f.id)}" title="Delete file" aria-label="Delete file">✕</button>
        </div>
      </div>`).join('');
  }).catch(() => {
    const box = $('#jd-files');
    if (box) box.innerHTML = '<p class="hint">File storage is not available in this browser.</p>';
  });
}

async function attachFiles(fileList) {
  let added = 0;
  for (const f of fileList) {
    if (f.size > 15 * 1024 * 1024) {
      toast(`"${f.name}" is over 15 MB — skipped`);
      continue;
    }
    try {
      await addJobFile(dlgJobId, f);
      added++;
    } catch (err) {
      toast('Could not save file in this browser');
      return;
    }
  }
  if (added) {
    renderJobFiles();
    toast(added === 1 ? 'File attached' : added + ' files attached');
  }
}

function readDialogExpenses() {
  return $$('#jd-expenses .expense-row').map(row => ({
    desc: $('[data-exp="desc"]', row).value.trim(),
    category: $('[data-exp="category"]', row).value,
    amount: num($('[data-exp="amount"]', row).value),
    paid: $('[data-exp="paid"]', row).checked,
  })).filter(e => e.desc !== '' || e.amount !== 0);
}

function readDialogLabor() {
  return $$('#jd-labor .labor-row').map(row => {
    const employeeId = $('[data-lab="employeeId"]', row).value;
    const emp = getEmployee(employeeId);
    const existingName = $('[data-lab="employeeId"]', row).selectedOptions[0];
    return {
      id: uid(),
      employeeId,
      name: emp ? emp.name : (existingName ? existingName.textContent.trim() : ''),
      hours: num($('[data-lab="hours"]', row).value),
      amount: num($('[data-lab="amount"]', row).value),
    };
  }).filter(l => l.employeeId !== '' || l.amount !== 0);
}

function readDialogPayments() {
  return $$('#jd-payments .payment-row').map(row => ({
    id: uid(),
    date: $('[data-pay="date"]', row).value,
    amount: num($('[data-pay="amount"]', row).value),
    method: $('[data-pay="method"]', row).value,
    note: $('[data-pay="note"]', row).value.trim(),
  })).filter(p => p.amount !== 0 || p.note !== '');
}

function jobDialogRecalc() {
  const calc = $('#jd-calc');
  if (!calc) return;
  const serviceId = $('#jd-service').value;
  const area = num($('#jd-area').value);
  const layers = num($('#jd-layers').value) || 1;
  const price = num($('#jd-price').value);
  const suggested = suggestedPrice(serviceId, area, layers);
  const extras = readDialogExtras().reduce((s, x) => s + x.amount, 0);
  const invoiceTotal = price + extras;
  const taxEl = $('#jd-tax');
  const tax = Math.round(invoiceTotal * (taxEl ? num(taxEl.value) : 0)) / 100;
  const expenseRows = readDialogExpenses();
  const expenses = expenseRows.reduce((s, e) => s + e.amount, 0);
  const unpaidExp = unpaidExpensesTotal(expenseRows);
  const labor = readDialogLabor().reduce((s, l) => s + l.amount, 0);
  const paid = readDialogPayments().reduce((s, p) => s + p.amount, 0);
  const balance = invoiceTotal + tax - paid;
  const profit = invoiceTotal - expenses - labor;
  const margin = invoiceTotal > 0 ? (profit / invoiceTotal) * 100 : null;
  const svc = getService(serviceId);
  const unit = esc(state.settings.unit);

  calc.innerHTML = `
    <div>
      <div class="calc-label">Suggested price</div>
      <div class="calc-value">${money(suggested)}</div>
      <div class="hint">${svc ? money(svc.rate, svc.rate % 1 !== 0) + '/' + unit + ' × ' + area + ' ' + esc(unitPlural()) + (layers > 1 ? ' + ' + money(tearoffCharge(area, layers), true) + ' tear-off (' + (layers - 1) + ' extra layer' + (layers > 2 ? 's' : '') + ')' : '') : '—'}</div>
    </div>
    <div>
      <div class="calc-label">Contract price</div>
      <div class="calc-value">${money(price)}</div>
    </div>
    <div>
      <div class="calc-label">Invoice total</div>
      <div class="calc-value">${money(invoiceTotal + tax, true)}</div>
      ${extras > 0 ? `<div class="hint">incl. ${money(extras, true)} additional charges</div>` : ''}
      ${tax > 0 ? `<div class="hint">incl. ${money(tax, true)} sales tax</div>` : ''}
    </div>
    <div>
      <div class="calc-label">Expenses</div>
      <div class="calc-value">${money(expenses, true)}</div>
      ${unpaidExp > 0 ? `<div class="hint">${money(unpaidExp, true)} not paid yet</div>` : ''}
    </div>
    <div>
      <div class="calc-label">Crew labor</div>
      <div class="calc-value">${money(labor, true)}</div>
    </div>
    <div>
      <div class="calc-label">Projected profit</div>
      <div class="calc-value ${profit < 0 ? 'negative' : 'positive'}">${money(profit)}</div>
      <div class="hint">${margin == null ? 'Set a contract price' : margin.toFixed(1) + '% margin'}</div>
    </div>
    <div>
      <div class="calc-label">Paid to date</div>
      <div class="calc-value">${money(paid, true)}</div>
    </div>
    <div>
      <div class="calc-label">Balance due</div>
      <div class="calc-value ${price > 0 && balance <= 0.005 ? 'positive' : ''}">${money(balance, true)}</div>
      <div class="hint">${price > 0 && balance <= 0.005 ? 'Paid in full ✓' : ''}</div>
    </div>`;
}

function saveJobFromDialog() {
  const dlg = $('#job-dialog');
  const address = $('#jd-address').value.trim();
  if (!address) {
    toast('Please enter the property address');
    $('#jd-address').focus();
    return;
  }
  if (!canWrite()) { toast('Read-only accountant access — changes are not saved'); return; }
  const existing = dlgIsNew ? null : state.jobs.find(j => j.id === dlgJobId);
  const job = existing || { id: dlgJobId, createdAt: new Date().toISOString() };
  const newDate = $('#jd-completed').value || $('#jd-start').value;
  if (existing && (isClosed(recognitionDate(existing)) || isClosed(newDate))) {
    toast('This job falls in a closed period — move the closing date in Settings to edit it');
    return;
  }

  job.address = address;
  job.client = $('#jd-client').value.trim();
  job.phone = $('#jd-phone').value.trim();
  job.email = $('#jd-email').value.trim();
  job.serviceId = $('#jd-service').value;
  job.area = num($('#jd-area').value);
  job.layers = Math.max(1, Math.round(num($('#jd-layers').value) || 1));
  job.extras = readDialogExtras();
  job.price = num($('#jd-price').value);
  job.taxRate = num($('#jd-tax').value);
  job.status = $('#jd-status').value;
  job.managerId = $('#jd-manager').value;
  job.leadSource = $('#jd-source').value;
  job.followUp = $('#jd-follow').value;
  job.startDate = $('#jd-start').value;
  job.completedDate = $('#jd-completed').value;
  job.notes = $('#jd-notes').value.trim();
  job.expenses = readDialogExpenses();
  job.labor = readDialogLabor();
  job.payments = readDialogPayments();
  linkJobCustomer(job);

  if (!existing) state.jobs.push(job);
  dlgSaved = true;
  logAudit(existing ? 'update' : 'create', 'job', job.id, `${job.address} · ${money(jobGrand(job), true)} · ${statusLabel(job.status)}`);
  saveState();
  dlg.close();
  renderView();
  toast(existing ? 'Job updated' : 'Job added');
  return job;
}

function deleteJobFromDialog() {
  const dlg = $('#job-dialog');
  const job = state.jobs.find(j => j.id === dlgJobId);
  if (!job) return;
  if (!canWrite()) { toast('Read-only accountant access — changes are not saved'); return; }
  if (isClosed(recognitionDate(job))) { toast('This job falls in a closed period and can’t be deleted'); return; }
  if (!confirm(`Delete the job at "${job.address}"? Its attached files are deleted too. This can't be undone.`)) return;
  state.jobs = state.jobs.filter(j => j.id !== dlgJobId);
  deleteJobFiles(dlgJobId).catch(() => {});
  dlgSaved = true; /* suppress the new-job cancel cleanup path */
  logAudit('delete', 'job', job.id, `${job.address} · ${money(jobGrand(job), true)}`);
  saveState();
  dlg.close();
  renderView();
  toast('Job deleted');
}

/* ---------- CSV export ---------- */

function exportCsv() {
  const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const lines = [
    ['Address', 'Client', 'Phone', 'Client email', 'Service', 'Status', 'Roof size (' + unitPlural() + ')',
     'Lead source', 'Next follow-up', 'Start date', 'Completion date', 'Project manager', 'Tear-off layers', 'Contract price', 'Additional charges', 'Invoice total', 'Expenses', 'Labor cost', 'Profit', 'Margin %',
     'Paid to date', 'Balance due', 'Invoice #', 'Notes'].map(q).join(','),
  ];
  for (const j of state.jobs) {
    lines.push([
      j.address, j.client, j.phone, j.email || '', serviceName(j.serviceId), statusLabel(j.status), j.area,
      j.leadSource || '', j.followUp || '', j.startDate, j.completedDate, managerName(j), j.layers || 1, num(j.price).toFixed(2),
      extrasTotal(j).toFixed(2), jobTotal(j).toFixed(2), expensesTotal(j).toFixed(2),
      laborTotal(j).toFixed(2), jobProfit(j).toFixed(2), num(j.price) > 0 ? jobMargin(j).toFixed(1) : '',
      paymentsTotal(j).toFixed(2), balanceDue(j).toFixed(2), j.invoiceNumber || '', j.notes,
    ].map(q).join(','));
  }
  downloadFile('jobs.csv', lines.join('\r\n'), 'text/csv');
  toast('CSV exported');
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- Customers ---------- */

function renderCustomers() {
  const q = ui.customerSearch.trim().toLowerCase();
  const rows = state.customers
    .filter(c => !q ||
      c.name.toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q))
    .map(c => {
      const jobs = state.jobs.filter(j => j.customerId === c.id);
      const revenue = jobs.filter(j => REVENUE_STATUSES.includes(j.status)).reduce((s, j) => s + jobTotal(j), 0);
      const owed = jobs.filter(j => REVENUE_STATUSES.includes(j.status)).reduce((s, j) => s + Math.max(0, balanceDue(j)), 0);
      return { c, jobs, revenue, owed };
    })
    .sort((a, b) => a.c.name.localeCompare(b.c.name));

  $('#view-customers').innerHTML = `
    <div class="page-head">
      <div>
        <h1>Customers</h1>
        <p>Everyone you've worked for, with their full job history. Customers are added automatically when you name a client on a job.</p>
      </div>
      <button class="btn primary" data-action="new-customer">+ Add Customer</button>
    </div>

    <div class="card">
      <div class="toolbar">
        <input type="search" placeholder="Search name, phone, or email…" value="${esc(ui.customerSearch)}" data-field="customer-search" aria-label="Search customers">
      </div>
      ${rows.length === 0 ? `
        <div class="empty">
          <h3>${state.customers.length === 0 ? 'No customers yet' : 'No customers match your search'}</h3>
          <p>${state.customers.length === 0 ? 'Add one here, or just put a client name on a job — they’ll show up automatically.' : 'Try a different search.'}</p>
        </div>` : `
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th class="num">Jobs</th><th class="num">Revenue</th><th class="num">Owes you</th></tr></thead>
            <tbody>
              ${rows.map(({ c, jobs, revenue, owed }) => `
                <tr class="rowlink" data-action="open-customer" data-id="${esc(c.id)}">
                  <td><b>${esc(c.name)}</b></td>
                  <td>${esc(c.phone || '—')}</td>
                  <td>${esc(c.email || '—')}</td>
                  <td class="num">${jobs.length}</td>
                  <td class="num">${money(revenue)}</td>
                  <td class="num">${owed > 0.005 ? '<b>' + money(owed) + '</b>' : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
    </div>`;
}

function openCustomerDialog(customerId) {
  const dlg = $('#customer-dialog');
  const c = customerId ? getCustomer(customerId) : null;
  const jobs = c
    ? state.jobs.filter(j => j.customerId === c.id).sort((a, b) => jobDate(b).localeCompare(jobDate(a)))
    : [];

  dlg.dataset.customerId = c ? c.id : '';
  dlg.innerHTML = `
    <div class="dialog-head">
      <h2>${c ? 'Customer' : 'New Customer'}</h2>
      <button class="btn-icon" data-action="cust-close" aria-label="Close">✕</button>
    </div>
    <div class="dialog-body">
      <div class="form-grid">
        <div class="field">
          <label for="cd-name">Name *</label>
          <input id="cd-name" type="text" value="${esc(c ? c.name : '')}">
        </div>
        <div class="field">
          <label for="cd-phone">Phone</label>
          <input id="cd-phone" type="tel" value="${esc(c ? c.phone : '')}">
        </div>
        <div class="field span-2">
          <label for="cd-email">Email</label>
          <input id="cd-email" type="email" value="${esc(c ? c.email : '')}">
        </div>
        <div class="field span-2">
          <label for="cd-notes">Notes</label>
          <textarea id="cd-notes" placeholder="Gate codes, preferences, referral source…">${esc(c ? c.notes : '')}</textarea>
        </div>
      </div>
      ${c ? `
        <h2 style="margin-top:20px">Job history</h2>
        ${jobs.length === 0 ? '<p class="hint">No jobs linked yet — put this name in a job’s Client field.</p>' : `
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Address</th><th>Service</th><th>Status</th><th class="num">Contract</th><th class="num">Balance</th></tr></thead>
            <tbody>
              ${jobs.map(j => `
                <tr class="rowlink" data-action="open-job" data-id="${esc(j.id)}">
                  <td><b>${esc(j.address)}</b></td>
                  <td>${esc(serviceName(j.serviceId))}</td>
                  <td>${statusBadge(j.status)}</td>
                  <td class="num">${money(jobTotal(j))}</td>
                  <td class="num">${jobTotal(j) > 0 && balanceDue(j) <= 0.005 ? '<span class="paid-tag">Paid ✓</span>' : money(balanceDue(j))}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}` : ''}
    </div>
    <div class="dialog-foot">
      ${c ? '<button class="btn danger" data-action="cust-delete">Delete customer</button>' : '<span></span>'}
      <div class="grow"></div>
      <button class="btn" data-action="cust-close">Cancel</button>
      <button class="btn primary" data-action="cust-save">${c ? 'Save changes' : 'Add customer'}</button>
    </div>`;
  dlg.showModal();
}

function saveCustomerFromDialog() {
  const dlg = $('#customer-dialog');
  const name = $('#cd-name').value.trim();
  if (!name) {
    toast('Please enter the customer’s name');
    $('#cd-name').focus();
    return;
  }
  const id = dlg.dataset.customerId;
  const existing = id ? getCustomer(id) : null;
  const c = existing || { id: uid(), createdAt: new Date().toISOString() };
  const oldName = existing ? existing.name : null;
  c.name = name;
  c.phone = $('#cd-phone').value.trim();
  c.email = $('#cd-email').value.trim();
  c.notes = $('#cd-notes').value.trim();
  if (!existing) state.customers.push(c);
  /* Renaming a customer updates the client name on their jobs. */
  if (oldName && oldName !== name) {
    state.jobs.forEach(j => { if (j.customerId === c.id) j.client = name; });
  }
  logAudit(existing ? 'update' : 'create', 'customer', c.id, name);
  saveState();
  dlg.close();
  renderView();
  toast(existing ? 'Customer updated' : 'Customer added');
}

/* ---------- Employees ---------- */

function renderEmployees() {
  const from = ui.payFrom || '';
  const to = ui.payTo || '';
  const inRange = j => {
    const d = jobDate(j);
    return (!from || d >= from) && (!to || d <= to);
  };
  const rows = state.employees.map(e => {
    let jobsWorked = 0, earned = 0, rangePay = 0;
    for (const j of state.jobs) {
      const mine = (j.labor || []).filter(l => l.employeeId === e.id);
      if (mine.length) {
        jobsWorked++;
        const sum = mine.reduce((s, l) => s + num(l.amount), 0);
        earned += sum;
        if ((from || to) && inRange(j)) rangePay += sum;
      }
    }
    return { e, jobsWorked, earned, rangePay };
  }).sort((a, b) => a.e.name.localeCompare(b.e.name));

  $('#view-employees').innerHTML = `
    <div class="page-head">
      <div>
        <h1>Employees</h1>
        <p>Your crew and their pay. Add them to a job's Crew labor section and their pay is deducted from that job's profit.</p>
      </div>
      <button class="btn primary" data-action="new-employee">+ Add Employee</button>
    </div>

    <div class="card">
      <div class="toolbar">
        <span class="hint" style="font-weight:600">Pay report range:</span>
        <input type="date" data-field="pay-from" value="${esc(from)}" aria-label="Pay report from">
        <input type="date" data-field="pay-to" value="${esc(to)}" aria-label="Pay report to">
        <span class="hint">${(from || to) ? 'Pay in range uses each job\'s date.' : 'Pick dates to run payroll for a period.'}</span>
      </div>
      ${rows.length === 0 ? `
        <div class="empty">
          <h3>No employees yet</h3>
          <p>Add your crew with hourly pay or a flat rate per job.</p>
          <button class="btn primary" data-action="new-employee">+ Add Employee</button>
        </div>` : `
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Name</th><th>Position</th><th>Phone</th><th>Pay</th><th class="num">Jobs worked</th><th class="num">Total pay (all jobs)</th>${(from || to) ? '<th class="num">Pay in range</th>' : ''}</tr></thead>
            <tbody>
              ${rows.map(({ e, jobsWorked, earned, rangePay }) => `
                <tr class="rowlink" data-action="open-employee" data-id="${esc(e.id)}">
                  <td><b>${esc(e.name)}</b></td>
                  <td>${esc(e.position || '—')}</td>
                  <td>${esc(e.phone || '—')}</td>
                  <td>${payLabel(e)} <span class="hint">(${e.payType === 'hourly' ? 'hourly' : 'per job'})</span></td>
                  <td class="num">${jobsWorked}</td>
                  <td class="num">${money(earned, true)}</td>
                  ${(from || to) ? `<td class="num"><b>${money(rangePay, true)}</b></td>` : ''}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
    </div>`;
}

function openEmployeeDialog(employeeId) {
  const dlg = $('#employee-dialog');
  const e = employeeId ? getEmployee(employeeId) : null;
  dlg.dataset.employeeId = e ? e.id : '';
  dlg.innerHTML = `
    <div class="dialog-head">
      <h2>${e ? 'Employee' : 'New Employee'}</h2>
      <button class="btn-icon" data-action="emp-close" aria-label="Close">✕</button>
    </div>
    <div class="dialog-body">
      <div class="form-grid">
        <div class="field">
          <label for="ed-name">Name *</label>
          <input id="ed-name" type="text" value="${esc(e ? e.name : '')}">
        </div>
        <div class="field">
          <label for="ed-phone">Phone</label>
          <input id="ed-phone" type="tel" value="${esc(e ? e.phone : '')}">
        </div>
        <div class="field span-2">
          <label for="ed-position">Position</label>
          <input id="ed-position" type="text" value="${esc(e ? e.position || '' : '')}" list="position-datalist" placeholder="e.g. Roofer, Project Manager, Painter…" autocomplete="off">
          <datalist id="position-datalist">
            ${POSITIONS.map(p => `<option value="${p}"></option>`).join('')}
          </datalist>
        </div>
        <div class="field">
          <label for="ed-paytype">Pay type</label>
          <select id="ed-paytype">
            <option value="hourly" ${e && e.payType === 'hourly' ? 'selected' : ''}>Hourly</option>
            <option value="per-job" ${!e || e.payType === 'per-job' ? 'selected' : ''}>Per job (flat rate)</option>
          </select>
        </div>
        <div class="field">
          <label for="ed-rate">Pay rate ($)</label>
          <input id="ed-rate" type="number" min="0" step="0.01" value="${e ? esc(e.rate) : ''}">
          <span class="hint">Hourly: dollars per hour. Per job: the usual pay per job — you can adjust it on any individual job.</span>
        </div>
        <div class="field span-2">
          <label for="ed-notes">Notes</label>
          <textarea id="ed-notes" placeholder="Skills, certifications, availability…">${esc(e ? e.notes : '')}</textarea>
        </div>
      </div>
    </div>
    <div class="dialog-foot">
      ${e ? '<button class="btn danger" data-action="emp-delete">Delete employee</button>' : '<span></span>'}
      <div class="grow"></div>
      <button class="btn" data-action="emp-close">Cancel</button>
      <button class="btn primary" data-action="emp-save">${e ? 'Save changes' : 'Add employee'}</button>
    </div>`;
  dlg.showModal();
}

function saveEmployeeFromDialog() {
  const dlg = $('#employee-dialog');
  const name = $('#ed-name').value.trim();
  if (!name) {
    toast('Please enter the employee’s name');
    $('#ed-name').focus();
    return;
  }
  const id = dlg.dataset.employeeId;
  const existing = id ? getEmployee(id) : null;
  const e = existing || { id: uid(), createdAt: new Date().toISOString() };
  e.name = name;
  e.phone = $('#ed-phone').value.trim();
  e.position = $('#ed-position').value.trim();
  e.payType = $('#ed-paytype').value;
  e.rate = num($('#ed-rate').value);
  e.notes = $('#ed-notes').value.trim();
  if (!existing) state.employees.push(e);
  logAudit(existing ? 'update' : 'create', 'employee', e.id, `${name} · ${e.payType} ${money(e.rate, true)}`);
  saveState();
  dlg.close();
  renderView();
  toast(existing ? 'Employee updated' : 'Employee added');
}

/* ---------- Schedule ---------- */

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function renderSchedule() {
  const y = ui.schedYear, m = ui.schedMonth;
  const today = new Date();
  const startDow = new Date(y, m, 1).getDay();
  const daysIn = new Date(y, m + 1, 0).getDate();

  const byDay = {};
  for (const j of state.jobs) {
    if (!j.startDate) continue;
    /* Jobs span from start date through completion date (capped at 60 days). */
    const endIso = (j.completedDate && j.completedDate >= j.startDate) ? j.completedDate : j.startDate;
    const d = new Date(j.startDate + 'T12:00:00');
    const stop = new Date(endIso + 'T12:00:00');
    let guard = 0;
    while (d <= stop && guard++ <= 60) {
      if (d.getFullYear() === y && d.getMonth() === m) {
        (byDay[d.getDate()] = byDay[d.getDate()] || []).push(j);
      }
      d.setDate(d.getDate() + 1);
    }
  }

  const unscheduled = state.jobs
    .filter(j => !j.startDate && ['lead', 'quoted', 'scheduled', 'in-progress'].includes(j.status))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const crewOf = j => (j.labor || []).map(l => { const e = getEmployee(l.employeeId); return e ? e.name : l.name; }).filter(Boolean).join(', ');
  const chip = j => `
    <button class="cal-chip ${esc(j.status)}" data-action="open-job" data-id="${esc(j.id)}" title="${esc(j.address)} — ${esc(statusLabel(j.status))}${crewOf(j) ? esc(' · Crew: ' + crewOf(j)) : ''}${managerName(j) ? esc(' · PM: ' + managerName(j)) : ''}">
      <span class="dot"></span><span class="addr">${esc(j.address)}</span>
    </button>`;

  $('#view-schedule').innerHTML = `
    <div class="page-head">
      <div>
        <h1>Schedule</h1>
        <p>Jobs shown on their start date. Click a job to open it, and set start dates to plan your crew.</p>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="btn small" data-action="sched-prev" aria-label="Previous month">‹</button>
        <button class="btn small" data-action="sched-today">Today</button>
        <button class="btn small" data-action="sched-next" aria-label="Next month">›</button>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-bottom:12px">${MONTHS_FULL[m]} ${y}</h2>
      <div class="table-wrap">
        <div class="cal-grid">
          ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
          ${cells.map(d => {
            if (d === null) return '<div class="cal-cell cal-empty"></div>';
            const isToday = y === today.getFullYear() && m === today.getMonth() && d === today.getDate();
            return `
              <div class="cal-cell${isToday ? ' today' : ''}">
                <span class="cal-day">${d}</span>
                ${(byDay[d] || []).map(chip).join('')}
              </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Not scheduled yet</h2>
      <p class="card-sub">Active jobs with no start date. Open one and give it a date to put it on the calendar.</p>
      ${unscheduled.length === 0 ? '<p class="hint">Every active job has a start date. 👍</p>' : `
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Address</th><th>Service</th><th>Status</th><th class="num">Contract</th></tr></thead>
            <tbody>
              ${unscheduled.map(j => `
                <tr class="rowlink" data-action="open-job" data-id="${esc(j.id)}">
                  <td><b>${esc(j.address)}</b>${j.client ? `<br><span class="hint">${esc(j.client)}</span>` : ''}</td>
                  <td>${esc(serviceName(j.serviceId))}</td>
                  <td>${statusBadge(j.status)}</td>
                  <td class="num">${money(jobTotal(j))}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
    </div>`;
}

/* ---------- Scope of Work forms (salesman worksheet) ---------- */

const LEAD_SOURCES = ['Referral', 'Door knock', 'Google / web', 'Social media', 'Insurance', 'Repeat customer', 'Yard sign', 'Other'];

const PROJECT_TYPES = ['Re-Roof', 'Roof Repair', 'Insurance Restoration', 'Roof Replacement', 'New Construction', 'Solar Roof Preparation'];

const SCOPE_GROUPS = [
  { key: 'removal', title: '3. Existing Roof Removal', items: ['Remove existing roofing materials as specified', 'Remove existing underlayment where applicable', 'Remove existing flashing where replacement is required', 'Remove existing vents and roofing accessories as specified', 'Inspect the roof deck after removal of existing materials', 'Properly dispose of roofing debris and construction waste'], notes: ['tearoffScope', 'Tear-off scope'] },
  { key: 'underlayment', title: '5. Underlayment & Waterproofing', items: ['Synthetic underlayment', 'Self-adhered underlayment', 'Ice & water protection where applicable', 'Eave protection where required', 'Valley protection'], fields: [['underBrand', 'Product / brand'], ['underSpec', 'Product specification']] },
  { key: 'covering', title: '6. Roof Covering Installation', items: ['Asphalt shingles', 'Concrete tile', 'Clay tile', 'Flat roofing system', 'Modified bitumen', 'TPO'], fields: [['mfr', 'Manufacturer'], ['model', 'Product / model'], ['color', 'Color'], ['squares', 'Number of squares']] },
  { key: 'flashing', title: '7. Flashing & Roof Penetrations', items: ['Step flashing', 'Wall flashing', 'Headwall flashing', 'Valley flashing', 'Pipe flashings', 'Skylight flashing', 'Chimney flashing', 'Drip edge', 'Counterflashing'] },
  { key: 'vents', title: '8. Roof Ventilation', items: ['Ridge vent', 'Static roof vents', 'O’Hagin vents', 'Box vents', 'Intake ventilation', 'Soffit ventilation'], notes: ['ventNotes', 'Ventilation notes'] },
  { key: 'solar', title: '9. Solar-Related Roofing Work', items: ['Solar panel removal', 'Solar panel reinstallation', 'Solar comp-out', 'Roof preparation for solar installation', 'Coordination with solar contractor', 'Roof penetrations associated with solar equipment'], notes: ['solarScope', 'Solar scope'] },
  { key: 'gutters', title: '10. Gutters & Drainage', items: ['Existing gutters to remain', 'Gutters to be removed', 'Gutters to be reinstalled', 'New gutters', 'Downspouts', 'Roof drainage modifications'], notes: ['gutterNotes', 'Additional details'] },
];

const SCOPE_STATIC = [
  ['General Scope of Work', 'Next Gen Premier Roofing Contractor Inc. will provide labor, materials, equipment, and services necessary to complete the roofing work described in this Scope of Work, subject to the approved contract, project specifications, manufacturer requirements, applicable permits, and applicable California building codes. The work will be performed in a professional manner using industry-standard practices and appropriate roofing materials for the approved project.'],
  ['Cleanup & Property Protection', 'The contractor will make reasonable efforts to protect the customer’s property during construction. Upon completion: roofing debris will be removed, work areas will be cleaned, driveways and accessible areas will be inspected, a magnetic sweep will be performed where reasonably accessible, and construction materials will be removed or properly stored.'],
  ['Change Orders & Additional Work', 'Any work outside the original Scope of Work may require a written change order. Additional work may include rotten or damaged decking, structural repairs, additional flashing, hidden water damage, unexpected substrate conditions, additional layers of roofing materials, code-required upgrades, or customer-requested changes. Additional work will be performed only after authorization, when required by the contract and applicable project circumstances.'],
  ['Exclusions', 'Unless specifically listed in the contract or approved in writing, the following items are excluded: structural framing repairs, major structural modifications, interior drywall repairs, interior painting, electrical work, solar system installation, HVAC work, mold remediation, asbestos or hazardous-material abatement, plumbing work, landscaping repairs, and repairs to concealed conditions not visible before construction.'],
];

const COVERING_SERVICE_MAP = {
  'Asphalt shingles': 'shingling', 'Concrete tile': 'new-tile-concrete', 'Clay tile': 'new-tile-clay',
  'Flat roofing system': 'flat-roofing', 'Modified bitumen': 'flat-roofing', 'TPO': 'flat-roofing',
};

function renderScopes() {
  if (ui.scopeJobId) { renderScopeForm(ui.scopeJobId); return; }
  const jobs = state.jobs.filter(j => j.scope)
    .sort((a, b) => (b.scope.updatedAt || '').localeCompare(a.scope.updatedAt || ''));
  $('#view-scopes').innerHTML = `
    <div class="page-head">
      <div>
        <h1>Scope of Work</h1>
        <p>Your salesmen fill this out on-site — every saved form creates a job you can quote, edit, and invoice.</p>
      </div>
      <button class="btn primary" data-action="scope-new">+ New Scope Form</button>
    </div>
    <div class="card">
      ${jobs.length === 0 ? `
        <div class="empty"><h3>No scope forms yet</h3><p>Fill one out during the sales visit — the job is created automatically.</p>
        <button class="btn primary" data-action="scope-new">+ New Scope Form</button></div>` : `
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Address</th><th>Customer</th><th>Salesman</th><th>Project type</th><th>Status</th><th></th></tr></thead>
        <tbody>${jobs.map(j => `
          <tr>
            <td><b>${esc(j.address)}</b></td>
            <td>${esc(j.client || '—')}</td>
            <td>${esc(j.scope.salesman || '—')}</td>
            <td>${esc((j.scope.projectTypes || []).join(', ') || '—')}</td>
            <td>${statusBadge(j.status)}</td>
            <td class="num" style="white-space:nowrap">
              <button class="btn small" data-action="scope-edit" data-id="${esc(j.id)}">Open form</button>
              <button class="btn small" data-action="open-job" data-id="${esc(j.id)}">Open job</button>
            </td>
          </tr>`).join('')}</tbody>
      </table></div>`}
    </div>`;
}

function scopeGroupHtml(g, sc) {
  const sel = sc[g.key] || [];
  return `
    <div class="card">
      <h2>${esc(g.title)}</h2>
      <div class="check-grid">
        ${g.items.map(it => `<label class="check-item"><input type="checkbox" data-scope-check="${esc(g.key)}" value="${esc(it)}" ${sel.includes(it) ? 'checked' : ''}>${esc(it)}</label>`).join('')}
      </div>
      ${(g.fields || []).length ? `<div class="form-grid" style="margin-top:12px">${g.fields.map(([k, l]) => `
        <div class="field"><label>${esc(l)}</label><input type="text" data-scope-field="${esc(k)}" value="${esc(sc[k] || '')}"></div>`).join('')}</div>` : ''}
      ${g.notes ? `<div class="field" style="margin-top:12px"><label>${esc(g.notes[1])}</label><textarea data-scope-field="${esc(g.notes[0])}">${esc(sc[g.notes[0]] || '')}</textarea></div>` : ''}
    </div>`;
}

function renderScopeForm(jobId) {
  const job = jobId === 'new' ? null : state.jobs.find(j => j.id === jobId);
  const sc = (job && job.scope) || {};
  $('#view-scopes').innerHTML = `
    <div class="page-head">
      <div>
        <h1>${job ? 'Scope of Work — ' + esc(job.address) : 'New Scope of Work'}</h1>
        <p>License #${esc(state.settings.licenseNumber)} · Bonded &amp; Insured. Check everything that applies to this project.</p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${job ? '<button class="btn" data-action="scope-print">Print / sign</button>' : ''}
        <button class="btn" data-action="scope-cancel">Back</button>
        <button class="btn primary" data-action="scope-save">Save scope form</button>
      </div>
    </div>

    <div class="card">
      <h2>1. Project Information</h2>
      <div class="form-grid">
        <div class="field span-2"><label>Project address *</label><input type="text" id="sc-address" value="${esc(job ? job.address : '')}" ${job ? 'disabled' : ''}></div>
        <div class="field"><label>Customer name</label><input type="text" data-scope-field="custName" value="${esc(job ? job.client : (sc.custName || ''))}"></div>
        <div class="field"><label>Salesman</label><input type="text" data-scope-field="salesman" value="${esc(sc.salesman || '')}" list="salesman-list">
          <datalist id="salesman-list">${state.employees.map(e => `<option value="${esc(e.name)}"></option>`).join('')}</datalist></div>
        <div class="field"><label>Phone</label><input type="tel" data-scope-field="custPhone" value="${esc(job ? job.phone : (sc.custPhone || ''))}"></div>
        <div class="field"><label>Email</label><input type="email" data-scope-field="custEmail" value="${esc(job ? (job.email || '') : (sc.custEmail || ''))}"></div>
        <div class="field"><label>Estimated start date</label><input type="date" data-scope-field="estStart" value="${esc(sc.estStart || '')}"></div>
        <div class="field"><label>Estimated completion date</label><input type="date" data-scope-field="estComplete" value="${esc(sc.estComplete || '')}"></div>
      </div>
      <div style="margin-top:12px"><label class="calc-label">Project type</label>
        <div class="check-grid" style="margin-top:6px">
          ${PROJECT_TYPES.map(t => `<label class="check-item"><input type="checkbox" data-scope-check="projectTypes" value="${esc(t)}" ${(sc.projectTypes || []).includes(t) ? 'checked' : ''}>${esc(t)}</label>`).join('')}
        </div>
      </div>
    </div>

    ${scopeGroupHtml(SCOPE_GROUPS[0], sc)}

    <div class="card">
      <h2>4. Roof Decking / Sheathing</h2>
      <p class="card-sub">Rotten or damaged decking found during the project will be documented and brought to the customer's attention. Additional decking or structural repairs not visible before tear-off may require a written change order.</p>
      <div class="form-grid">
        <div class="field"><label>Material</label><input type="text" data-scope-field="deckMaterial" value="${esc(sc.deckMaterial || '')}"></div>
        <div class="field"><label>Thickness</label><input type="text" data-scope-field="deckThickness" value="${esc(sc.deckThickness || '')}"></div>
        <div class="field"><label>Estimated quantity</label><input type="text" data-scope-field="deckQty" value="${esc(sc.deckQty || '')}"></div>
        <div class="field"><label>Price / change order</label><input type="text" data-scope-field="deckPrice" value="${esc(sc.deckPrice || '')}"></div>
        <div class="field"><label>Decking replacement is</label>
          <select data-scope-field="deckMode">
            <option value="included" ${sc.deckMode !== 'additional' ? 'selected' : ''}>Included in original scope</option>
            <option value="additional" ${sc.deckMode === 'additional' ? 'selected' : ''}>Additional work requiring approval</option>
          </select></div>
      </div>
    </div>

    ${SCOPE_GROUPS.slice(1).map(g => scopeGroupHtml(g, sc)).join('')}

    <div class="card">
      <h2>14. Project Completion</h2>
      <p class="card-sub">The project is considered substantially complete when the contracted roofing work has been completed, subject to final cleanup, final inspection, completion of approved punch-list items, customer walkthrough, and final documentation.</p>
      <div class="field"><label>Punch list / final notes</label><textarea data-scope-field="punchNotes">${esc(sc.punchNotes || '')}</textarea></div>
      <div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap;">
        <button class="btn primary" data-action="scope-save">Save scope form</button>
        <button class="btn" data-action="scope-cancel">Back</button>
      </div>
    </div>`;
  window.scrollTo(0, 0);
}

function readScopeForm() {
  const sc = { updatedAt: new Date().toISOString() };
  $$('#view-scopes [data-scope-field]').forEach(el => { sc[el.dataset.scopeField] = el.value.trim(); });
  const groups = {};
  $$('#view-scopes [data-scope-check]').forEach(el => {
    const k = el.dataset.scopeCheck;
    if (!groups[k]) groups[k] = [];
    if (el.checked) groups[k].push(el.value);
  });
  Object.assign(sc, groups);
  return sc;
}

function saveScopeForm() {
  const sc = readScopeForm();
  let job = ui.scopeJobId === 'new' ? null : state.jobs.find(j => j.id === ui.scopeJobId);
  if (!job) {
    const address = $('#sc-address').value.trim();
    if (!address) { toast('Please enter the project address'); $('#sc-address').focus(); return; }
    const svcGuess = (sc.covering || []).map(c => COVERING_SERVICE_MAP[c]).find(Boolean);
    job = {
      id: uid(), createdAt: new Date().toISOString(), address,
      client: sc.custName || '', phone: sc.custPhone || '', email: sc.custEmail || '',
      serviceId: svcGuess || (state.settings.services[0] ? state.settings.services[0].id : ''),
      area: num(sc.squares) || 0, layers: 1, extras: [], price: 0,
      status: 'lead', startDate: sc.estStart || '', completedDate: '',
      managerId: '', notes: '', expenses: [], payments: [], labor: [],
    };
    state.jobs.push(job);
  } else {
    if (sc.custName && !job.client) job.client = sc.custName;
    if (sc.custPhone && !job.phone) job.phone = sc.custPhone;
    if (sc.custEmail && !job.email) job.email = sc.custEmail;
    if (num(sc.squares) > 0 && !num(job.area)) job.area = num(sc.squares);
  }
  job.scope = sc;
  linkJobCustomer(job);
  logAudit('update', 'scope', job.id, job.address);
  saveState();
  ui.scopeJobId = job.id;
  renderScopes();
  toast('Scope form saved — job is on the Jobs list');
}

function openScopeDoc(jobId) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job || !job.scope) return;
  const sc = job.scope;
  const s = state.settings;
  const groupDoc = g => {
    const sel = sc[g.key] || [];
    const notes = g.notes ? sc[g.notes[0]] : '';
    const fields = (g.fields || []).map(([k, l]) => sc[k] ? `<div><b>${esc(l)}:</b> ${esc(sc[k])}</div>` : '').join('');
    if (!sel.length && !notes && !fields) return '';
    return `<h3 class="inv-section">${esc(g.title)}</h3>
      ${sel.length ? `<ul class="scope-list">${sel.map(i => `<li>☑ ${esc(i)}</li>`).join('')}</ul>` : ''}
      ${fields}${notes ? `<div><b>${esc(g.notes[1])}:</b> ${esc(notes)}</div>` : ''}`;
  };
  const overlay = $('#invoice-overlay');
  overlay.innerHTML = `
    <div class="invoice-toolbar">
      <button class="btn" data-action="invoice-close">← Back to app</button>
      <button class="btn primary" data-action="invoice-print">Print / Save as PDF</button>
    </div>
    <div class="invoice-sheet">
      <header class="inv-head">
        <div class="inv-brand">
          <img src="${s.logoDataUrl ? esc(s.logoDataUrl) : 'assets/logo.png'}" alt="">
          <div>
            <div class="inv-company">${esc(s.companyName)} ${esc(s.tagline)}</div>
            <div>License #${esc(s.licenseNumber)} · Bonded · Insured</div>
            ${(s.companyPhone || s.companyEmail) ? `<div>${[s.companyPhone, s.companyEmail].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
          </div>
        </div>
        <div class="inv-meta"><div class="inv-title">ROOFING<br>SCOPE OF WORK</div></div>
      </header>
      <h3 class="inv-section">1. Project Information</h3>
      <div class="inv-parties">
        <div><div><b>${esc(job.client || 'Customer')}</b></div>${job.phone ? `<div>${esc(job.phone)}</div>` : ''}${job.email ? `<div>${esc(job.email)}</div>` : ''}</div>
        <div><div>${esc(job.address)}</div>
          ${(sc.projectTypes || []).length ? `<div><b>Project type:</b> ${esc(sc.projectTypes.join(', '))}</div>` : ''}
          ${sc.salesman ? `<div><b>Salesman:</b> ${esc(sc.salesman)}</div>` : ''}
          ${sc.estStart ? `<div><b>Est. start:</b> ${dateLabel(sc.estStart)}</div>` : ''}
          ${sc.estComplete ? `<div><b>Est. completion:</b> ${dateLabel(sc.estComplete)}</div>` : ''}</div>
      </div>
      <h3 class="inv-section">2. ${esc(SCOPE_STATIC[0][0])}</h3><div class="inv-disclosures"><p>${esc(SCOPE_STATIC[0][1])}</p></div>
      ${groupDoc(SCOPE_GROUPS[0])}
      ${(sc.deckMaterial || sc.deckThickness || sc.deckQty || sc.deckPrice) ? `
        <h3 class="inv-section">4. Roof Decking / Sheathing</h3>
        <div>${sc.deckMaterial ? `<b>Material:</b> ${esc(sc.deckMaterial)} · ` : ''}${sc.deckThickness ? `<b>Thickness:</b> ${esc(sc.deckThickness)} · ` : ''}${sc.deckQty ? `<b>Est. quantity:</b> ${esc(sc.deckQty)} · ` : ''}${sc.deckPrice ? `<b>Price / change order:</b> ${esc(sc.deckPrice)} · ` : ''}<b>${sc.deckMode === 'additional' ? 'Additional work requiring approval' : 'Included in original scope'}</b></div>
        <div class="inv-disclosures" style="margin-top:6px"><p>Additional decking or structural repairs not visible before tear-off may require a written change order.</p></div>` : ''}
      ${SCOPE_GROUPS.slice(1).map(groupDoc).join('')}
      ${SCOPE_STATIC.slice(1).map(([t, p], i) => `<h3 class="inv-section">${esc(t)}</h3><div class="inv-disclosures"><p>${esc(p)}</p></div>`).join('')}
      ${sc.punchNotes ? `<h3 class="inv-section">Project Completion — punch list / final notes</h3><div>${esc(sc.punchNotes)}</div>` : ''}
      <h3 class="inv-section">Customer Approval</h3>
      <div class="inv-disclosures"><p>By signing below, the customer acknowledges that they have reviewed and understand the Scope of Work described above.</p></div>
      <div class="inv-parties" style="margin-top:8px">
        <div><div>Customer name: ____________________________</div><div style="margin-top:14px">Signature: ____________________________</div><div style="margin-top:14px">Date: ____________________________</div></div>
        <div><div><b>${esc(s.companyName)} ${esc(s.tagline)}</b> · License #${esc(s.licenseNumber)}</div><div style="margin-top:14px">Authorized representative: ____________________________</div><div style="margin-top:14px">Signature / Date: ____________________________</div></div>
      </div>
    </div>`;
  overlay.hidden = false;
  document.body.classList.add('invoice-open');
  overlay.scrollTop = 0;
}

/* ---------- Invoice generation ---------- */

function openInvoice(jobId) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  if (!job.invoiceNumber) {
    job.invoiceNumber = state.settings.nextInvoiceNumber || 1001;
    state.settings.nextInvoiceNumber = job.invoiceNumber + 1;
    job.invoiceDate = todayISO();
    saveState();
  }
  const s = state.settings;
  const svc = getService(job.serviceId);
  const paid = paymentsTotal(job);
  const balance = balanceDue(job);
  const area = num(job.area);
  const subtotal = jobTotal(job);
  const tax = jobTax(job);
  const total = jobGrand(job);
  const layers = Math.max(1, num(job.layers) || 1);
  const tear = tearoffCharge(area, layers);
  /* Split the contract price into base service + tear-off lines when possible. */
  const splitTear = tear > 0 && tear < num(job.price);
  const baseAmount = splitTear ? num(job.price) - tear : num(job.price);
  const effRate = area > 0 ? baseAmount / area : null;
  const schedule = paymentScheduleRows(total);
  const disclosures = String(s.invoiceDisclosures || '').split(/\n\s*\n/).filter(p => p.trim());

  const overlay = $('#invoice-overlay');
  overlay.innerHTML = `
    <div class="invoice-toolbar">
      <button class="btn" data-action="invoice-close">← Back to app</button>
      <button class="btn primary" data-action="invoice-print">Print / Save as PDF</button>
    </div>
    <div class="invoice-sheet">
      <header class="inv-head">
        <div class="inv-brand">
          <img src="${s.logoDataUrl ? esc(s.logoDataUrl) : 'assets/logo.png'}" alt="">
          <div>
            <div class="inv-company">${esc(s.companyName)} ${esc(s.tagline)}</div>
            ${s.companyAddress ? `<div>${esc(s.companyAddress)}</div>` : ''}
            ${(s.companyPhone || s.companyEmail) ? `<div>${[s.companyPhone, s.companyEmail].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
            ${s.licenseNumber ? `<div>License #${esc(s.licenseNumber)} · Bonded · Insured</div>` : ''}
          </div>
        </div>
        <div class="inv-meta">
          <div class="inv-title">INVOICE</div>
          <div><b>No.</b> ${esc(String(job.invoiceNumber))}</div>
          <div><b>Date</b> ${dateLabel(job.invoiceDate)}</div>
          ${job.completedDate ? `<div><b>Job completed</b> ${dateLabel(job.completedDate)}</div>` : ''}
        </div>
      </header>

      <div class="inv-parties">
        <div>
          <h3>Bill to</h3>
          <div><b>${esc(job.client || 'Customer')}</b></div>
          ${job.phone ? `<div>${esc(job.phone)}</div>` : ''}
          ${job.email ? `<div>${esc(job.email)}</div>` : ''}
        </div>
        <div>
          <h3>Property</h3>
          <div>${esc(job.address)}</div>
        </div>
      </div>

      <h3 class="inv-section">Breakdown</h3>
      <table class="inv-table">
        <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>
          <tr>
            <td>${esc(svc ? svc.name : 'Roofing services')}${layers > 0 ? `<div class="inv-note">Tear off existing roof (${layers} layer${layers === 1 ? '' : 's'}) and complete the roofing work.</div>` : ''}</td>
            <td class="num">${area > 0 ? area + ' ' + esc(unitPlural()) : '—'}</td>
            <td class="num">${effRate != null ? money(effRate, true) : '—'}</td>
            <td class="num">${money(baseAmount, true)}</td>
          </tr>
          ${splitTear ? `
          <tr>
            <td>Additional tear-off — ${layers - 1} extra layer${layers > 2 ? 's' : ''}</td>
            <td class="num">${area} ${esc(unitPlural())}</td>
            <td class="num">${money(num(s.tearoffPerLayer), true)}/${esc(s.unit)}${layers > 2 ? ' × ' + (layers - 1) : ''}</td>
            <td class="num">${money(tear, true)}</td>
          </tr>` : ''}
          ${(job.extras || []).map(x => `
          <tr>
            <td>${esc(x.desc || 'Additional charge')}<div class="inv-note">Additional repair after tear-off / change order</div></td>
            <td class="num">—</td>
            <td class="num">—</td>
            <td class="num">${money(num(x.amount), true)}</td>
          </tr>`).join('')}
        </tbody>
      </table>

      <div class="inv-totals">
        ${tax > 0 ? `
        <div class="inv-row"><span>Subtotal</span><span>${money(subtotal, true)}</span></div>
        <div class="inv-row"><span>Sales tax (${num(job.taxRate)}%)</span><span>${money(tax, true)}</span></div>` : ''}
        <div class="inv-row inv-balance"><span>Total Contract Price</span><span>${money(total, true)}</span></div>
      </div>

      <h3 class="inv-section">Payment schedule</h3>
      <table class="inv-table">
        <thead><tr><th>Payment</th><th class="num">Amount</th><th>Due</th></tr></thead>
        <tbody>
          ${schedule.map(r => `
          <tr>
            <td>${esc(r.label)}${r.pct != null ? ` <span class="inv-note-inline">(${r.pct}%${r.label === (state.settings.paymentSchedule[0] || {}).label && num(s.depositCap) > 0 ? ', max ' + money(num(s.depositCap)) : ''})</span>` : ''}</td>
            <td class="num">${money(r.amount, true)}</td>
            <td>${esc(r.due)}</td>
          </tr>`).join('')}
          <tr class="inv-total-row"><td><b>TOTAL</b></td><td class="num"><b>${money(total, true)}</b></td><td></td></tr>
        </tbody>
      </table>

      <div class="inv-totals">
        ${(job.payments || []).filter(p => num(p.amount) > 0).map(p => `
          <div class="inv-row inv-muted"><span>Payment received ${dateLabel(p.date)}${p.method ? ' · ' + esc(p.method) : ''}</span><span>−${money(num(p.amount), true)}</span></div>`).join('')}
        ${paid > 0 ? `<div class="inv-row"><span>Paid to date</span><span>−${money(paid, true)}</span></div>` : ''}
        <div class="inv-row inv-balance"><span>Balance due</span><span>${money(balance, true)}</span></div>
      </div>

      ${disclosures.length ? `
      <h3 class="inv-section">Terms &amp; required notices</h3>
      <div class="inv-disclosures">
        ${disclosures.map(p => {
          const m = p.match(/^([A-Z][^:]{2,80}):\s*([\s\S]*)$/);
          return m ? `<p><b>${esc(m[1])}:</b> ${esc(m[2])}</p>` : `<p>${esc(p)}</p>`;
        }).join('')}
      </div>` : ''}

      ${s.invoiceNotes ? `<footer class="inv-foot">${esc(s.invoiceNotes)}</footer>` : ''}
    </div>`;
  overlay.hidden = false;
  document.body.classList.add('invoice-open');
  overlay.scrollTop = 0;
}

function closeInvoice() {
  const overlay = $('#invoice-overlay');
  overlay.hidden = true;
  overlay.innerHTML = '';
  document.body.classList.remove('invoice-open');
}

function openChangeOrder(jobId) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  if (!(job.extras || []).length) { toast('Add additional charges to the job first'); return; }
  const s = state.settings;
  const totalX = extrasTotal(job);
  const overlay = $('#invoice-overlay');
  overlay.innerHTML = `
    <div class="invoice-toolbar">
      <button class="btn" data-action="invoice-close">← Back to app</button>
      <button class="btn primary" data-action="invoice-print">Print / Save as PDF</button>
    </div>
    <div class="invoice-sheet">
      <header class="inv-head">
        <div class="inv-brand">
          <img src="${s.logoDataUrl ? esc(s.logoDataUrl) : 'assets/logo.png'}" alt="">
          <div>
            <div class="inv-company">${esc(s.companyName)} ${esc(s.tagline)}</div>
            <div>License #${esc(s.licenseNumber)} · Bonded · Insured</div>
          </div>
        </div>
        <div class="inv-meta"><div class="inv-title">CHANGE ORDER</div><div><b>Date</b> ${dateLabel(todayISO())}</div>${job.invoiceNumber ? `<div><b>Invoice No.</b> ${esc(String(job.invoiceNumber))}</div>` : ''}</div>
      </header>
      <div class="inv-parties">
        <div><h3>Owner</h3><div><b>${esc(job.client || 'Customer')}</b></div>${job.phone ? `<div>${esc(job.phone)}</div>` : ''}</div>
        <div><h3>Property</h3><div>${esc(job.address)}</div></div>
      </div>
      <div class="inv-disclosures"><p>The Owner authorizes the following additional work, discovered after tear-off or requested as a change to the original scope of work, at the prices listed below. This change order becomes part of the contract when signed by the Owner and Contractor.</p></div>
      <table class="inv-table">
        <thead><tr><th>Description of additional work</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${job.extras.map(x => `<tr><td>${esc(x.desc || 'Additional work')}</td><td class="num">${money(num(x.amount), true)}</td></tr>`).join('')}
          <tr class="inv-total-row"><td><b>TOTAL ADDED TO CONTRACT</b></td><td class="num"><b>${money(totalX, true)}</b></td></tr>
        </tbody>
      </table>
      <div class="inv-row"><span>Revised contract total</span><span><b>${money(jobTotal(job), true)}</b></span></div>
      <h3 class="inv-section">Approval</h3>
      <div class="inv-parties" style="margin-top:8px">
        <div><div>Owner signature: ____________________________</div><div style="margin-top:14px">Date: ____________________________</div></div>
        <div><div>Contractor signature: ____________________________</div><div style="margin-top:14px">Date: ____________________________</div></div>
      </div>
    </div>`;
  overlay.hidden = false;
  document.body.classList.add('invoice-open');
  overlay.scrollTop = 0;
}

/* ---------- Pricing sheet ---------- */

function extraRowHtml(extra) {
  extra = extra || { desc: '', amount: '' };
  return `
    <div class="expense-row" style="grid-template-columns: 1fr 130px 34px;">
      <input type="text" placeholder="Extra item (e.g. skylight flashing, fascia repair)" value="${esc(extra.desc)}" data-extra="desc">
      <input type="number" min="0" step="0.01" placeholder="0.00" value="${extra.amount === '' ? '' : esc(extra.amount)}" data-extra="amount" aria-label="Extra amount">
      <button type="button" class="btn-icon" data-action="est-remove-extra" title="Remove item" aria-label="Remove item">✕</button>
    </div>`;
}

function renderPricing() {
  const unit = esc(state.settings.unit);
  const unitP = esc(unitPlural());
  $('#view-pricing').innerHTML = `
    <div class="page-head">
      <div>
        <h1>Pricing Sheet</h1>
        <p>Enter the property details and the price is calculated from your rate card.</p>
      </div>
      <button class="btn" data-action="est-print">Print estimate</button>
    </div>

    <div class="pricing-layout">
      <div class="card">
        <h2>Estimate a job</h2>
        <p class="card-sub">The total updates as you type.</p>
        <div class="form-grid">
          <div class="field span-2">
            <label for="est-address">Property address</label>
            <input id="est-address" type="text" placeholder="123 Main St, City, State ZIP">
          </div>
          <div class="field">
            <label for="est-client">Property owner</label>
            <input id="est-client" type="text">
          </div>
          <div class="field">
            <label for="est-stories">Stories</label>
            <select id="est-stories">
              <option>1 story</option><option>2 stories</option><option>3+ stories</option>
            </select>
          </div>
          <div class="field">
            <label for="est-service">Service type</label>
            <select id="est-service">${serviceOptions('')}</select>
          </div>
          <div class="field">
            <label for="est-area">Roof size (${unitP})</label>
            <input id="est-area" type="number" min="0" step="0.01" placeholder="0">
          </div>
          <div class="field">
            <label for="est-layers">Tear-off layers</label>
            <input id="est-layers" type="number" min="1" step="1" value="1">
            <span class="hint">${money(num(state.settings.tearoffPerLayer), true)}/${unit} per extra layer</span>
          </div>
          <div class="field span-2">
            <label for="est-notes">Property notes</label>
            <textarea id="est-notes" placeholder="Pitch, access, tear-off, decking condition…"></textarea>
          </div>
        </div>

        <h2 style="margin-top:18px">Extras</h2>
        <p class="card-sub" style="margin-bottom:4px">Add-ons priced on top of the base rate.</p>
        <div class="expense-rows" id="est-extras"></div>
        <button type="button" class="btn small" style="margin-top:10px" data-action="est-add-extra">+ Add extra</button>

        <div class="estimate-total">
          <div>
            <div class="label">Suggested price for this job</div>
            <div class="estimate-breakdown" id="est-breakdown">Choose a service and roof size.</div>
          </div>
          <div class="amount" id="est-total">$0</div>
        </div>

        <div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap;">
          <button class="btn" data-action="est-save">Save estimate</button>
          <button class="btn primary" data-action="est-to-job">Create job from estimate</button>
        </div>
      </div>

      <div class="card">
        <h2>Rate card</h2>
        <p class="card-sub">Your current pricing. Edit rates in <button class="linklike" data-action="nav" data-view="settings">Settings</button>.</p>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Service</th><th class="num">Rate per ${unit}</th></tr></thead>
            <tbody>
              ${state.settings.services.map(s => `
                <tr><td>${esc(s.name)}</td><td class="num">${money(s.rate, s.rate % 1 !== 0)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:20px">
      <h2>Saved estimates</h2>
      <p class="card-sub">Quotes you've saved. Turn one into a job when it's won.</p>
      ${state.estimates.length === 0 ? `
        <div class="empty"><h3>No saved estimates</h3><p>Build one above and hit “Save estimate”.</p></div>` : `
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Date</th><th>Address</th><th>Service</th><th class="num">Size (${unitP})</th><th class="num">Quoted</th><th></th></tr></thead>
            <tbody>
              ${state.estimates.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(e => `
                <tr>
                  <td>${dateLabel((e.createdAt || '').slice(0, 10))}</td>
                  <td><b>${esc(e.address || '(no address)')}</b>${e.client ? `<br><span class="hint">${esc(e.client)}</span>` : ''}</td>
                  <td>${esc(serviceName(e.serviceId))}</td>
                  <td class="num">${e.area}</td>
                  <td class="num">${money(e.total)}</td>
                  <td class="num" style="white-space:nowrap">
                    <button class="btn small" data-action="est-saved-to-job" data-id="${esc(e.id)}">Create job</button>
                    <button class="btn-icon" data-action="est-delete" data-id="${esc(e.id)}" title="Delete estimate" aria-label="Delete estimate">✕</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
    </div>`;

  estimateRecalc();
  attachAddressAutocomplete($('#est-address'));
}

function readEstimateExtras() {
  return $$('#est-extras .expense-row').map(row => ({
    desc: $('[data-extra="desc"]', row).value.trim(),
    amount: num($('[data-extra="amount"]', row).value),
  })).filter(e => e.desc !== '' || e.amount !== 0);
}

function estimateRecalc() {
  const totalEl = $('#est-total');
  if (!totalEl) return;
  const serviceId = $('#est-service').value;
  const area = num($('#est-area').value);
  const layers = num($('#est-layers').value) || 1;
  const svc = getService(serviceId);
  const base = suggestedPrice(serviceId, area, layers);
  const tear = tearoffCharge(area, layers);
  const extras = readEstimateExtras().reduce((s, e) => s + e.amount, 0);
  const total = base + extras;
  totalEl.textContent = money(total);
  const unit = esc(state.settings.unit);
  $('#est-breakdown').innerHTML = svc && area > 0
    ? `${esc(svc.name)}: ${money(svc.rate, svc.rate % 1 !== 0)}/${unit} × ${area} ${esc(unitPlural())} = <b>${money(base - tear)}</b>${tear > 0 ? ` &nbsp;+&nbsp; tear-off (${layers - 1} extra layer${layers > 2 ? 's' : ''}) <b>${money(tear, true)}</b>` : ''}${extras > 0 ? ` &nbsp;+&nbsp; extras <b>${money(extras, true)}</b>` : ''}`
    : 'Choose a service and roof size.';
}

function readEstimateForm() {
  return {
    address: $('#est-address').value.trim(),
    client: $('#est-client').value.trim(),
    stories: $('#est-stories').value,
    serviceId: $('#est-service').value,
    area: num($('#est-area').value),
    layers: Math.max(1, Math.round(num($('#est-layers').value) || 1)),
    notes: $('#est-notes').value.trim(),
    extras: readEstimateExtras(),
  };
}

function estimateTotalOf(e) {
  return suggestedPrice(e.serviceId, e.area, e.layers) + (e.extras || []).reduce((s, x) => s + num(x.amount), 0);
}

function saveEstimate() {
  const e = readEstimateForm();
  if (!e.serviceId || e.area <= 0) {
    toast('Choose a service and enter the roof size first');
    return;
  }
  state.estimates.push({ id: uid(), createdAt: new Date().toISOString(), ...e, total: estimateTotalOf(e) });
  saveState();
  renderPricing();
  toast('Estimate saved');
}

function estimateToJob(est) {
  const noteParts = [];
  if (est.stories) noteParts.push(est.stories);
  if (est.notes) noteParts.push(est.notes);
  const extrasSum = (est.extras || []).reduce((s, x) => s + num(x.amount), 0);
  /* A saved estimate keeps its quoted total even if rates changed since. */
  const quotedTotal = typeof est.total === 'number' ? est.total : estimateTotalOf(est);
  const job = {
    id: uid(),
    createdAt: new Date().toISOString(),
    address: est.address,
    client: est.client || '',
    phone: '',
    email: '',
    serviceId: est.serviceId,
    area: est.area,
    layers: est.layers || 1,
    price: quotedTotal - extrasSum,
    extras: (est.extras || []).map(x => ({ id: uid(), desc: x.desc, amount: num(x.amount) })),
    status: 'quoted',
    startDate: '',
    completedDate: '',
    notes: noteParts.join('\n'),
    expenses: [],
    payments: [],
    labor: [],
  };
  state.jobs.push(job);
  saveState();
  showView('jobs');
  openJobDialog(job.id);
  toast('Job created from estimate');
}

/* ---------- Settings ---------- */

function renderSettings() {
  const s = state.settings;
  $('#view-settings').innerHTML = `
    <div class="page-head">
      <div>
        <h1>Settings</h1>
        <p>Branding, pricing rates, and your data. Changes save automatically.</p>
      </div>
    </div>

    <div class="settings-grid">
      <div class="card">
        <h2>Branding</h2>
        <p class="card-sub">Shown in the sidebar and on printed estimates.</p>
        <div style="display:flex; gap:16px; align-items:flex-start; margin-bottom:16px;">
          <img class="logo-preview" id="logo-preview" src="${s.logoDataUrl ? esc(s.logoDataUrl) : 'assets/logo.png'}" alt="Company logo">
          <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
            <label class="btn small" style="align-self:flex-start; cursor:pointer;">
              Upload logo
              <input type="file" id="logo-file" accept="image/*" hidden>
            </label>
            ${s.logoDataUrl ? '<button class="btn small" data-action="logo-reset">Use default logo</button>' : ''}
            <span class="hint">PNG, JPG, or SVG. It's stored in this browser only.</span>
          </div>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="set-company">Company name</label>
            <input id="set-company" type="text" value="${esc(s.companyName)}" data-setting="companyName">
          </div>
          <div class="field">
            <label for="set-tagline">Tagline</label>
            <input id="set-tagline" type="text" value="${esc(s.tagline)}" data-setting="tagline">
          </div>
          <div class="field">
            <label for="set-phone">Company phone</label>
            <input id="set-phone" type="tel" value="${esc(s.companyPhone)}" data-setting="companyPhone">
          </div>
          <div class="field">
            <label for="set-email">Company email</label>
            <input id="set-email" type="email" value="${esc(s.companyEmail)}" data-setting="companyEmail">
          </div>
          <div class="field span-2">
            <label for="set-address">Company address</label>
            <input id="set-address" type="text" value="${esc(s.companyAddress)}" data-setting="companyAddress">
          </div>
          <div class="field">
            <label for="set-license">License #</label>
            <input id="set-license" type="text" value="${esc(s.licenseNumber)}" data-setting="licenseNumber">
          </div>
          <div class="field span-2">
            <label for="set-invnotes">Invoice footer text</label>
            <textarea id="set-invnotes" data-setting="invoiceNotes">${esc(s.invoiceNotes)}</textarea>
            <span class="hint">Shown at the bottom of every customer invoice — payment terms, thank-you note, warranty info.</span>
          </div>
        </div>
        <p class="hint" style="margin-top:10px">These details appear on the invoices you create from a job.</p>
      </div>

      <div class="card">
        <h2>Pricing rates</h2>
        <p class="card-sub">Rates drive the Pricing Sheet and each job's suggested price. Changing a rate never touches prices already saved on jobs.</p>
        <div class="form-grid" style="margin-bottom:14px;">
          <div class="field">
            <label for="set-unit">Measurement unit</label>
            <input id="set-unit" type="text" value="${esc(s.unit)}" data-setting="unit">
            <span class="hint">Rates are per this unit. 1 roofing square = 100 sq ft.</span>
          </div>
          <div class="field">
            <label for="set-tearoff">Extra tear-off layer ($ per ${esc(s.unit)})</label>
            <input id="set-tearoff" type="number" min="0" step="0.01" value="${esc(s.tearoffPerLayer)}" data-setting="tearoffPerLayer">
            <span class="hint">Charged for each layer beyond the first.</span>
          </div>
        </div>
        <div id="rate-rows">
          ${s.services.map(svc => `
            <div class="rate-row" data-service-id="${esc(svc.id)}">
              <input type="text" value="${esc(svc.name)}" data-svc="name" aria-label="Service name">
              <input type="number" min="0" step="0.01" value="${esc(svc.rate)}" data-svc="rate" aria-label="Rate">
              <button type="button" class="btn-icon" data-action="svc-delete" data-id="${esc(svc.id)}" title="Remove service" aria-label="Remove service">✕</button>
            </div>`).join('')}
        </div>
        <button class="btn small" style="margin-top:6px" data-action="svc-add">+ Add service</button>
      </div>

      <div class="card">
        <h2>Payment schedule &amp; invoice terms</h2>
        <p class="card-sub">Milestone payments are calculated automatically from each job's total and printed on every invoice. If the percentages don't add up to 100%, the invoice shows the shortfall as a "Remaining balance" line.</p>
        <div class="field" style="max-width:240px; margin-bottom:14px;">
          <label for="set-depositcap">Deposit cap ($)</label>
          <input id="set-depositcap" type="number" min="0" step="1" value="${esc(s.depositCap)}" data-setting="depositCap">
          <span class="hint">California caps the down payment at $1,000 or 10%, whichever is less. Set 0 for no cap.</span>
        </div>
        <div id="sched-rows">
          ${(s.paymentSchedule || []).map(m => `
            <div class="sched-row" data-sched-id="${esc(m.id)}">
              <input type="text" value="${esc(m.label)}" data-sched="label" aria-label="Payment name">
              <input type="number" min="0" max="100" step="1" value="${esc(m.pct)}" data-sched="pct" aria-label="Percent">
              <input type="text" value="${esc(m.due)}" data-sched="due" aria-label="When due">
              <button type="button" class="btn-icon" data-action="sched-remove" data-id="${esc(m.id)}" title="Remove milestone" aria-label="Remove milestone">✕</button>
            </div>`).join('')}
        </div>
        <p class="hint" style="margin:6px 0 0">Name · % of total · when it's due — currently totals ${(s.paymentSchedule || []).reduce((t, m) => t + num(m.pct), 0)}%.</p>
        <button class="btn small" style="margin-top:8px" data-action="sched-add">+ Add milestone</button>
        <div class="field" style="margin-top:16px;">
          <label for="set-disclosures">Invoice terms &amp; required notices</label>
          <textarea id="set-disclosures" rows="8" data-setting="invoiceDisclosures">${esc(s.invoiceDisclosures)}</textarea>
          <span class="hint">Printed at the bottom of every invoice. Separate sections with a blank line; start each with a heading and a colon (e.g. "WARRANTY: …").</span>
        </div>
      </div>

      ${accountingSettingsHtml()}

      ${securityCardHtml()}

      <div class="card">
        <h2>Your data</h2>
        <p class="card-sub">Everything lives in this browser. Export a backup regularly — especially before clearing browser data or switching computers.</p>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn" data-action="export-json">Download backup</button>
          <label class="btn" style="cursor:pointer;">
            Restore backup
            <input type="file" id="import-file" accept="application/json,.json" hidden>
          </label>
          <button class="btn" data-action="export-csv">Export jobs CSV</button>
          <button class="btn" data-action="export-json-lite">Backup without files</button>
        </div>
        <hr style="border:0; border-top:1px solid var(--grid); margin:18px 0;">
        <button class="btn danger" data-action="wipe">Erase all data…</button>
      </div>
    </div>`;
}

function handleSettingChange(input) {
  const key = input.dataset.setting;
  const val = input.value.trim();
  /* Company name and unit can't be blank; everything else may be cleared. */
  if ((key === 'companyName' || key === 'unit') && !val) return;
  const numeric = ['tearoffPerLayer', 'depositCap', 'salesTaxRate', 'mileageRate', 'fiscalYearStart'];
  const next = numeric.includes(key) ? num(val) : val;
  if (state.settings[key] === next) return;
  state.settings[key] = next;
  if (['fiscalYearStart', 'accountingBasis', 'closingDate', 'salesTaxRate', 'mileageRate', 'defaultBankAccountId', 'ein', 'licenseNumber', 'companyName'].includes(key)) {
    logAudit('settings', key, '', String(next));
  }
  saveState();
  applyBrand();
}

function handleScheduleChange(input) {
  const row = input.closest('.sched-row');
  const m = (state.settings.paymentSchedule || []).find(x => x.id === row.dataset.schedId);
  if (!m) return;
  const field = input.dataset.sched;
  m[field] = field === 'pct' ? num(input.value) : input.value;
  saveState();
}

function handleServiceChange(input) {
  const row = input.closest('.rate-row');
  const svc = getService(row.dataset.serviceId);
  if (!svc) return;
  if (input.dataset.svc === 'name') {
    if (input.value.trim()) svc.name = input.value.trim();
  } else {
    svc.rate = num(input.value);
  }
  saveState();
}

async function exportBackup() {
  let attachments = [];
  try {
    const files = await allFiles();
    attachments = await Promise.all(files.map(async f => ({
      id: f.id, jobId: f.jobId, name: f.name, type: f.type, size: f.size, addedAt: f.addedAt,
      data: await blobToDataUrl(f.blob),
    })));
  } catch (err) {
    /* file storage unavailable — still back up everything else */
  }
  logAudit('export', 'backup', '', `${state.jobs.length} jobs · ${attachments.length} files`);
  saveState();
  downloadFile('roofing-tracker-backup.json', JSON.stringify({ ...state, attachments }, null, 2), 'application/json');
  toast('Backup downloaded');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.jobs)) {
        throw new Error('bad shape');
      }
      if (!canWrite()) { toast('Read-only accountant access — a backup can’t be restored'); return; }
      if (!confirm('Restore this backup? It will replace everything currently in the app.')) return;
      state = hydrateState(parsed);
      logAudit('restore', 'backup', '', `${file.name} · ${state.jobs.length} jobs`);
      saveState();
      if (Array.isArray(parsed.attachments)) {
        fileTx('readwrite', s => s.clear())
          .then(() => Promise.all(parsed.attachments.map(a => sealFileRec({
            id: a.id, jobId: a.jobId, name: a.name, type: a.type, size: a.size,
            addedAt: a.addedAt, blob: dataUrlToBlob(a.data),
          }).then(putFileRec))))
          .catch(() => {});
      }
      applyBrand();
      renderView();
      toast('Backup restored');
    } catch (err) {
      toast('That file doesn’t look like a valid backup');
    }
  };
  reader.readAsText(file);
}

function loadLogo(file) {
  if (file.size > 1024 * 1024) {
    toast('Please use an image under 1 MB');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    state.settings.logoDataUrl = reader.result;
    saveState();
    applyBrand();
    renderSettings();
    toast('Logo updated');
  };
  reader.readAsDataURL(file);
}

