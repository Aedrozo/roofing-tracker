# Next Gen Premier Roofing Contractor — Job Tracker

A job tracking and pricing app built for a roofing business. It runs entirely in the
browser — no installation, no server, no account. All data is saved privately on the
device it's used on.

## How to use it

Open `index.html` in any modern browser (Chrome, Edge, Safari, Firefox). That's it.

> Tip: bookmark it, or on a phone/tablet use "Add to Home Screen" so it opens like an app.

## What it does

### Dashboard
- **This Month / This Quarter / This Year / All Time** profit tiles, each with the
  revenue and expense totals behind the number.
- A monthly bar chart (switchable between Revenue, Expenses, and Profit) with hover
  breakdowns, a year selector, and a table view of the exact figures.
- Earnings are counted from jobs marked **Completed** or **Paid**, on their
  completion date.

### Jobs
- One record per job: **property address**, client, phone, service type, roof size,
  contract price, status, project manager, dates, and notes.
- **Address autocomplete**: start typing an address (on a job or an estimate) and
  worldwide suggestions appear — click one and the full address fills in.
  Powered by OpenStreetMap's free Photon geocoder; needs internet, and when
  offline the field simply works as a normal text box.
- **Expense line items** per job — materials, labor, permits, dump fees, equipment,
  subcontractors, fuel, or anything else.
- Every job automatically shows its **suggested price** (rate × roof size),
  **total expenses**, **profit**, and **margin %**.
- **Invoices & documents** — attach supplier invoices, receipts, signed contracts,
  or photos to any job (up to 15 MB per file). Files are stored in the browser,
  viewable and downloadable any time, and the jobs list shows a 📎 count so you can
  see which jobs have paperwork. Deleting a job deletes its files.
- Search by address, client, or service; filter by status; export everything to CSV
  for a spreadsheet.

### Payments & invoicing
- Record **deposits and payments** on every job (date, amount, method, note) — the
  balance due updates everywhere: the job, the jobs table, and the dashboard.
- The dashboard shows a **"Money owed to you"** card listing finished jobs that
  aren't fully paid, with an **OVERDUE** flag once a balance is 30+ days past the
  completion date.
- **One-click customer invoices**: the 🧾 Invoice button on any job builds a
  branded, print-ready invoice (logo, license #, line item, payments applied,
  balance due) with automatic invoice numbering. Print it or save as PDF.
  Company contact details and the invoice footer text are set in Settings.

### Employees & crew labor
- Add your crew on the **Employees** page with a **position** (Project Manager,
  Owner, Foreman, Roofer, Painter, and more — or type your own) and either
  **hourly pay** or a flat **per-job rate**.
- On any job, add the crew who worked it: hourly pay is calculated from hours ×
  their rate, per-job pay fills in automatically (and stays adjustable per job).
- Crew pay is **deducted from that job's profit** and rolls into all dashboard
  totals. The Employees page shows each person's jobs worked and total pay.
- Assign a **project manager** to each job — shown on the jobs list and in the
  CSV export.
- Each expense has a **Paid checkbox**, and the job summary flags how much of
  its expenses are still unpaid.

### Customers
- Every client you name on a job automatically becomes a **customer record** with
  their full job history, total revenue, and open balances.
- Add/edit customers directly, search by name/phone/email, and get phone
  auto-filled when you pick a known customer on a new job.

### Schedule
- A **monthly calendar** showing jobs on their start dates — click a job to open
  it. A "Not scheduled yet" list surfaces active jobs with no start date.

### Pricing Sheet
- Enter the property details (address, owner, stories, service, roof size, extras)
  and the suggested price is calculated live from the rate card.
- Save estimates for later, print them, or convert a won estimate into a job with
  one click.

### Settings
- **Branding** — the NextGen shield logo ships as the default (`assets/logo.png`) and
  the color scheme is built around its royal blue. The company name, tagline, and
  logo can all be changed; an uploaded logo is stored in the browser.
- **Pricing rates** — every service rate is editable, and services can be added or
  removed. Changing a rate never touches prices already saved on jobs.
- **Data** — download a JSON backup (attached files included), restore from a
  backup, export jobs as CSV.

## Default rate card

All rates are **per square** (1 roofing square = 100 sq ft). Enter roof sizes in
squares — e.g. a 2,000 sq ft roof is 20 squares.

| Service | Rate per square |
|---|---|
| Shingling | $650 |
| Flat Roofing | $650 |
| Tile Relay | $650 |
| New Tile — Concrete | $1,050 |
| New Tile — Clay | $975 |
| Sheathing | $225 |
| Solar Compound | $650 |

The measurement unit label can be changed in Settings if you ever price a
different way.

## Important: where your data lives

Data is stored in the browser's local storage on the device you use. It is private,
but it means:

- Use the **same browser on the same device** to see your jobs.
- **Download a backup** from Settings regularly, and before clearing browser data
  or switching computers. Restoring the backup on another device moves everything.

## Installing on a phone

The app is a PWA (manifest + service worker + icons included). When it's served
over the web — any static host works, e.g. GitHub Pages — you can open it on a
phone and use "Add to Home Screen" to install it like a native app, complete with
offline support. (Opening the files directly with `file://` still works fully;
only the install/offline part needs real hosting.)

## Tech notes

Plain HTML/CSS/JavaScript with zero dependencies — `index.html`, `css/styles.css`,
`js/app.js`, `sw.js`, `manifest.webmanifest`. Works from a `file://` URL or any
static host. Light and dark mode follow the system preference.
