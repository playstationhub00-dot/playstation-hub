// Methods the checkout popup can show. Real details come from Admin →
// Payment methods when that method is enabled. Anything missing falls back
// to PAYMENT_* env vars, and if those are empty too the row is marked
// example so it is obvious it is not a live account.
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
  return KEYS.map(meta => {
    const row = stored.find(m => m && m.key === meta.key) || null;
    const fromEnv = envDetails(meta.key);
    const enabledReal = !!(row && row.enabled && (row.account_number || row.qr_image));
    const name = enabledReal ? (row.account_name || '') : (fromEnv.account_name || (enabledReal ? '' : 'Example account'));
    const number = enabledReal ? (row.account_number || '') : (fromEnv.account_number || '');
    const qr = enabledReal ? (row.qr_image || '') : (fromEnv.qr_image || '');
    const example = !enabledReal;
    return {
      key: meta.key,
      label: (row && row.label) || meta.label,
      hint: meta.hint,
      account_name: name,
      account_number: number || (example ? 'Set PAYMENT_' + meta.key.toUpperCase() + '_NUMBER' : ''),
      qr_image: qr,
      example
    };
  });
}

module.exports = { KEYS, publicMethods };
