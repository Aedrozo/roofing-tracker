'use strict';

/* ============================================================
   Event wiring
   ============================================================ */

/* Actions that change data are blocked for the read-only accountant role.
   Viewing, printing, and exporting stay available. */
const READONLY_ALLOWED = /^(nav|open-|export-|scope-edit|scope-cancel|scope-print|emp-close|cust-close|sched-(prev|next|today)|jd-close|jd-invoice|jd-changeorder|invoice-|chart-metric|file-open|file-download|est-print|acct-tab|acct-period|acct-basis|acct-print|acct-package|acct-report-csv|acct-audit-csv|acct-dlg-close|acct-open-|sec-lock)/;

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (!canWrite() && !READONLY_ALLOWED.test(action)) {
    toast('Read-only accountant access — viewing and exporting only');
    return;
  }
  if (action.startsWith('acct-') || action.startsWith('sec-')) {
    acctAction(action, el);
    return;
  }

  switch (action) {
    case 'nav': showView(el.dataset.view); break;
    case 'new-job': openJobDialog(null); break;
    case 'open-job': {
      const cd = $('#customer-dialog');
      if (cd.open) cd.close();
      openJobDialog(el.dataset.id);
      break;
    }
    case 'export-csv': exportCsv(); break;

    /* Scope of Work forms */
    case 'scope-new': ui.scopeJobId = 'new'; renderScopes(); break;
    case 'scope-edit': ui.scopeJobId = el.dataset.id; renderScopes(); break;
    case 'scope-cancel': ui.scopeJobId = null; renderScopes(); break;
    case 'scope-save': saveScopeForm(); break;
    case 'scope-print': openScopeDoc(ui.scopeJobId); break;

    /* Employees */
    case 'new-employee': openEmployeeDialog(null); break;
    case 'open-employee': openEmployeeDialog(el.dataset.id); break;
    case 'emp-close': $('#employee-dialog').close(); break;
    case 'emp-save': saveEmployeeFromDialog(); break;
    case 'emp-delete': {
      const dlg = $('#employee-dialog');
      const emp = getEmployee(dlg.dataset.employeeId);
      if (emp && confirm(`Remove "${emp.name}" from your crew? Pay already recorded on jobs is kept.`)) {
        state.employees = state.employees.filter(x => x.id !== emp.id);
        logAudit('delete', 'employee', emp.id, emp.name);
        saveState();
        dlg.close();
        renderView();
        toast('Employee removed');
      }
      break;
    }

    /* Customers */
    case 'new-customer': openCustomerDialog(null); break;
    case 'open-customer': openCustomerDialog(el.dataset.id); break;
    case 'cust-close': $('#customer-dialog').close(); break;
    case 'cust-save': saveCustomerFromDialog(); break;
    case 'cust-delete': {
      const dlg = $('#customer-dialog');
      const c = getCustomer(dlg.dataset.customerId);
      if (c && confirm(`Delete "${c.name}"? Their jobs are kept — they just lose the customer link.`)) {
        state.jobs.forEach(j => { if (j.customerId === c.id) j.customerId = null; });
        state.customers = state.customers.filter(x => x.id !== c.id);
        logAudit('delete', 'customer', c.id, c.name);
        saveState();
        dlg.close();
        renderView();
        toast('Customer deleted');
      }
      break;
    }

    /* Schedule */
    case 'sched-prev':
      ui.schedMonth--;
      if (ui.schedMonth < 0) { ui.schedMonth = 11; ui.schedYear--; }
      renderSchedule();
      break;
    case 'sched-next':
      ui.schedMonth++;
      if (ui.schedMonth > 11) { ui.schedMonth = 0; ui.schedYear++; }
      renderSchedule();
      break;
    case 'sched-today':
      ui.schedYear = new Date().getFullYear();
      ui.schedMonth = new Date().getMonth();
      renderSchedule();
      break;

    /* Invoice */
    case 'jd-invoice': {
      /* Accountants can view the invoice without saving edits. */
      const job = canWrite() ? saveJobFromDialog() : state.jobs.find(j => j.id === dlgJobId);
      if (!canWrite()) $('#job-dialog').close();
      if (job) openInvoice(job.id);
      break;
    }
    case 'jd-changeorder': {
      const job = canWrite() ? saveJobFromDialog() : state.jobs.find(j => j.id === dlgJobId);
      if (!canWrite()) $('#job-dialog').close();
      if (job) openChangeOrder(job.id);
      break;
    }
    case 'invoice-close': closeInvoice(); break;
    case 'invoice-print': window.print(); break;

    case 'chart-metric':
      ui.chartMetric = el.dataset.metric;
      renderDashboard();
      break;

    /* Job dialog */
    case 'jd-close': $('#job-dialog').close(); break;
    case 'file-open':
      getFile(el.dataset.id).then(rec => {
        if (rec && rec.blob) window.open(URL.createObjectURL(rec.blob), '_blank');
        else if (rec) toast('This file is encrypted — unlock with the owner passcode to open it');
      });
      break;
    case 'file-download':
      getFile(el.dataset.id).then(rec => {
        if (!rec || !rec.blob) return;
        const url = URL.createObjectURL(rec.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = rec.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      });
      break;
    case 'file-delete':
      if (confirm('Delete this file? This can\'t be undone.')) {
        deleteFile(el.dataset.id).then(() => {
          logAudit('delete', 'file', el.dataset.id, '');
          saveState();
          renderJobFiles();
          const ad = $('#acct-dialog');
          if (ad.open && ad.dataset.id) renderOwnerFiles('bill:' + ad.dataset.id, '#ac-files');
        });
      }
      break;
    case 'jd-save': saveJobFromDialog(); break;
    case 'jd-delete': deleteJobFromDialog(); break;
    case 'jd-add-expense':
      $('#jd-expenses').insertAdjacentHTML('beforeend', expenseRowHtml());
      $('#jd-expenses .expense-row:last-child input').focus();
      break;
    case 'jd-remove-expense':
      el.closest('.expense-row').remove();
      jobDialogRecalc();
      break;
    case 'jd-add-labor':
      $('#jd-labor').insertAdjacentHTML('beforeend', laborRowHtml());
      $('#jd-labor .labor-row:last-child select').focus();
      break;
    case 'jd-remove-labor':
      el.closest('.labor-row').remove();
      jobDialogRecalc();
      break;
    case 'jd-add-extra':
      $('#jd-extras').insertAdjacentHTML('beforeend', jobExtraRowHtml());
      $('#jd-extras .expense-row:last-child input').focus();
      break;
    case 'jd-remove-extra':
      el.closest('.expense-row').remove();
      jobDialogRecalc();
      break;
    case 'jd-add-payment':
      $('#jd-payments').insertAdjacentHTML('beforeend', paymentRowHtml());
      $('#jd-payments .payment-row:last-child [data-pay="amount"]').focus();
      jobDialogRecalc();
      break;
    case 'jd-remove-payment':
      el.closest('.payment-row').remove();
      jobDialogRecalc();
      break;
    case 'jd-use-suggested': {
      const suggested = suggestedPrice($('#jd-service').value, num($('#jd-area').value), num($('#jd-layers').value) || 1);
      $('#jd-price').value = suggested ? String(Math.round(suggested * 100) / 100) : '';
      jobDialogRecalc();
      break;
    }

    /* Pricing sheet */
    case 'est-add-extra':
      $('#est-extras').insertAdjacentHTML('beforeend', extraRowHtml());
      $('#est-extras .expense-row:last-child input').focus();
      break;
    case 'est-remove-extra':
      el.closest('.expense-row').remove();
      estimateRecalc();
      break;
    case 'est-save': saveEstimate(); break;
    case 'est-to-job': {
      const est = readEstimateForm();
      if (!est.serviceId || est.area <= 0) { toast('Choose a service and enter the roof size first'); break; }
      if (!est.address) { toast('Enter the property address first'); break; }
      estimateToJob(est);
      break;
    }
    case 'est-saved-to-job': {
      const est = state.estimates.find(x => x.id === el.dataset.id);
      if (est) estimateToJob(est);
      break;
    }
    case 'est-delete': {
      const est = state.estimates.find(x => x.id === el.dataset.id);
      if (est && confirm(`Delete the estimate for "${est.address || 'this property'}"?`)) {
        state.estimates = state.estimates.filter(x => x.id !== el.dataset.id);
        saveState();
        renderPricing();
        toast('Estimate deleted');
      }
      break;
    }
    case 'est-print': window.print(); break;

    /* Settings */
    case 'logo-reset':
      state.settings.logoDataUrl = null;
      saveState();
      applyBrand();
      renderSettings();
      break;
    case 'sched-add':
      state.settings.paymentSchedule.push({ id: uid(), label: 'Progress Payment', pct: 0, due: '' });
      saveState();
      renderSettings();
      break;
    case 'sched-remove':
      if (confirm('Remove this payment milestone from the schedule?')) {
        state.settings.paymentSchedule = state.settings.paymentSchedule.filter(m => m.id !== el.dataset.id);
        saveState();
        renderSettings();
      }
      break;
    case 'svc-add':
      state.settings.services.push({ id: uid(), name: 'New Service', rate: 0 });
      saveState();
      renderSettings();
      break;
    case 'svc-delete': {
      const svc = getService(el.dataset.id);
      if (svc && confirm(`Remove "${svc.name}" from your rate card? Jobs already using it keep their prices.`)) {
        state.settings.services = state.settings.services.filter(s => s.id !== el.dataset.id);
        saveState();
        renderSettings();
      }
      break;
    }
    case 'export-json':
      exportBackup();
      break;
    case 'export-json-lite':
      downloadFile('roofing-tracker-backup-nofiles.json', JSON.stringify({ ...state, attachments: [] }, null, 2), 'application/json');
      toast('Backup downloaded (without attached files)');
      break;
    case 'wipe':
      if (confirm('Erase ALL jobs, estimates, attached files, and settings from this browser?') &&
          confirm('Last check — this cannot be undone. Erase everything?')) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(SEC_KEY);
        fileTx('readwrite', s => s.clear()).catch(() => {});
        session.dek = null; session.role = 'owner'; session.locked = false;
        clearTimeout(session.lockTimer);
        state = defaultState();
        applyRole();
        applyBrand();
        renderView();
        toast('All data erased');
      }
      break;
  }
});

