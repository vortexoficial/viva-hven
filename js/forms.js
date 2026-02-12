// Viva Haven — Form helpers (validação/masks/normalização)

export function cleanString(value) {
  return String(value || '').trim();
}

export function digitsOnly(value) {
  return cleanString(value).replace(/\D+/g, '');
}

export function normalizeEmail(value) {
  const v = cleanString(value).toLowerCase();
  return v || '';
}

export function normalizeCpf(value) {
  const d = digitsOnly(value);
  if (!d) return '';
  if (d.length !== 11) return d;
  return d;
}

export function required(value, message) {
  const v = cleanString(value);
  if (!v) return message || 'Campo obrigatório.';
  return '';
}

export function minLength(value, n, message) {
  const v = cleanString(value);
  if (v.length < n) return message || `Mínimo de ${n} caracteres.`;
  return '';
}

export function isEmail(value, message) {
  const v = normalizeEmail(value);
  if (!v) return '';
  // Validação simples (MVP)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return message || 'E-mail inválido.';
  return '';
}

export function applyMaskCpf(inputEl) {
  if (!inputEl) return;
  inputEl.addEventListener('input', () => {
    const d = digitsOnly(inputEl.value).slice(0, 11);
    const parts = [];
    parts.push(d.slice(0, 3));
    if (d.length > 3) parts.push(d.slice(3, 6));
    if (d.length > 6) parts.push(d.slice(6, 9));
    let out = parts.filter(Boolean).join('.');
    if (d.length > 9) out += '-' + d.slice(9, 11);
    inputEl.value = out;
  });
}

export function normalizeUrl(value) {
  const v = cleanString(value);
  if (!v) return '';
  try {
    // Aceita http/https (recomendado). Outros esquemas podem ser bloqueados depois.
    const u = new URL(v);
    return u.href;
  } catch (e) {
    return v;
  }
}

export function validateFields(rules) {
  // rules: [{ el, getValue, validators:[fn...] }]
  const errors = [];

  (rules || []).forEach((r) => {
    const el = r && r.el ? r.el : null;
    const getValue = r && typeof r.getValue === 'function' ? r.getValue : () => (el ? el.value : '');
    const validators = Array.isArray(r.validators) ? r.validators : [];

    const value = getValue();
    for (const v of validators) {
      const msg = v(value);
      if (msg) {
        errors.push({ el, message: msg });
        break;
      }
    }
  });

  return errors;
}
