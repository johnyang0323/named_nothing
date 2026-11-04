const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for safe interpolation into HTML templates. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

class SafeHtml {
  constructor(markup) {
    this.markup = markup;
  }

  toString() {
    return this.markup;
  }
}

/** Mark trusted markup so html`` inserts it unescaped. */
export function raw(markup) {
  return new SafeHtml(markup);
}

function toMarkup(value) {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return value.map(toMarkup).join('');
  if (value instanceof SafeHtml) return value.markup;
  return escapeHtml(value);
}

/**
 * Tagged template: interpolated values are escaped unless they are the
 * result of another html`` / raw() call. Arrays are joined.
 */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((str, i) => {
    out += str;
    if (i < values.length) out += toMarkup(values[i]);
  });
  return new SafeHtml(out);
}