let acctInputTimer = null;

document.addEventListener('input', e => {
  const t = e.target;
  if (t.matches('[data-field="job-search"]')) {
    ui.jobSearch = t.value;
    /* Re-render the table only, keeping focus in the search box. */
    const cursor = t.selectionStart;
    renderJobs();
    const search = $('[data-field="job-search"]');
    search.focus();
    search.setSelectionRange(cursor, cursor);
  } else if (t.matches('[data-field="customer-search"]')) {
    ui.customerSearch = t.value;
    const cursor = t.selectionStart;
    renderCustomers();
    const search = $('[data-field="customer-search"]');
    search.focus();
    search.setSelectionRange(cursor, cursor);
  } else if (t.closest('#view-pricing')) {
    estimateRecalc();
  } else if (t.matches('[data-field^="acct-"]') && t.tagName === 'INPUT') {
    /* Typed fields (period, statement balance, document search) re-render
       after a short pause and keep the cursor where it was. */
    clearTimeout(acctInputTimer);
    acctInputTimer = setTimeout(() => {
      if (!document.contains(t)) return;
      const field = t.dataset.field;
      const cursor = t.type === 'date' ? null : t.selectionStart;
      acctFieldChange(t);
      const again = $(`[data-field="${field}"]`);
      if (again && again !== t) {
        again.focus();
        if (cursor != null) { try { again.setSelectionRange(cursor, cursor); } catch (err) { /* number inputs */ } }
      }
    }, 350);
  } else if (t.closest('#acct-dialog') && t.matches('[data-je]')) {
    jeRecalc();
  } else if (t.matches('[data-setting]')) {
    handleSettingChange(t);
  } else if (t.matches('[data-svc]')) {
    handleServiceChange(t);
  } else if (t.matches('[data-sched]')) {
    handleScheduleChange(t);
  } else if (t.matches('[data-lab="hours"]')) {
    /* Hourly pay follows the hours as they're typed. */
    const row = t.closest('.labor-row');
    const emp = getEmployee($('[data-lab="employeeId"]', row).value);
    if (emp && emp.payType === 'hourly') {
      $('[data-lab="amount"]', row).value = num(t.value) > 0 ? (emp.rate * num(t.value)).toFixed(2) : '';
    }
    jobDialogRecalc();
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.matches('[data-exp="paid"]')) {
    jobDialogRecalc();
    return;
  }
  /* Accounting view fields, reconciliation, and bill attachments */
  if (t.matches('[data-field^="acct-"]') && t.dataset.field !== 'acct-docsearch') {
    acctFieldChange(t);
    return;
  }
  if (t.matches('[data-clear]')) {
    if (!canWrite()) { t.checked = !t.checked; toast('Read-only accountant access'); return; }
    if (t.checked) state.cleared[t.dataset.clear] = true; else delete state.cleared[t.dataset.clear];
    saveState();
    renderAccounting();
    return;
  }
  if (t.id === 'acct-stmt-file' && t.files[0]) {
    if (!canWrite()) { toast('Read-only accountant access'); t.value = ''; return; }
    const file = t.files[0];
    file.text().then(text => {
      const rows = parseBankCsv(text);
      if (!rows.length) { toast('No transactions found — the CSV needs Date, Description, and Amount columns'); return; }
      const a = acctUi();
      const matched = autoMatchStatement(a.regAcct, rows);
      a.imported = rows;
      logAudit('import', 'statement', a.regAcct, `${file.name} · ${rows.length} lines, ${matched} matched`);
      saveState();
      renderAccounting();
      toast(`${rows.length} statement lines imported · ${matched} matched automatically`);
    }).catch(() => toast('Could not read that file'));
    t.value = '';
    return;
  }
  if ((t.id === 'ac-file-input' || t.id === 'ac-photo-input') && t.files.length) {
    const dlg = $('#acct-dialog');
    const owner = 'bill:' + dlg.dataset.id;
    (async () => {
      let added = 0;
      for (const f of Array.from(t.files)) {
        if (f.size > 15 * 1024 * 1024) { toast(`"${f.name}" is over 15 MB — skipped`); continue; }
        try { await addJobFile(owner, f); added++; } catch (err) { toast('Could not save file in this browser'); return; }
      }
      if (added) { logAudit('attach', 'bill', dlg.dataset.id, added + ' file(s)'); saveState(); renderOwnerFiles(owner, '#ac-files'); toast(added === 1 ? 'File attached' : added + ' files attached'); }
    })();
    t.value = '';
    return;
  }
  if (t.closest('#acct-dialog') && t.matches('[data-je]')) { jeRecalc(); return; }
  if (t.matches('[data-setting]') && t.tagName === 'SELECT') { handleSettingChange(t); return; }
  if (t.matches('[data-lab="employeeId"]')) {
    /* Picking a crew member sets up their pay: hourly enables the hours
       field; per-job fills their flat rate in as the amount. */
    const row = t.closest('.labor-row');
    const emp = getEmployee(t.value);
    const hoursEl = $('[data-lab="hours"]', row);
    const amountEl = $('[data-lab="amount"]', row);
    if (emp && emp.payType === 'hourly') {
      hoursEl.disabled = false;
      amountEl.value = num(hoursEl.value) > 0 ? (emp.rate * num(hoursEl.value)).toFixed(2) : '';
      hoursEl.focus();
    } else if (emp) {
      hoursEl.disabled = true;
      hoursEl.value = '';
      amountEl.value = String(emp.rate);
    } else {
      hoursEl.disabled = true;
    }
    jobDialogRecalc();
    return;
  }
  if (t.matches('[data-field="pay-from"]') || t.matches('[data-field="pay-to"]')) {
    if (t.dataset.field === 'pay-from') ui.payFrom = t.value; else ui.payTo = t.value;
    renderEmployees();
    return;
  }
  if (t.matches('[data-field="job-status"]')) {
    ui.jobStatus = t.value;
    renderJobs();
  } else if (t.matches('[data-field="chart-year"]')) {
    ui.chartYear = Number(t.value);
    renderDashboard();
  } else if (t.id === 'logo-file' && t.files[0]) {
    loadLogo(t.files[0]);
  } else if (t.id === 'import-file' && t.files[0]) {
    importJson(t.files[0]);
    t.value = '';
  } else if ((t.id === 'jd-file-input' || t.id === 'jd-photo-input') && t.files.length) {
    attachFiles(Array.from(t.files));
    t.value = '';
  } else if (t.id === 'jd-client') {
    /* Picking a known customer auto-fills their contact info if empty. */
    const c = state.customers.find(x => x.name.toLowerCase() === t.value.trim().toLowerCase());
    const phone = $('#jd-phone');
    const email = $('#jd-email');
    if (c && c.phone && phone && !phone.value.trim()) phone.value = c.phone;
    if (c && c.email && email && !email.value.trim()) email.value = c.email;
  }
});

/* ---------- Init ---------- */

/* Files attach immediately; if a brand-new job is canceled, remove them. */
$('#job-dialog').addEventListener('close', () => {
  if (dlgIsNew && !dlgSaved && dlgJobId) deleteJobFiles(dlgJobId).catch(() => {});
});

/* Close the invoice view with Escape. */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.body.classList.contains('invoice-open')) closeInvoice();
});

/* Passcode lock screen + idle auto-lock. */
document.addEventListener('submit', e => {
  if (e.target.id === 'lock-form') { e.preventDefault(); handleUnlockSubmit(); }
});
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, touchActivity, { passive: true }));

/* Offline/installable app support (service workers need http(s), not file://). */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

applyBrand();
if (session.locked) {
  showLockScreen();
} else {
  applyRole();
  touchActivity();
  renderView();
}
