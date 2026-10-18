// Contoso Treasury's illustrative ledger — the same eight sample payment runs the Azure media
// service serves (PaymentService.cs). Demo data: nothing here moves money.
export const LEDGER = [
  ['PR-40192', 'Northwind Logistics Ltd', 812400, 'Awaiting approval', 'Supplier payment', '2026-09-21', 'United Kingdom'],
  ['PR-40191', 'Fabrikam Industrial', 1204000, 'Awaiting approval', 'Supplier payment', '2026-09-21', 'Germany'],
  ['PR-40188', 'Tailwind Freight', 465500, 'Awaiting approval', 'Logistics', '2026-09-22', 'Netherlands'],
  ['PR-40184', 'Contoso Payroll', 1940220, 'Released', 'Payroll', '2026-09-18', 'United Kingdom'],
  ['PR-40182', 'Adventure Works', 328600, 'Scheduled', 'Supplier payment', '2026-09-23', 'United States'],
  ['PR-40179', 'Woodgrove Services', 176800, 'Scheduled', 'Professional services', '2026-09-24', 'United Kingdom'],
  ['PR-40175', 'Litware Systems', 284000, 'Released', 'Technology', '2026-09-17', 'Singapore'],
  ['PR-40171', 'Alpine Ski House', 96500, 'Released', 'Supplier payment', '2026-09-16', 'Switzerland'],
].map(([reference, beneficiary, amount, status, category, date, country]) => ({
  reference, beneficiary, amount, status, category, date, country,
}));
