'use strict';

/* ============================================================
   Event wiring
   ============================================================ */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

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
      const job = saveJobFromDialog();
      if (job) openInvoice(job.id);
      break;
    }
    case 'jd-changeorder': {
      const job = saveJobFromDialog();
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
        if (rec) window.open(URL.createObjectURL(rec.blob), '_blank');
      });
      break;
    case 'file-download':
      getFile(el.dataset.id).then(rec => {
        if (!rec) return;
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
        deleteFile(el.dataset.id).then(renderJobFiles);
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
        fileTx('readwrite', s => s.clear()).catch(() => {});
        state = defaultState();
        applyBrand();
        renderView();
        toast('All data erased');
      }
      break;
  }
});

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

/* Offline/installable app support (service workers need http(s), not file://). */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

applyBrand();
renderView();
