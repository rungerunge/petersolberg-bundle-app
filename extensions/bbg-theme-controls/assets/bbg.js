(function() {
  async function getAvailable(baseVariantId) {
    try {
      const res = await fetch(`/apps/bbg/base-stock?baseVariantId=${encodeURIComponent(baseVariantId)}`, { credentials: 'same-origin' });
      const data = await res.json();
      return Math.max(0, data?.available ?? 0);
    } catch(e) { return 0; }
  }

  function setMsg(root, text){
    const el = root.querySelector('[data-bbg-msg]');
    if (!el) return;
    el.textContent = text || '';
    el.style.display = text ? 'block' : 'none';
  }

  async function applyPdpRules() {
    const root = document.querySelector('[data-bbg-root]') || document;
    const baseIdEl = root.querySelector('[data-base-variant-id]');
    if (!baseIdEl) return;
    const baseVariantId = baseIdEl.getAttribute('data-base-variant-id');
    if (!baseVariantId) return;
    const available = await getAvailable(baseVariantId);

    const caseQtyInput = root.querySelector('[data-bbg-case-qty]');
    const caseAddBtn   = root.querySelector('[data-bbg-case-add]');
    const singleAddBtn = root.querySelector('[data-bbg-single-add]');

    if (available <= 0) {
      if (caseAddBtn)   { caseAddBtn.disabled = true; caseAddBtn.setAttribute('aria-disabled', 'true'); }
      if (singleAddBtn) { singleAddBtn.disabled = true; singleAddBtn.setAttribute('aria-disabled', 'true'); }
      setMsg(root, 'Out of stock');
      return;
    }

    if (available < 12) {
      if (caseAddBtn)   { caseAddBtn.disabled = true; caseAddBtn.setAttribute('aria-disabled', 'true'); }
      setMsg(root, `Only ${available} singles available – not enough for a full case.`);
      return;
    }

    const maxCases = Math.floor(available / 12);
    if (caseQtyInput) {
      caseQtyInput.setAttribute('max', String(maxCases));
      const cur = parseInt(caseQtyInput.value || '1', 10);
      if (cur > maxCases) caseQtyInput.value = String(maxCases);
    }
    setMsg(root, '');
  }

  async function applyCartRules() {
    // Placeholder: depends on theme cart DOM. Implement similarly to applyPdpRules
  }

  document.addEventListener('DOMContentLoaded', applyPdpRules);
  document.addEventListener('shopify:section:load', applyPdpRules);
  window.BBG_READY = true;
})();


