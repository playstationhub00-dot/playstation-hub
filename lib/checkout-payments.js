// Methods the checkout popup can show. A method is included only when Admin
// has it enabled with a number or QR, or the matching PAYMENT_* env has a
// number or QR. Nothing configured means an empty list: the popup offers
// Messenger only and never shows an example account.
const KEYS = [
  { key: 'gcash', label: 'GCash', hint: 'Local · instant' },
  { key: 'maya', label: 'Maya', hint: 'Local · instant' },
  { key: 'qrph', label: 'QR Ph', hint: 'Scan with any QR Ph app' },
  { key: 'paypal', label: 'PayPal', hint: 'International customers' },
  { key: 'bank', label: 'Bank transfer', hint: 'Local banks' }
];

function envDetails(key) {
  const up = key.toUpperCase();
  return {
    account_name: process.env['PAYMENT_' + up + '_NAME'] || '',
    account_number: process.env['PAYMENT_' + up + '_NUMBER'] || '',
    qr_image: process.env['PAYMENT_' + up + '_QR'] || ''
  };
}

function publicMethods(settings) {
  const stored = (settings && settings.payment_methods) || [];
  const out = [];
  KEYS.forEach(meta => {
    const row = stored.find(m => m && m.key === meta.key) || null;
    const fromEnv = envDetails(meta.key);
    const enabledReal = !!(row && row.enabled && (row.account_number || row.qr_image));
    const envReal = !!(fromEnv.account_number || fromEnv.qr_image);
    if (!enabledReal && !envReal) return;
    const useAdmin = enabledReal;
    out.push({
      key: meta.key,
      label: (row && row.label) || meta.label,
      hint: meta.hint,
      account_name: useAdmin ? (row.account_name || '') : fromEnv.account_name,
      account_number: useAdmin ? (row.account_number || '') : fromEnv.account_number,
      qr_image: useAdmin ? (row.qr_image || '') : fromEnv.qr_image,
      example: false
    });
  });
  return out;
}

module.exports = { KEYS, publicMethods };
