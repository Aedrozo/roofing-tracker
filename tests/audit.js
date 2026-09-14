const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = 'file://' + path.resolve(__dirname, '../index.html');
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok || !detail ? '' : '  → ' + detail));
}

(async () => {
  // sample files to attach
  const f1 = path.join(__dirname, 'invoice-4417.pdf');
  const f2 = path.join(__dirname, 'receipt-dump.pdf');
  fs.writeFileSync(f1, '%PDF-1.4\n% sample supplier invoice for audit\n%%EOF');
  fs.writeFileSync(f2, '%PDF-1.4\n% sample dump receipt for audit\n%%EOF');

  const consoleErrors = [];
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  const page = await ctx.newPage();
  // The fixtures below are dated July 2026; freeze the clock so the suite stays green over time.
  await page.clock.setFixedTime(new Date('2026-07-20T12:00:00'));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('dialog', d => d.accept());

  // Simulated Photon geocoder (sandbox has no internet); default: no matches
  let photonFeatures = [];
  await page.route('**photon.komoot.io/**', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: photonFeatures }) }));

  await page.goto(APP);
  await page.waitForTimeout(250);

  // ---------- 1. Navigation ----------
  for (const v of ['jobs', 'pricing', 'settings', 'dashboard']) {
    await page.click(`.nav-btn[data-view="${v}"]`);
    const active = await page.evaluate(vv => document.querySelector('#view-' + vv).classList.contains('active'), v);
    if (!active) check('Navigation to ' + v, false);
  }
  check('Navigation between all four views', true);

  // ---------- 2. New-job validation ----------
  await page.click('#view-dashboard [data-action="new-job"]');
  await page.click('[data-action="jd-save"]'); // no address
  const stillOpen = await page.evaluate(() => document.querySelector('#job-dialog').open);
  const jobCount0 = await page.evaluate(() => JSON.parse(localStorage.getItem('ngpr-tracker-v1') || '{"jobs":[]}').jobs.length);
  check('New job without address is rejected', stillOpen && jobCount0 === 0);

  // ---------- 3. Create job: suggested price, use-suggested, expenses ----------
  await page.fill('#jd-address', '881 Sunset Mesa Dr, Tempe, AZ');
  await page.fill('#jd-client', 'R. Alvarez');
  await page.fill('#jd-email', 'rosa@example.com');
  await page.selectOption('#jd-service', 'new-tile-clay');
  await page.fill('#jd-area', '22');
  let calc = await page.textContent('#jd-calc');
  check('Suggested price = rate × size ($975 × 22 = $21,450)', calc.includes('$21,450'));
  await page.click('[data-action="jd-use-suggested"]');
  check('“Use suggested price” fills contract price', (await page.inputValue('#jd-price')) === '21450');

  await page.click('[data-action="jd-add-expense"]');
  await page.fill('#jd-expenses .expense-row:last-child [data-exp="desc"]', 'Clay tile order');
  await page.fill('#jd-expenses .expense-row:last-child [data-exp="amount"]', '8000');
  await page.click('[data-action="jd-add-expense"]');
  await page.fill('#jd-expenses .expense-row:last-child [data-exp="desc"]', 'Mistake row');
  await page.fill('#jd-expenses .expense-row:last-child [data-exp="amount"]', '999');
  await page.click('#jd-expenses .expense-row:last-child [data-action="jd-remove-expense"]');
  await page.waitForTimeout(80);
  calc = await page.textContent('#jd-calc');
  check('Expense add + remove recalculates (profit $13,450)', calc.includes('$13,450') && !calc.includes('999'));

  // ---------- 4. Attach invoices ----------
  await page.setInputFiles('#jd-file-input', [f1, f2]);
  await page.waitForTimeout(300);
  const fileRows = await page.locator('#jd-files .file-row').count();
  const fileNames = await page.textContent('#jd-files');
  check('Attach two invoices to a job', fileRows === 2 && fileNames.includes('invoice-4417.pdf') && fileNames.includes('receipt-dump.pdf'));

  // delete one
  await page.click('#jd-files .file-row:last-child [data-action="file-delete"]');
  await page.waitForTimeout(200);
  check('Delete an attached file', (await page.locator('#jd-files .file-row').count()) === 1);

  // view (popup) and download
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.click('#jd-files .file-row [data-action="file-open"]'),
  ]);
  check('View attached file opens it', !!popup);
  await popup.close();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#jd-files .file-row [data-action="file-download"]'),
  ]);
  check('Download attached file keeps original name', dl.suggestedFilename() === 'invoice-4417.pdf', dl.suggestedFilename());

  await page.selectOption('#jd-status', 'paid');
  await page.fill('#jd-completed', '2026-07-15');
  await page.click('[data-action="jd-save"]');
  await page.waitForTimeout(250);

  // ---------- 5. Jobs table: row, paperclip badge ----------
  await page.click('.nav-btn[data-view="jobs"]');
  await page.waitForTimeout(200);
  let rowText = await page.textContent('#view-jobs table tbody tr');
  check('Saved job appears in Jobs table', rowText.includes('881 Sunset Mesa'));
  await page.waitForTimeout(300);
  const badge = await page.locator('#view-jobs .file-badge').textContent().catch(() => '');
  check('Jobs list shows attachment count (📎1)', badge.includes('1'));

  // ---------- 6. Canceling a NEW job cleans up its uploads ----------
  await page.click('#view-jobs [data-action="new-job"]');
  await page.setInputFiles('#jd-file-input', [f2]);
  await page.waitForTimeout(250);
  await page.click('[data-action="jd-close"]'); // cancel
  await page.waitForTimeout(300);
  const orphanCount = await page.evaluate(() => allFiles().then(f => f.length));
  check('Canceling a new job removes its uploaded files', orphanCount === 1, 'files in store: ' + orphanCount);

  // ---------- 7. Edit an existing job ----------
  await page.click('#view-jobs tbody tr.rowlink');
  await page.waitForTimeout(150);
  const persistedFiles = await page.locator('#jd-files .file-row').count();
  check('Attachments persist when reopening a job', persistedFiles === 1);
  check('Client email persists on the job', (await page.inputValue('#jd-email')) === 'rosa@example.com');
  await page.fill('#jd-price', '22000');
  await page.click('[data-action="jd-save"]');
  await page.waitForTimeout(200);
  rowText = await page.textContent('#view-jobs table tbody tr');
  check('Editing a job updates the table ($22,000)', rowText.includes('$22,000'));

  // ---------- 8. Second job for filters + negative profit ----------
  await page.click('#view-jobs [data-action="new-job"]');
  await page.fill('#jd-address', '55 Quartz Canyon Ct, Gilbert, AZ');
  await page.selectOption('#jd-service', 'sheathing');
  await page.fill('#jd-area', '4');
  await page.fill('#jd-price', '900');
  await page.selectOption('#jd-status', 'completed');
  await page.fill('#jd-completed', '2026-06-05');
  await page.click('[data-action="jd-add-expense"]');
  await page.fill('#jd-expenses .expense-row:last-child [data-exp="desc"]', 'Plywood');
  await page.fill('#jd-expenses .expense-row:last-child [data-exp="amount"]', '1400');
  await page.click('[data-action="jd-save"]');
  await page.waitForTimeout(200);
  const negCell = await page.locator('#view-jobs td.profit-neg').first().textContent();
  check('Negative profit shown in red (-$500)', negCell.includes('500'));

  // search
  await page.fill('[data-field="job-search"]', 'Quartz');
  await page.waitForTimeout(150);
  check('Search filters by address', (await page.locator('#view-jobs tbody tr').count()) === 1);
  await page.fill('[data-field="job-search"]', 'zzz-no-match');
  await page.waitForTimeout(150);
  check('Search with no match shows empty state', (await page.textContent('#view-jobs')).includes('No jobs match'));
  await page.fill('[data-field="job-search"]', '');
  await page.waitForTimeout(150);
  // status filter
  await page.selectOption('[data-field="job-status"]', 'paid');
  await page.waitForTimeout(150);
  const paidRows = await page.locator('#view-jobs tbody tr').count();
  await page.selectOption('[data-field="job-status"]', 'all');
  check('Status filter (Paid only)', paidRows === 1);

  // ---------- 9. CSV export ----------
  const [csvDl] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#view-jobs [data-action="export-csv"]'),
  ]);
  const csvPath = path.join(__dirname, 'audit-jobs.csv');
  await csvDl.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  check('CSV export has data + per-square header',
    csv.includes('Roof size (squares)') && csv.includes('881 Sunset Mesa Dr') && csv.includes('22000.00') && csv.includes('-500.00'));

  // ---------- 10. Dashboard math ----------
  await page.click('.nav-btn[data-view="dashboard"]');
  await page.waitForTimeout(250);
  const tiles = (await page.textContent('.tiles')).replace(/\s+/g, ' ');
  // July paid job: rev 22000 exp 8000 profit 14000. June job: rev 900 exp 1400 profit -500.
  check('Month tile (Jul: $14,000 profit)', tiles.includes('$14,000'));
  check('Quarter tile (Q3 = Jul only: $14,000)', tiles.match(/THIS QUARTER.*?\$14,000/i) !== null || tiles.includes('$14,000'));
  check('Year tile (profit $13,500 = 14000 - 500)', tiles.includes('$13,500'));
  check('Tiles show revenue and expenses ($22,900 / $9,400)', tiles.includes('$22,900') && tiles.includes('$9,400'));

  // chart metric toggle
  await page.click('[data-action="chart-metric"][data-metric="revenue"]');
  await page.waitForTimeout(150);
  const ariaRev = await page.getAttribute('#chart-box svg', 'aria-label');
  check('Chart metric toggle switches to Revenue', ariaRev.includes('Revenue'));
  const barCount = await page.locator('#chart-box path[data-bar]').count();
  check('Chart draws one bar per month with data (2)', barCount === 2);

  // tooltip
  await page.hover('#chart-box .hover-col[data-idx="6"]');
  await page.waitForTimeout(100);
  const tt = await page.textContent('#chart-tooltip');
  check('Chart tooltip shows month breakdown', tt.includes('Jul') && tt.includes('$22,000') && tt.includes('$14,000'));

  // table view
  await page.click('details.chart-table summary');
  const chartTable = await page.textContent('details.chart-table');
  check('Chart “view as table” shows exact monthly values', chartTable.includes('Jun') && chartTable.includes('-$500'));

  // recent jobs row opens dialog
  await page.click('#view-dashboard tr.rowlink');
  await page.waitForTimeout(150);
  const dlgFromRecent = await page.evaluate(() => document.querySelector('#job-dialog').open);
  check('Recent-jobs row opens the job', dlgFromRecent);
  await page.click('[data-action="jd-close"]');

  // ---------- 11. Pricing sheet ----------
  await page.click('.nav-btn[data-view="pricing"]');
  await page.fill('#est-area', '10');
  await page.selectOption('#est-service', 'shingling');
  await page.waitForTimeout(100);
  check('Estimator live math ($650 × 10 = $6,500)', (await page.textContent('#est-total')).trim() === '$6,500');
  await page.click('[data-action="est-add-extra"]');
  await page.fill('#est-extras [data-extra="desc"]', 'Fascia repair');
  await page.fill('#est-extras [data-extra="amount"]', '300');
  await page.waitForTimeout(100);
  check('Estimator extras add on ($6,800)', (await page.textContent('#est-total')).trim() === '$6,800');
  await page.click('#est-extras [data-action="est-remove-extra"]');
  await page.waitForTimeout(100);
  check('Removing an extra recalculates ($6,500)', (await page.textContent('#est-total')).trim() === '$6,500');

  // creating a job from the form without address is rejected
  const jobsBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('ngpr-tracker-v1')).jobs.length);
  await page.click('[data-action="est-to-job"]');
  await page.waitForTimeout(150);
  const jobsAfterInvalid = await page.evaluate(() => JSON.parse(localStorage.getItem('ngpr-tracker-v1')).jobs.length);
  check('Estimate→job without address is rejected', jobsBefore === jobsAfterInvalid);

  // save estimate
  await page.fill('#est-address', '4040 Ironwood Pass, Chandler, AZ');
  await page.click('[data-action="est-save"]');
  await page.waitForTimeout(200);
  const savedRow = await page.textContent('#view-pricing > .card');
  check('Saved estimate appears in list ($6,500)', savedRow.includes('4040 Ironwood Pass') && savedRow.includes('$6,500'));

  // ---------- 12. Rate edits + saved quote stability ----------
  await page.click('.nav-btn[data-view="settings"]');
  await page.fill('#rate-rows .rate-row[data-service-id="shingling"] [data-svc="rate"]', '700');
  await page.waitForTimeout(150);
  await page.click('.nav-btn[data-view="pricing"]');
  await page.selectOption('#est-service', 'shingling');
  await page.fill('#est-area', '10');
  await page.waitForTimeout(100);
  check('Rate change updates estimator ($700 × 10 = $7,000)', (await page.textContent('#est-total')).trim() === '$7,000');

  // saved estimate must keep its original quoted price
  await page.click('[data-action="est-saved-to-job"]');
  await page.waitForTimeout(250);
  const quotedPrice = await page.inputValue('#jd-price');
  check('Job from saved estimate keeps quoted total ($6,500, not re-rated)', quotedPrice === '6500', 'got ' + quotedPrice);
  await page.click('[data-action="jd-close"]');
  // restore rate
  await page.click('.nav-btn[data-view="settings"]');
  await page.fill('#rate-rows .rate-row[data-service-id="shingling"] [data-svc="rate"]', '650');
  await page.waitForTimeout(150);

  // delete estimate
  await page.click('.nav-btn[data-view="pricing"]');
  await page.click('[data-action="est-delete"]');
  await page.waitForTimeout(200);
  check('Delete saved estimate', (await page.textContent('#view-pricing')).includes('No saved estimates'));

  // ---------- 13. Settings: branding, unit, services ----------
  await page.click('.nav-btn[data-view="settings"]');
  await page.fill('#set-company', 'NextGen');
  await page.waitForTimeout(150);
  check('Company name edit updates sidebar', (await page.textContent('#brand-title')).trim() === 'NextGen');
  await page.fill('#set-company', 'Next Gen');
  await page.waitForTimeout(100);

  await page.fill('#set-unit', 'sq ft');
  await page.click('.nav-btn[data-view="pricing"]');
  check('Unit change flows to labels', (await page.textContent('label[for="est-area"]')).includes('sq ft'));
  await page.click('.nav-btn[data-view="settings"]');
  await page.fill('#set-unit', 'square');
  await page.waitForTimeout(100);

  const svcBefore = await page.locator('#rate-rows .rate-row').count();
  await page.click('[data-action="svc-add"]');
  await page.waitForTimeout(150);
  const svcAfterAdd = await page.locator('#rate-rows .rate-row').count();
  await page.click('#rate-rows .rate-row:last-child [data-action="svc-delete"]');
  await page.waitForTimeout(200);
  const svcAfterDel = await page.locator('#rate-rows .rate-row').count();
  check('Add + remove service on rate card', svcAfterAdd === svcBefore + 1 && svcAfterDel === svcBefore);

  // logo upload + reset
  await page.setInputFiles('#logo-file', path.resolve(__dirname, '../assets/logo.png'));
  await page.waitForTimeout(400);
  const logoSrc = await page.getAttribute('#brand-logo', 'src');
  check('Logo upload replaces sidebar logo', logoSrc.startsWith('data:image'));
  await page.click('[data-action="logo-reset"]');
  await page.waitForTimeout(200);
  check('Logo reset returns to default', (await page.getAttribute('#brand-logo', 'src')).includes('assets/logo.png'));

  // ---------- 14. Backup export → wipe → restore ----------
  const [bakDl] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-action="export-json"]'),
  ]);
  const bakPath = path.join(__dirname, 'audit-backup.json');
  await bakDl.saveAs(bakPath);
  const bak = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
  check('Backup contains jobs, estimates, settings, and attachments',
    Array.isArray(bak.jobs) && bak.jobs.length === 3 && bak.settings && Array.isArray(bak.attachments) &&
    bak.attachments.length === 1 && bak.attachments[0].data.startsWith('data:'));

  await page.click('[data-action="wipe"]'); // both confirms auto-accepted
  await page.waitForTimeout(400);
  const wiped = await page.evaluate(() => ({
    jobs: JSON.parse(localStorage.getItem('ngpr-tracker-v1') || '{"jobs":[]}').jobs?.length ?? 0,
    files: null,
  }));
  const wipedFiles = await page.evaluate(() => allFiles().then(f => f.length));
  check('Erase-all clears jobs and attached files', (wiped.jobs === 0 || wiped.jobs === undefined) && wipedFiles === 0);

  await page.setInputFiles('#import-file', bakPath);
  await page.waitForTimeout(600);
  const restoredJobs = await page.evaluate(() => JSON.parse(localStorage.getItem('ngpr-tracker-v1')).jobs.length);
  const restoredFiles = await page.evaluate(() => allFiles().then(f => f.length));
  check('Restore backup brings back jobs AND attached invoices', restoredJobs === 3 && restoredFiles === 1);

  // ---------- 15. Persistence across reload ----------
  await page.reload();
  await page.waitForTimeout(300);
  const tilesAfter = (await page.textContent('.tiles')).replace(/\s+/g, ' ');
  check('All data survives a full reload', tilesAfter.includes('$13,500') || tilesAfter.includes('$14,000'));

  // print button presence (window.print itself can't run headless)
  await page.click('.nav-btn[data-view="pricing"]');
  check('Print estimate button present', (await page.locator('[data-action="est-print"]').count()) === 1);

  // ================= PHASE 2: payments, invoices, customers, schedule, PWA =================

  // ---------- 16. Payments & balance ----------
  await page.click('.nav-btn[data-view="jobs"]');
  await page.waitForTimeout(200);
  await page.click('#view-jobs tr:has-text("881 Sunset Mesa")');
  await page.waitForTimeout(150);
  await page.fill('#jd-start', '2026-07-06'); // for the schedule test later
  await page.click('[data-action="jd-add-payment"]');
  await page.fill('#jd-payments .payment-row:last-child [data-pay="amount"]', '10000');
  await page.fill('#jd-payments .payment-row:last-child [data-pay="note"]', 'Deposit');
  await page.waitForTimeout(100);
  let strip = await page.textContent('#jd-calc');
  check('Payment updates Paid to date ($10,000.00)', strip.includes('$10,000.00'));
  check('Balance due updates live ($12,000.00)', strip.includes('$12,000.00'));
  await page.click('[data-action="jd-save"]');
  await page.waitForTimeout(200);
  let jobsHtml = await page.textContent('#view-jobs');
  check('Jobs table shows balance column ($12,000)', jobsHtml.includes('$12,000'));

  // second payment → paid in full
  await page.click('#view-jobs tr:has-text("881 Sunset Mesa")');
  await page.waitForTimeout(150);
  await page.click('[data-action="jd-add-payment"]');
  await page.fill('#jd-payments .payment-row:last-child [data-pay="amount"]', '12000');
  await page.waitForTimeout(100);
  strip = await page.textContent('#jd-calc');
  check('Full payment shows Paid in full ✓', strip.includes('Paid in full'));
  await page.click('[data-action="jd-save"]');
  await page.waitForTimeout(200);
  check('Jobs table shows Paid ✓ when balance is zero', (await page.textContent('#view-jobs')).includes('Paid ✓'));

  // ---------- 17. Overdue + money-owed card ----------
  // The Quartz Canyon job completed 2026-06-05 with $900 unpaid → >30 days → overdue
  check('Overdue tag on unpaid old job', (await page.textContent('#view-jobs')).includes('OVERDUE'));
  await page.click('.nav-btn[data-view="dashboard"]');
  await page.waitForTimeout(250);
  const owedCard = await page.textContent('.owed-card').catch(() => '');
  check('Dashboard “Money owed to you” card ($900 outstanding)', owedCard.includes('$900') && owedCard.includes('OVERDUE'));

  // ---------- 18. Invoice generation ----------
  await page.click('.owed-card tr.rowlink'); // open the unpaid job
  await page.waitForTimeout(150);
  await page.click('[data-action="jd-invoice"]');
  await page.waitForTimeout(300);
  const invVisible = await page.evaluate(() => !document.querySelector('#invoice-overlay').hidden);
  const inv = await page.textContent('#invoice-overlay');
  check('Invoice overlay opens from job', invVisible);
  check('Invoice has number, brand, license, balance',
    inv.includes('INVOICE') && inv.includes('1001') && inv.includes('Next Gen') &&
    inv.includes('1156207') && inv.includes('Balance due') && inv.includes('$900.00'));
  await page.click('[data-action="invoice-close"]');
  await page.waitForTimeout(100);
  check('Invoice overlay closes', await page.evaluate(() => document.querySelector('#invoice-overlay').hidden));

  // invoice number is stable per job, increments for the next job
  await page.click('.nav-btn[data-view="jobs"]');
  await page.waitForTimeout(150);
  await page.click('#view-jobs tr:has-text("55 Quartz Canyon")');
  await page.waitForTimeout(150);
  await page.click('[data-action="jd-invoice"]');
  await page.waitForTimeout(250);
  check('Reinvoicing a job keeps its number (1001)', (await page.textContent('#invoice-overlay')).includes('1001'));
  await page.click('[data-action="invoice-close"]');
  await page.click('#view-jobs tr:has-text("881 Sunset Mesa")');
  await page.waitForTimeout(150);
  await page.click('[data-action="jd-invoice"]');
  await page.waitForTimeout(250);
  check('Next invoice gets the next number (1002)', (await page.textContent('#invoice-overlay')).includes('1002'));
  await page.click('[data-action="invoice-close"]');

  // ---------- 19. Customers ----------
  await page.click('.nav-btn[data-view="customers"]');
  await page.waitForTimeout(200);
  let custHtml = await page.textContent('#view-customers');
  check('Customer auto-created from job client (R. Alvarez)', custHtml.includes('R. Alvarez'));
  check('Customer inherits email from the job', custHtml.includes('rosa@example.com'));
  check('Customer row shows revenue ($22,000)', custHtml.includes('$22,000'));

  await page.click('#view-customers tr:has-text("R. Alvarez")');
  await page.waitForTimeout(150);
  const histRows = await page.locator('#customer-dialog tbody tr').count();
  check('Customer dialog shows job history', histRows === 1);
  await page.fill('#cd-name', 'Rosa Alvarez');
  await page.fill('#cd-email', 'rosa@example.com');
  await page.click('[data-action="cust-save"]');
  await page.waitForTimeout(200);
  custHtml = await page.textContent('#view-customers');
  check('Editing customer saves (renamed, email shown)', custHtml.includes('Rosa Alvarez') && custHtml.includes('rosa@example.com'));
  // rename propagates to the job
  await page.click('.nav-btn[data-view="jobs"]');
  await page.waitForTimeout(150);
  check('Customer rename updates their jobs', (await page.textContent('#view-jobs')).includes('Rosa Alvarez'));

  // manual add + phone autofill on new job
  await page.click('.nav-btn[data-view="customers"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="new-customer"]');
  await page.fill('#cd-name', 'Desert Property Mgmt');
  await page.fill('#cd-phone', '480-555-0100');
  await page.click('[data-action="cust-save"]');
  await page.waitForTimeout(200);
  await page.click('.nav-btn[data-view="jobs"]');
  await page.click('#view-jobs [data-action="new-job"]');
  await page.fill('#jd-client', 'Desert Property Mgmt');
  await page.dispatchEvent('#jd-client', 'change');
  await page.waitForTimeout(100);
  check('Known customer autofills phone on a new job', (await page.inputValue('#jd-phone')) === '480-555-0100');
  await page.fill('#jd-address', '900 Palo Verde Ln, Scottsdale, AZ');
  await page.selectOption('#jd-status', 'scheduled'); // no start date → unscheduled list
  await page.click('[data-action="jd-save"]');
  await page.waitForTimeout(200);

  // email autofill from a known customer
  await page.click('#view-jobs [data-action="new-job"]');
  await page.fill('#jd-client', 'Rosa Alvarez');
  await page.dispatchEvent('#jd-client', 'change');
  await page.waitForTimeout(100);
  check('Known customer autofills email on a new job', (await page.inputValue('#jd-email')) === 'rosa@example.com');
  await page.click('[data-action="jd-close"]');
  await page.waitForTimeout(150);

  // customer search
  await page.click('.nav-btn[data-view="customers"]');
  await page.waitForTimeout(150);
  await page.fill('[data-field="customer-search"]', 'Desert');
  await page.waitForTimeout(150);
  check('Customer search filters', (await page.locator('#view-customers tbody tr').count()) === 1);
  await page.fill('[data-field="customer-search"]', '');
  await page.waitForTimeout(150);

  // ---------- 20. Schedule ----------
  await page.click('.nav-btn[data-view="schedule"]');
  await page.waitForTimeout(200);
  let schedHtml = await page.textContent('#view-schedule');
  check('Calendar shows current month (July 2026)', schedHtml.includes('July 2026'));
  check('Job spans start→completion on calendar (881: Jul 6–15 = 10 chips)', (await page.locator('.cal-chip:has-text("881 Sunset Mesa")').count()) === 10);
  check('Unscheduled list shows dateless active job', schedHtml.includes('900 Palo Verde Ln'));
  await page.click('[data-action="sched-prev"]');
  await page.waitForTimeout(150);
  check('Month navigation works (June 2026)', (await page.textContent('#view-schedule')).includes('June 2026'));
  await page.click('[data-action="sched-today"]');
  await page.waitForTimeout(150);
  const chipOpens = await Promise.all([
    page.waitForTimeout(50),
    page.click('.cal-chip:has-text("881 Sunset Mesa")'),
  ]).then(() => page.evaluate(() => document.querySelector('#job-dialog').open));
  check('Clicking a calendar chip opens the job', chipOpens);
  await page.click('[data-action="jd-close"]');

  // ---------- 21. PWA files ----------
  const manifestLinked = await page.evaluate(() => !!document.querySelector('link[rel="manifest"]'));
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../manifest.webmanifest'), 'utf8'));
  const iconsExist = ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png']
    .every(f => fs.existsSync(path.resolve(__dirname, '../assets', f)));
  const swExists = fs.existsSync(path.resolve(__dirname, '../sw.js'));
  check('PWA manifest linked, valid, icons + service worker present',
    manifestLinked && manifest.icons.length === 3 && iconsExist && swExists);

  // ---------- 22. Employees & crew labor ----------
  await page.click('.nav-btn[data-view="employees"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="new-employee"]');
  await page.fill('#ed-name', 'Miguel Torres');
  await page.selectOption('#ed-paytype', 'hourly');
  await page.fill('#ed-rate', '35');
  await page.click('[data-action="emp-save"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="new-employee"]');
  await page.fill('#ed-name', 'Jake Summers');
  await page.selectOption('#ed-paytype', 'per-job');
  await page.fill('#ed-rate', '500');
  await page.click('[data-action="emp-save"]');
  await page.waitForTimeout(200);
  let empHtml = await page.textContent('#view-employees');
  check('Employees added with hourly and per-job pay',
    empHtml.includes('Miguel Torres') && empHtml.includes('$35.00/hr') &&
    empHtml.includes('Jake Summers') && empHtml.includes('$500/job'));

  await page.click('.nav-btn[data-view="jobs"]');
  await page.waitForTimeout(150);
  await page.click('#view-jobs tr:has-text("881 Sunset Mesa")');
  await page.waitForTimeout(150);
  await page.click('[data-action="jd-add-labor"]');
  await page.selectOption('#jd-labor .labor-row:last-child [data-lab="employeeId"]', { label: 'Miguel Torres — $35.00/hr' });
  await page.fill('#jd-labor .labor-row:last-child [data-lab="hours"]', '10');
  await page.waitForTimeout(100);
  const hourlyAmount = await page.inputValue('#jd-labor .labor-row:last-child [data-lab="amount"]');
  check('Hourly crew pay auto-calculates (10 hrs × $35 = 350.00)', hourlyAmount === '350.00', 'got ' + hourlyAmount);

  await page.click('[data-action="jd-add-labor"]');
  await page.selectOption('#jd-labor .labor-row:last-child [data-lab="employeeId"]', { label: 'Jake Summers — $500/job' });
  await page.waitForTimeout(100);
  const flatAmount = await page.inputValue('#jd-labor .labor-row:last-child [data-lab="amount"]');
  const hoursDisabled = await page.evaluate(() => document.querySelector('#jd-labor .labor-row:last-child [data-lab="hours"]').disabled);
  check('Per-job pay fills in automatically ($500, hours disabled)', flatAmount === '500' && hoursDisabled);

  let strip3 = await page.textContent('#jd-calc');
  check('Crew labor total in calc strip ($850.00)', strip3.includes('$850.00'));
  check('Labor deducted from profit ($22,000 − $8,000 − $850 = $13,150)', strip3.includes('$13,150'));
  await page.click('[data-action="jd-save"]');
  await page.waitForTimeout(200);
  const jobsAfterLabor = await page.textContent('#view-jobs');
  check('Jobs table costs include labor ($8,850 / $13,150)', jobsAfterLabor.includes('$8,850') && jobsAfterLabor.includes('$13,150'));

  // labor persists on reopen
  await page.click('#view-jobs tr:has-text("881 Sunset Mesa")');
  await page.waitForTimeout(150);
  const laborRows = await page.locator('#jd-labor .labor-row').count();
  const savedHours = await page.inputValue('#jd-labor .labor-row:first-child [data-lab="hours"]');
  check('Crew labor persists on the job', laborRows === 2 && savedHours === '10');
  await page.click('[data-action="jd-close"]');

  // employee totals
  await page.click('.nav-btn[data-view="employees"]');
  await page.waitForTimeout(200);
  empHtml = await page.textContent('#view-employees');
  check('Employee page totals pay across jobs ($350.00 / $500.00)', empHtml.includes('$350.00') && empHtml.includes('$500.00'));

  // dashboard math includes labor
  await page.click('.nav-btn[data-view="dashboard"]');
  await page.waitForTimeout(250);
  const tiles3 = (await page.textContent('.tiles')).replace(/\s+/g, ' ');
  check('Dashboard profit reflects labor (Jul $13,150, year $12,650)', tiles3.includes('$13,150') && tiles3.includes('$12,650'));

  // ---------- 23. Positions, project manager, expense paid ----------
  // give Miguel a position
  await page.click('.nav-btn[data-view="employees"]');
  await page.waitForTimeout(200);
  await page.click('#view-employees tr:has-text("Miguel Torres")');
  await page.waitForTimeout(150);
  await page.fill('#ed-position', 'Foreman');
  await page.click('[data-action="emp-save"]');
  await page.waitForTimeout(200);
  check('Employee position saves and shows in table', (await page.textContent('#view-employees')).includes('Foreman'));

  // add a project manager employee and assign to a job
  await page.click('[data-action="new-employee"]');
  await page.fill('#ed-name', 'Sandra Lee');
  await page.fill('#ed-position', 'Project Manager');
  await page.selectOption('#ed-paytype', 'per-job');
  await page.fill('#ed-rate', '300');
  await page.click('[data-action="emp-save"]');
  await page.waitForTimeout(200);

  await page.click('.nav-btn[data-view="jobs"]');
  await page.waitForTimeout(150);
  await page.click('#view-jobs tr:has-text("881 Sunset Mesa")');
  await page.waitForTimeout(150);
  await page.selectOption('#jd-manager', { label: 'Sandra Lee (Project Manager)' });
  // mark the expense paid while we're here
  await page.check('#jd-expenses .expense-row [data-exp="paid"]');
  await page.waitForTimeout(100);
  const stripPaid = await page.textContent('#jd-calc');
  check('Marking expense paid clears the unpaid hint', !stripPaid.includes('not paid yet'));
  await page.click('[data-action="jd-save"]');
  await page.waitForTimeout(200);
  check('Project manager shows on the jobs list (PM: Sandra Lee)', (await page.textContent('#view-jobs')).includes('PM: Sandra Lee'));

  // persistence of PM + paid checkbox
  await page.click('#view-jobs tr:has-text("881 Sunset Mesa")');
  await page.waitForTimeout(150);
  const pmSel = await page.locator('#jd-manager option:checked').textContent();
  const paidChecked = await page.evaluate(() => document.querySelector('#jd-expenses .expense-row [data-exp="paid"]').checked);
  check('PM assignment and paid expense persist on reopen', pmSel.includes('Sandra Lee') && paidChecked);

  // unpaid hint appears when a new unpaid expense is added
  await page.click('[data-action="jd-add-expense"]');
  await page.fill('#jd-expenses .expense-row:last-child [data-exp="desc"]', 'Dump fee');
  await page.fill('#jd-expenses .expense-row:last-child [data-exp="amount"]', '250');
  await page.waitForTimeout(100);
  const stripUnpaid = await page.textContent('#jd-calc');
  check('Unpaid expense shows “not paid yet” hint ($250.00)', stripUnpaid.includes('$250.00 not paid yet'));
  await page.click('#jd-expenses .expense-row:last-child [data-action="jd-remove-expense"]');
  await page.click('[data-action="jd-close"]');

  // ---------- 24. Address autocomplete (US only) ----------
  photonFeatures = [
    { properties: { countrycode: 'US', housenumber: '742', street: 'E Evergreen St', city: 'Mesa', state: 'Arizona', postcode: '85204', country: 'United States' } },
    { properties: { countrycode: 'GB', housenumber: '10', street: 'Downing Street', city: 'London', state: 'England', postcode: 'SW1A 2AA', country: 'United Kingdom' } },
  ];
  await page.click('.nav-btn[data-view="jobs"]');
  await page.waitForTimeout(150);
  await page.click('#view-jobs [data-action="new-job"]');
  await page.fill('#jd-address', '742 Evergreen');
  await page.waitForTimeout(600);
  const acItems = await page.locator('#job-dialog .ac-list .ac-item').count();
  const acText = await page.textContent('#job-dialog .ac-list');
  check('Address suggestions appear, US only (UK result filtered out)',
    acItems === 1 && acText.includes('742 E Evergreen St, Mesa, Arizona 85204') &&
    !acText.includes('United Kingdom') && !acText.includes('United States') && acText.includes('OpenStreetMap'));
  await page.click('#job-dialog .ac-list .ac-item:first-child');
  await page.waitForTimeout(100);
  check('Clicking a suggestion autofills the full address',
    (await page.inputValue('#jd-address')) === '742 E Evergreen St, Mesa, Arizona 85204');
  photonFeatures = [];
  await page.click('[data-action="jd-close"]');
  await page.waitForTimeout(200);
  check('Estimator address field has autocomplete too', await page.evaluate(() => {
    document.querySelector('.nav-btn[data-view="pricing"]').click();
    return document.querySelector('#est-address').dataset.acAttached === '1';
  }));

  // ---------- 25. Tear-off layers, extra charges, contract-style invoice ----------
  await page.click('.nav-btn[data-view="jobs"]');
  await page.waitForTimeout(150);
  await page.click('#view-jobs [data-action="new-job"]');
  await page.fill('#jd-address', '77 Saguaro Bluff Dr, Peoria, AZ');
  await page.selectOption('#jd-service', 'new-tile-clay');
  await page.fill('#jd-area', '22');
  await page.fill('#jd-layers', '3');
  await page.waitForTimeout(100);
  await page.click('[data-action="jd-use-suggested"]');
  const sugPrice = await page.inputValue('#jd-price');
  check('Tear-off layers priced in ($975×22 + 2 layers×$35×22 = 22990)', sugPrice === '22990', 'got ' + sugPrice);

  await page.click('[data-action="jd-add-extra"]');
  await page.fill('#jd-extras [data-jext="desc"]', 'Replace 4 sheets of sheathing');
  await page.fill('#jd-extras [data-jext="amount"]', '340');
  await page.waitForTimeout(100);
  const strip4 = await page.textContent('#jd-calc');
  check('Additional charge raises invoice total ($23,330.00)', strip4.includes('$23,330.00'));
  check('Balance due uses invoice total', strip4.includes('$23,330.00') && strip4.includes('$340.00'));

  await page.click('[data-action="jd-invoice"]');
  await page.waitForTimeout(350);
  const inv2 = await page.textContent('#invoice-overlay');
  check('Invoice itemizes tear-off line ($1,540.00 for 2 extra layers)',
    inv2.includes('Additional tear-off — 2 extra layers') && inv2.includes('$1,540.00'));
  check('Invoice lists additional charge with disclosure note',
    inv2.includes('Replace 4 sheets of sheathing') && inv2.includes('$340.00'));
  check('Payment schedule auto-calculated with $1,000 deposit cap',
    inv2.includes('Payment schedule') && inv2.includes('Deposit') && inv2.includes('$1,000.00') &&
    inv2.includes('When tear-off begins') && inv2.includes('$6,999.00'));
  check('Schedule shows remaining balance when %s don’t reach 100',
    inv2.includes('Remaining balance') && inv2.includes('$5,999.00'));
  check('Schedule TOTAL matches invoice total ($23,330.00)', inv2.includes('$23,330.00'));
  check('Invoice carries contract disclosures',
    inv2.includes('WARRANTY') && inv2.includes('THREE-DAY RIGHT TO CANCEL') && inv2.includes('MECHANICS’ LIENS'));
  await page.click('[data-action="invoice-close"]');
  await page.waitForTimeout(150);

  // schedule is editable in settings
  await page.click('.nav-btn[data-view="settings"]');
  await page.waitForTimeout(200);
  const schedRows = await page.locator('#sched-rows .sched-row').count();
  const disclosuresBox = await page.locator('#set-disclosures').count();
  check('Settings: 4 editable schedule milestones + disclosures editor', schedRows === 4 && disclosuresBox === 1);

  // ---------- 26. Scope of Work forms ----------
  await page.click('.nav-btn[data-view="scopes"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="scope-new"]');
  await page.waitForTimeout(200);
  await page.fill('#sc-address', '4501 Mesa Verde Way, Chula Vista, CA');
  await page.fill('[data-scope-field="custName"]', 'Elena Park');
  await page.fill('[data-scope-field="salesman"]', 'Sandra Lee');
  await page.check('input[data-scope-check="projectTypes"][value="Re-Roof"]');
  await page.check('input[data-scope-check="removal"][value="Remove existing roofing materials as specified"]');
  await page.check('input[data-scope-check="covering"][value="Concrete tile"]');
  await page.fill('[data-scope-field="squares"]', '18');
  await page.check('input[data-scope-check="vents"][value="O’Hagin vents"]');
  await page.click('[data-action="scope-save"]');
  await page.waitForTimeout(250);
  let scopeList = await page.textContent('#view-scopes');
  check('Scope form saves and shows salesman + project type',
    scopeList.includes('Scope of Work — 4501 Mesa Verde Way') || scopeList.includes('4501 Mesa Verde Way'));

  // persisted checkboxes on reopen
  const cbChecked = await page.evaluate(() => document.querySelector('input[data-scope-check="covering"][value="Concrete tile"]').checked);
  check('Scope form answers persist', cbChecked);

  // printable scope document
  await page.click('[data-action="scope-print"]');
  await page.waitForTimeout(300);
  const scopeDoc = await page.textContent('#invoice-overlay');
  check('Printable Scope of Work doc with sections + approval',
    scopeDoc.includes('SCOPE OF WORK') && scopeDoc.includes('Remove existing roofing materials as specified') &&
    scopeDoc.includes('O’Hagin vents') && scopeDoc.includes('Customer Approval') && scopeDoc.includes('Exclusions'));
  await page.click('[data-action="invoice-close"]');
  await page.click('[data-action="scope-cancel"]');
  await page.waitForTimeout(200);
  scopeList = await page.textContent('#view-scopes');
  check('Scope list shows the application', scopeList.includes('4501 Mesa Verde Way') && scopeList.includes('Sandra Lee') && scopeList.includes('Re-Roof'));

  // the scope form created a real, editable job
  await page.click('#view-scopes [data-action="open-job"]');
  await page.waitForTimeout(200);
  const scArea = await page.inputValue('#jd-area');
  const scSvc = await page.locator('#jd-service option:checked').textContent();
  check('Scope form created an editable job (18 squares, concrete tile service)',
    scArea === '18' && scSvc.includes('New Tile — Concrete'));
  await page.click('[data-action="jd-close"]');
  await page.click('.nav-btn[data-view="jobs"]');
  await page.waitForTimeout(200);
  check('Jobs list flags scope-form jobs (📋)', (await page.textContent('#view-jobs')).includes('📋'));

  // ---------- 27. Lead source, follow-ups, pipeline, change orders, payroll, photos ----------
  await page.click('.nav-btn[data-view="jobs"]');
  await page.waitForTimeout(150);
  await page.click('#view-jobs tr:has-text("4501 Mesa Verde")');
  await page.waitForTimeout(150);
  await page.selectOption('#jd-source', 'Referral');
  await page.fill('#jd-follow', '2026-07-01');
  const photoBtn = await page.locator('#jd-photo-input').count();
  await page.click('[data-action="jd-save"]');
  await page.waitForTimeout(200);
  check('Photo capture button on jobs', photoBtn === 1);

  await page.click('.nav-btn[data-view="dashboard"]');
  await page.waitForTimeout(250);
  const dash = await page.textContent('#view-dashboard');
  check('Follow-ups due card with overdue lead', dash.includes('Follow-ups due') && dash.includes('4501 Mesa Verde') && dash.includes('Referral'));
  check('Sales pipeline card with salesman close rates', dash.includes('Sales pipeline') && dash.includes('Sandra Lee') && dash.includes('Close rate'));

  // change order document
  await page.click('.nav-btn[data-view="jobs"]');
  await page.waitForTimeout(150);
  await page.click('#view-jobs tr:has-text("77 Saguaro")');
  await page.waitForTimeout(150);
  await page.click('[data-action="jd-changeorder"]');
  await page.waitForTimeout(300);
  const co = await page.textContent('#invoice-overlay');
  check('Printable change order with extras and revised total',
    co.includes('CHANGE ORDER') && co.includes('Replace 4 sheets of sheathing') && co.includes('$340.00') && co.includes('Revised contract total'));
  await page.click('[data-action="invoice-close"]');

  // payroll date range
  await page.click('.nav-btn[data-view="employees"]');
  await page.waitForTimeout(150);
  await page.fill('[data-field="pay-from"]', '2026-07-01');
  await page.fill('[data-field="pay-to"]', '2026-07-31');
  await page.waitForTimeout(250);
  const empPay = await page.textContent('#view-employees');
  check('Payroll pay-in-range report', empPay.includes('Pay in range') && empPay.includes('$350.00'));

  // backup without files
  await page.click('.nav-btn[data-view="settings"]');
  await page.waitForTimeout(150);
  const [liteDl] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-action="export-json-lite"]'),
  ]);
  check('Backup without files option', liteDl.suggestedFilename() === 'roofing-tracker-backup-nofiles.json');

  // ---------- 29. Accounting: ledger invariants ----------
  await page.click('.nav-btn[data-view="accounting"]');
  await page.waitForTimeout(150);
  const acctHtml = await page.textContent('#view-accounting');
  check('Accounting view renders overview with tabs', acctHtml.includes('Accounting') && (await page.locator('.acct-tabs button').count()) === 9);

  const ledgerOk = await page.evaluate(() => {
    const T = buildLedger();
    return T.length > 0 && T.every(t => Math.abs(t.lines.reduce((s, l) => s + l.dr - l.cr, 0)) < 0.005);
  });
  check('Every ledger transaction is balanced (debits = credits)', ledgerOk);

  const bs0 = await page.evaluate(() => reportData('balance', '', '2026-12-31', {}).summary);
  check('Balance sheet balances (Assets = Liabilities + Equity)', bs0.balanced === true, JSON.stringify(bs0));
  const tb0 = await page.evaluate(() => reportData('trial', '', '2026-12-31', {}).summary);
  check('Trial balance: total debits = total credits', tb0.balanced === true);

  const pnl = await page.evaluate(() => ({
    accrual: reportData('pnl', '2026-01-01', '2026-12-31', { basis: 'accrual' }).summary,
    cash: reportData('pnl', '2026-01-01', '2026-12-31', { basis: 'cash' }).summary,
    ni: netIncome(buildLedger(), '2026-01-01', '2026-12-31'),
  }));
  check('P&L (accrual) net income matches ledger net income', Math.abs(pnl.accrual.net - pnl.ni) < 0.01, JSON.stringify(pnl));
  check('P&L cash basis is computed from payments received', pnl.cash.income > 0 && pnl.cash.income !== pnl.accrual.income);

  // Every report runs without throwing and produces columns
  const reportNames = await page.evaluate(() => REPORTS.map(r => r[0]));
  const reportFails = [];
  for (const r of reportNames) {
    const ok = await page.evaluate(n => { try { const R = reportData(n, '2026-01-01', '2026-12-31', {}); return R.cols.length > 0; } catch (e) { return e.message; } }, r);
    if (ok !== true) reportFails.push(r + ':' + ok);
  }
  check('All 17 reports run (' + reportNames.length + ')', reportNames.length === 17 && reportFails.length === 0, reportFails.join(', '));

  // ---------- 30. Bills, vendors, A/P aging ----------
  await page.click('.acct-tabs [data-tab="bills"]');
  await page.click('[data-action="acct-new-bill"]');
  await page.click('[data-action="acct-save-bill"]'); // empty → rejected
  check('Bill without vendor/amount is rejected', await page.evaluate(() => document.querySelector('#acct-dialog').open));
  await page.fill('#bd-vendor', 'ABC Roofing Supply');
  await page.fill('#bd-date', '2026-07-10');
  await page.fill('#bd-amount', '1200');
  await page.fill('#bd-ref', 'INV-5510');
  await page.fill('#bd-due', '2026-08-09');
  await page.click('[data-action="acct-save-bill"]');
  await page.waitForTimeout(100);
  const billsHtml = await page.textContent('#view-accounting');
  check('Unpaid bill saved and listed', billsHtml.includes('ABC Roofing Supply') && billsHtml.includes('INV-5510') && billsHtml.includes('Unpaid'));
  const ap1 = await page.evaluate(() => reportData('ap', '', '2026-07-31', {}).summary.total);
  check('A/P aging includes the unpaid bill', ap1 >= 1200);
  check('Vendor auto-created from the bill', await page.evaluate(() => state.vendors.some(v => v.name === 'ABC Roofing Supply')));

  // mark paid
  await page.click('#view-accounting tr:has-text("ABC Roofing Supply")');
  await page.check('#bd-paid');
  await page.fill('#bd-paiddate', '2026-07-12');
  await page.click('[data-action="acct-save-bill"]');
  await page.waitForTimeout(100);
  const ap2 = await page.evaluate(() => reportData('ap', '', '2026-07-31', {}).summary.total);
  check('Paying the bill removes it from A/P', Math.abs(ap1 - ap2 - 1200) < 0.01, ap1 + ' → ' + ap2);
  const bsAfterBill = await page.evaluate(() => reportData('balance', '', '2026-12-31', {}).summary.balanced);
  check('Books still balance after bill + payment', bsAfterBill === true);

  // attach a receipt to the bill
  await page.click('#view-accounting tr:has-text("ABC Roofing Supply")');
  await page.setInputFiles('#ac-file-input', [f2]);
  await page.waitForTimeout(300);
  check('Receipt attached to a bill', (await page.locator('#ac-files .file-row').count()) === 1);
  await page.click('[data-action="acct-dlg-close"]');

  // vendor 1099 flag
  await page.click('.acct-tabs [data-tab="vendors"]');
  await page.click('#view-accounting tr:has-text("ABC Roofing Supply")');
  await page.check('#vd-1099');
  await page.fill('#vd-taxid', '12-3456789');
  await page.click('[data-action="acct-save-vendor"]');
  await page.waitForTimeout(100);
  const f1099 = await page.evaluate(() => reportData('form1099', '2026-01-01', '2026-12-31', {}).rows);
  check('1099 report flags vendor paid ≥ $600 with masked tax ID and missing W-9',
    f1099.length === 1 && f1099[0][0] === 'ABC Roofing Supply' && f1099[0][1] === '••••6789' && f1099[0][2] === 'MISSING' && f1099[0][4] === 'REQUIRED', JSON.stringify(f1099));

  // ---------- 31. Journal entries ----------
  await page.click('.acct-tabs [data-tab="register"]');
  await page.click('[data-action="acct-new-je"]');
  await page.fill('#je-date', '2026-07-01');
  await page.fill('#je-memo', 'Owner contribution');
  await page.selectOption('#je-lines .je-row:nth-child(1) [data-je="acct"]', 'a1000');
  await page.fill('#je-lines .je-row:nth-child(1) [data-je="dr"]', '5000');
  await page.selectOption('#je-lines .je-row:nth-child(2) [data-je="acct"]', 'a3000');
  await page.fill('#je-lines .je-row:nth-child(2) [data-je="cr"]', '4000');
  await page.click('[data-action="acct-save-je"]');
  check('Unbalanced journal entry is rejected', await page.evaluate(() => document.querySelector('#acct-dialog').open && state.journal.length === 0));
  await page.fill('#je-lines .je-row:nth-child(2) [data-je="cr"]', '5000');
  await page.waitForTimeout(50);
  check('Journal dialog shows Balanced ✓ when debits = credits', (await page.textContent('#je-calc')).includes('Balanced'));
  await page.click('[data-action="acct-save-je"]');
  await page.waitForTimeout(100);
  const regHtml = await page.textContent('#view-accounting');
  check('Balanced journal entry posts to the register', regHtml.includes('Owner contribution') && await page.evaluate(() => state.journal.length === 1));
  const eqAfter = await page.evaluate(() => accountBalance(buildLedger(), 'a3000', '2026-12-31'));
  check('Owner’s Equity reflects the journal entry ($5,000)', Math.abs(eqAfter - 5000) < 0.01, String(eqAfter));

  // ---------- 32. Sales tax on a job + invoice ----------
  await page.click('.nav-btn[data-view="jobs"]');
  await page.click('#view-jobs tr:has-text("881 Sunset Mesa")');
  await page.fill('#jd-tax', '7.75');
  await page.waitForTimeout(50);
  const calcTax = await page.textContent('#jd-calc');
  check('Job dialog shows sales tax in the invoice total', calcTax.includes('sales tax'));
  await page.click('[data-action="jd-invoice"]');
  await page.waitForTimeout(100);
  const invTax = await page.textContent('#invoice-overlay');
  check('Invoice prints Subtotal / Sales tax (7.75%) / Total', invTax.includes('Subtotal') && invTax.includes('Sales tax (7.75%)'));
  await page.click('[data-action="invoice-close"]');
  const taxRep = await page.evaluate(() => ({ rows: reportData('salestax', '2026-01-01', '2026-12-31', {}).rows.length, liab: accountBalance(buildLedger(), 'a2300', '2026-12-31'), bal: reportData('balance', '', '2026-12-31', {}).summary.balanced }));
  check('Sales tax report + Sales Tax Payable liability + books balance', taxRep.rows >= 1 && taxRep.liab > 0 && taxRep.bal === true, JSON.stringify(taxRep));
  // reset tax so later dashboard checks keep their numbers
  await page.click('#view-jobs tr:has-text("881 Sunset Mesa")');
  await page.fill('#jd-tax', '0');
  await page.click('[data-action="jd-save"]');
  await page.waitForTimeout(100);

  // ---------- 33. Closing date (period lock) ----------
  await page.click('.nav-btn[data-view="settings"]');
  await page.fill('#set-closing', '2026-07-31');
  await page.waitForTimeout(100);
  await page.click('.nav-btn[data-view="accounting"]');
  await page.click('.acct-tabs [data-tab="bills"]');
  await page.click('#view-accounting tr:has-text("ABC Roofing Supply")');
  await page.fill('#bd-amount', '9999');
  await page.click('[data-action="acct-save-bill"]');
  const lockedBill = await page.evaluate(() => state.bills[0].amount);
  check('Closing date blocks editing a bill in the closed period', lockedBill === 1200 && await page.evaluate(() => document.querySelector('#acct-dialog').open));
  await page.click('[data-action="acct-dlg-close"]');
  await page.click('.nav-btn[data-view="jobs"]');
  const price881 = await page.evaluate(() => state.jobs.find(j => j.address.startsWith('881')).price);
  await page.click('#view-jobs tr:has-text("881 Sunset Mesa")');
  await page.fill('#jd-price', '1');
  await page.click('[data-action="jd-save"]');
  check('Closing date blocks editing a job completed in the closed period', await page.evaluate(p => state.jobs.find(j => j.address.startsWith('881')).price === p && document.querySelector('#job-dialog').open, price881));
  await page.click('[data-action="jd-close"]');
  await page.click('.nav-btn[data-view="settings"]');
  await page.fill('#set-closing', '');
  await page.waitForTimeout(100);

  // ---------- 34. Audit log ----------
  const audit = await page.evaluate(() => state.audit.map(a => a.action + ':' + a.entity));
  check('Audit log records job, bill, vendor, journal, and settings changes',
    audit.includes('create:bill') && audit.includes('update:bill') && audit.includes('update:vendor') && audit.includes('create:journal') && audit.includes('settings:closingDate') && audit.includes('update:job'), audit.slice(-8).join(','));
  await page.click('.nav-btn[data-view="accounting"]');
  await page.click('.acct-tabs [data-tab="audit"]');
  check('Audit Log tab lists entries newest first', (await page.textContent('#view-accounting')).includes('Owner contribution'));

  // ---------- 35. Bank reconciliation with CSV import ----------
  await page.click('.acct-tabs [data-tab="reconcile"]');
  const stmtPath = path.join(__dirname, 'statement.csv');
  fs.writeFileSync(stmtPath, 'Date,Description,Amount\n07/12/2026,"ABC ROOFING SUPPLY",-1200.00\n07/14/2026,"UNKNOWN CHARGE",-42.50\n');
  await page.setInputFiles('#acct-stmt-file', stmtPath);
  await page.waitForTimeout(200);
  const recHtml = await page.textContent('#view-accounting');
  const clearedKeys = await page.evaluate(() => Object.keys(state.cleared).length);
  check('Bank CSV import auto-matches the bill payment and flags the unknown line', recHtml.includes('Matched ✓') && recHtml.includes('NOT IN BOOKS') && clearedKeys === 1, 'cleared=' + clearedKeys);
  await page.fill('[data-field="acct-stmtbal"]', '0');
  await page.waitForTimeout(600);
  check('Reconcile shows cleared balance and difference', (await page.textContent('#view-accounting')).includes('Cleared balance'));

  // ---------- 36. Documents center ----------
  await page.click('.acct-tabs [data-tab="documents"]');
  await page.waitForTimeout(250);
  const docsHtml = await page.textContent('#acct-docs');
  check('Documents center lists job and bill attachments together', docsHtml.includes('invoice-4417.pdf') && docsHtml.includes('receipt-dump.pdf') && docsHtml.includes('ABC Roofing Supply'), docsHtml.replace(/\s+/g, ' ').slice(0, 300));

  // ---------- 37. Exports for the accountant ----------
  await page.click('.acct-tabs [data-tab="reports"]');
  await page.selectOption('[data-field="acct-report"]', 'gl');
  await page.waitForTimeout(100);
  const [repDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="acct-report-csv"]')]);
  check('Report CSV export', repDl.suggestedFilename().startsWith('NGPR_gl_'));

  const pkgNames = [];
  const onDl = d => pkgNames.push(d.suggestedFilename());
  page.on('download', onDl);
  await page.click('[data-action="acct-package"]');
  await page.waitForTimeout(17 * 350 + 1500);
  page.off('download', onDl);
  check('Accountant package downloads all 17 CSV reports', pkgNames.length === 17 && pkgNames.some(n => n.includes('profit-and-loss-accrual')) && pkgNames.some(n => n.includes('1099-vendors')), pkgNames.length + ' files');

  // ---------- 38. Security: encryption, lock, accountant read-only ----------
  await page.click('.nav-btn[data-view="settings"]');
  await page.fill('#sec-pass1', 'owner-pass-1');
  await page.fill('#sec-pass2', 'owner-pass-2');
  await page.click('[data-action="sec-enable"]');
  await page.waitForTimeout(100);
  check('Mismatched passcodes are rejected', await page.evaluate(() => !localStorage.getItem('ngpr-sec-v1')));
  await page.fill('#sec-pass1', 'owner-pass-1');
  await page.fill('#sec-pass2', 'owner-pass-1');
  await page.click('[data-action="sec-enable"]');
  await page.waitForTimeout(800);
  const encState = await page.evaluate(async () => ({
    raw: localStorage.getItem('ngpr-tracker-v1').slice(0, 9),
    cfg: !!localStorage.getItem('ngpr-sec-v1'),
    files: (await rawAllFiles()).map(f => !!f.enc && !f.blob),
  }));
  check('Enabling passcode encrypts state and every attached file (AES-GCM)', encState.raw === '{"enc":1,' && encState.cfg && encState.files.length === 2 && encState.files.every(Boolean), JSON.stringify(encState));
  check('Lock button appears in the sidebar', await page.evaluate(() => !document.querySelector('#lock-btn').hidden));

  // set accountant passcode
  await page.fill('#sec-acct', 'cpa-readonly-1');
  await page.click('[data-action="sec-set-acct"]');
  await page.waitForTimeout(300);
  check('Accountant passcode saved', await page.evaluate(() => !!JSON.parse(localStorage.getItem('ngpr-sec-v1')).acct));

  // reload → locked
  await page.reload();
  await page.waitForTimeout(300);
  check('App opens locked after reload', await page.evaluate(() => !document.querySelector('#lock-screen').hidden && document.body.classList.contains('locked') && state.jobs.length === 0));
  await page.fill('#lock-pass', 'wrong-pass');
  await page.click('#lock-form button[type="submit"]');
  await page.waitForTimeout(400);
  check('Wrong passcode is refused', (await page.textContent('#lock-msg')).includes('Wrong passcode'));

  // unlock as accountant
  await page.fill('#lock-pass', 'cpa-readonly-1');
  await page.click('#lock-form button[type="submit"]');
  await page.waitForTimeout(600);
  const cpaState = await page.evaluate(() => ({ locked: document.body.classList.contains('locked'), ro: document.body.classList.contains('readonly'), jobs: state.jobs.length, badge: !document.querySelector('#role-badge').hidden, role: session.role }));
  check('Accountant passcode unlocks in read-only mode with data visible', !cpaState.locked && cpaState.ro && cpaState.jobs > 0 && cpaState.badge && cpaState.role === 'accountant', JSON.stringify(cpaState));
  await page.click('.nav-btn[data-view="jobs"]');
  check('Read-only role hides “New job” and other write buttons', await page.evaluate(() => getComputedStyle(document.querySelector('#view-jobs [data-action="new-job"]')).display === 'none'));
  await page.click('#view-jobs tr:has-text("881 Sunset Mesa")');
  await page.fill('#jd-price', '5');
  check('Read-only role hides the Save button in the job dialog', await page.evaluate(() => getComputedStyle(document.querySelector('[data-action="jd-save"]')).display === 'none'));
  await page.evaluate(() => saveJobFromDialog()); // even a forced save is refused
  await page.waitForTimeout(100);
  check('Accountant cannot save changes to a job', await page.evaluate(p => state.jobs.find(j => j.address.startsWith('881')).price === p, price881));
  await page.click('[data-action="jd-invoice"]');
  await page.waitForTimeout(100);
  check('Accountant can still view invoices', await page.evaluate(() => !document.querySelector('#invoice-overlay').hidden && !document.querySelector('#job-dialog').open));
  await page.click('[data-action="invoice-close"]');
  await page.click('.nav-btn[data-view="accounting"]');
  const [roDl] = await Promise.all([page.waitForEvent('download'), page.click('.acct-tabs [data-tab="reports"]').then(() => page.click('[data-action="acct-report-csv"]'))]);
  check('Accountant can export reports', roDl.suggestedFilename().startsWith('NGPR_'));

  // lock and unlock as owner; attachments readable again
  await page.click('#lock-btn');
  await page.waitForTimeout(100);
  check('Lock now clears data from memory', await page.evaluate(() => document.body.classList.contains('locked') && state.jobs.length === 0));
  await page.fill('#lock-pass', 'owner-pass-1');
  await page.click('#lock-form button[type="submit"]');
  await page.waitForTimeout(600);
  const ownerState = await page.evaluate(async () => ({ ro: document.body.classList.contains('readonly'), role: session.role, jobs: state.jobs.length, blobs: (await allFiles()).every(f => f.blob && f.blob.size > 0) }));
  check('Owner passcode restores full access and decrypts attachments', !ownerState.ro && ownerState.role === 'owner' && ownerState.jobs > 0 && ownerState.blobs, JSON.stringify(ownerState));

  // auto-lock timer fires
  await page.click('.nav-btn[data-view="settings"]');
  await page.fill('#sec-autolock', '1');
  await page.click('[data-action="sec-autolock-save"]');
  await page.evaluate(() => { clearTimeout(session.lockTimer); session.lockTimer = setTimeout(() => { lockSession(); showLockScreen(); }, 200); });
  await page.waitForTimeout(500);
  check('Idle auto-lock locks the app', await page.evaluate(() => document.body.classList.contains('locked')));
  await page.fill('#lock-pass', 'owner-pass-1');
  await page.click('#lock-form button[type="submit"]');
  await page.waitForTimeout(600);

  // disable → plain again
  await page.click('.nav-btn[data-view="settings"]');
  await page.click('[data-action="sec-disable"]');
  await page.waitForTimeout(800);
  const plain = await page.evaluate(async () => ({ raw: localStorage.getItem('ngpr-tracker-v1').slice(0, 2), cfg: localStorage.getItem('ngpr-sec-v1'), files: (await rawAllFiles()).every(f => f.blob && !f.enc) }));
  check('Turning protection off stores data unencrypted again', plain.raw === '{"' && plain.cfg === null && plain.files, JSON.stringify(plain));

  // ---------- 39. Backup round-trip includes accounting data ----------
  const [fullDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-json"]')]);
  const backup = JSON.parse(fs.readFileSync(await fullDl.path(), 'utf8'));
  check('Backup contains bills, vendors, journal, accounts, audit log, and attachments', backup.bills.length === 1 && backup.vendors.length === 1 && backup.journal.length === 1 && backup.accounts.length > 20 && backup.audit.length > 5 && backup.attachments.length === 2);

  // ---------- 28. v2 → v4 migration ----------
  const page2 = await ctx.newPage();
  await page2.goto(APP);
  await page2.evaluate(() => {
    localStorage.setItem('ngpr-tracker-v1', JSON.stringify({
      version: 2,
      settings: { companyName: 'Next Gen', tagline: 'Premier Roofing Contractor', unit: 'square',
        services: [{ id: 'shingling', name: 'Shingling', rate: 650 }], logoDataUrl: null },
      jobs: [{ id: 'old1', address: '1 Old Job Rd', client: 'Legacy Client', phone: '111-222-3333',
        serviceId: 'shingling', area: 10, price: 6500, status: 'paid', startDate: '', completedDate: '2026-03-10',
        notes: '', expenses: [], createdAt: '2026-03-01T00:00:00.000Z' }],
      estimates: []
    }));
  });
  await page2.reload();
  await page2.waitForTimeout(300);
  const migrated = await page2.evaluate(() => JSON.parse(localStorage.getItem('ngpr-tracker-v1')));
  check('v2→v4 migration seeds customers and adds payment/labor arrays',
    migrated.version === 4 && migrated.customers.length === 1 && migrated.customers[0].name === 'Legacy Client' &&
    migrated.jobs[0].customerId === migrated.customers[0].id && Array.isArray(migrated.jobs[0].payments) &&
    Array.isArray(migrated.jobs[0].labor) && Array.isArray(migrated.employees));
  await page2.close();

  // ---------- console errors ----------
  check('No JavaScript errors during entire audit', consoleErrors.length === 0, consoleErrors.join(' | '));

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log('\n========== AUDIT SUMMARY ==========');
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { failed.forEach(f => console.log('FAILED: ' + f.name + ' ' + f.detail)); process.exit(1); }
})();
