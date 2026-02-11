(() => {
  // Importante para GitHub Pages: o site pode estar em um subpath (/repo/).
  // Usar URL relativa ao documento evita 404 ao buscar o sprite.
  const SPRITE_URL = new URL('assets/icons.svg', document.baseURI).toString();
  const SPRITE_ID = 'cf-icons-sprite';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';

  function getUseHref(useEl) {
    return (
      useEl.getAttribute('href') ||
      useEl.getAttribute('xlink:href') ||
      useEl.getAttributeNS(XLINK_NS, 'href')
    );
  }

  function setUseHref(useEl, value) {
    useEl.setAttribute('href', value);
    useEl.setAttribute('xlink:href', value);
    try {
      useEl.setAttributeNS(XLINK_NS, 'xlink:href', value);
    } catch {}
  }

  function extractSymbolId(href) {
    const str = String(href || '');
    const hashIndex = str.lastIndexOf('#');
    if (hashIndex === -1) return null;
    const id = str.slice(hashIndex + 1).trim();
    return id ? id : null;
  }

  function normalizeUseHref(useEl) {
    const href = getUseHref(useEl);
    if (!href) return;

    // Já interno
    if (String(href).trim().startsWith('#')) {
      const id = extractSymbolId(href);
      if (id) setUseHref(useEl, `#${id}`);
      return;
    }

    // Externo (relativo ou absoluto)
    if (!String(href).includes('icons.svg#') && !String(href).includes('/assets/icons.svg#')) return;
    const id = extractSymbolId(href);
    if (!id) return;
    setUseHref(useEl, `#${id}`);
  }

  function normalizeAll(root = document) {
    if (!root.querySelectorAll) return;
    root
      .querySelectorAll(
        'use[href], use[xlink\\:href]'
      )
      .forEach(normalizeUseHref);
  }

  async function ensureSpriteInjected() {
    if (document.getElementById(SPRITE_ID)) return;

    try {
      const res = await fetch(SPRITE_URL, { credentials: 'same-origin' });
      if (!res.ok) return;

      const text = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'image/svg+xml');
      const symbols = Array.from(doc.querySelectorAll('symbol'));
      if (!symbols.length) return;

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = SPRITE_ID;
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');

      for (const symbol of symbols) {
        svg.appendChild(symbol.cloneNode(true));
      }

      (document.body || document.documentElement).prepend(svg);
    } catch {
      // Silencioso: se falhar, o site segue funcionando sem ícones.
    }
  }

  function startObserver() {
    if (!('MutationObserver' in window)) return;

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.target && m.target.tagName === 'use') {
          normalizeUseHref(m.target);
          continue;
        }

        if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node && node.nodeType === Node.ELEMENT_NODE) {
              normalizeAll(node);
            }
          }
        }
      }
    });

    obs.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['href', 'xlink:href'],
    });
  }

  async function init() {
    startObserver();
    normalizeAll();
    await ensureSpriteInjected();
    normalizeAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    void init();
  }
})();
