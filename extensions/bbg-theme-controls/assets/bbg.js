(function () {
  console.log('[BBG] Bundle Guard initialized');
  
  async function getAvailable(baseVariantId) {
    console.log('[BBG] Fetching inventory for:', baseVariantId);
    try {
      // Use relative URL for App Proxy - Shopify will handle the routing
      const r = await fetch(`/apps/bbg/base-stock?baseVariantId=${encodeURIComponent(baseVariantId)}`, { 
        credentials: "same-origin",
        headers: {
          'Content-Type': 'application/json',
        }
      });
      const j = await r.json();
      console.log('[BBG] Inventory response:', j);
      return Math.max(0, j?.available ?? 0);
    } catch (e) { 
      console.error('[BBG] Error fetching inventory:', e);
      return 0; 
    }
  }

  // Cart drawer: begræns både singles og cases baseret på samlet lager
  async function applyCartLimits(root = document) {
    console.log('[BBG] applyCartLimits called');
    const baseIdEl = root.querySelector("[data-base-variant-id]");
    console.log('[BBG] Looking for base variant element:', baseIdEl);
    if (!baseIdEl) {
      console.log('[BBG] No base variant element found in cart');
      return;
    }
    const baseId = baseIdEl.getAttribute("data-base-variant-id");
    console.log('[BBG] Cart base variant ID:', baseId);
    const available = await getAvailable(baseId);
    console.log('[BBG] Available inventory in cart:', available);

    const lines = Array.from(root.querySelectorAll("[data-bbg-line]"));
    console.log('[BBG] Found cart lines:', lines.length);
    const parseQty = (el) => parseInt(el?.value || "0", 10) || 0;

    // Beregn samlet efterspørgsel
    let demand = 0;
    lines.forEach((line) => {
      const mult = parseInt(line.getAttribute("data-multiplier") || "1", 10) || 1;
      const qty = parseQty(line.querySelector("[data-bbg-qty]"));
      demand += qty * mult;
    });

    // For hver linje: sæt max baseret på hvad der er tilbage
    lines.forEach((line) => {
      const mult = parseInt(line.getAttribute("data-multiplier") || "1", 10) || 1;
      const qtyInput = line.querySelector("[data-bbg-qty]");
      if (!qtyInput) return;

      const current = parseQty(qtyInput);
      const others = demand - (current * mult);
      const rest = Math.max(0, available - others);

      const maxQty = mult === 1 ? rest : Math.floor(rest / mult);
      qtyInput.setAttribute("max", String(maxQty));

      // Opdater hvis over max
      if (current > maxQty) {
        qtyInput.value = String(maxQty);
        const lineKey = line.getAttribute("data-line-key");
        if (lineKey) {
          fetch("/cart/change.js", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: lineKey, quantity: maxQty })
          }).then(() => document.dispatchEvent(new Event("bbg:cart-updated")));
        }
      }
    });
  }

  // PDP: begræns både singles og cases
  async function applyPdpLimits(root = document) {
    console.log('[BBG] Applying PDP limits');
    const baseIdEl = root.querySelector("[data-base-variant-id]");
    const caseQty = root.querySelector("[data-bbg-case-qty]");
    const caseBtn = root.querySelector("[data-bbg-case-add]");
    const singleQty = root.querySelector("[data-bbg-single-qty]");
    const singleBtn = root.querySelector("[data-bbg-single-add]");
    const msg = root.querySelector("[data-bbg-msg]");
    
    console.log('[BBG] Found elements:', {
      baseIdEl: !!baseIdEl,
      caseQty: !!caseQty,
      caseBtn: !!caseBtn,
      singleQty: !!singleQty,
      singleBtn: !!singleBtn,
      msg: !!msg
    });
    
    if (!baseIdEl) {
      console.log('[BBG] No base variant ID element found');
      return;
    }

    const baseId = baseIdEl.getAttribute("data-base-variant-id");
    console.log('[BBG] Base variant ID:', baseId);
    const available = await getAvailable(baseId);
    console.log('[BBG] Available inventory:', available);

    function setMsg(t){ if (msg) { msg.textContent = t || ""; msg.style.display = t ? "block" : "none"; } }

    if (available <= 0) {
      console.log('[BBG] Out of stock - disabling buttons');
      caseBtn && (caseBtn.disabled = true);
      singleBtn && (singleBtn.disabled = true);
      setMsg("Out of stock");
      return;
    }
    
    // Singles: max = available
    if (singleQty) singleQty.setAttribute("max", String(available));
    console.log('[BBG] Set singles max to:', available);
    
    if (available < 12) {
      console.log('[BBG] Not enough for case - disabling case button');
      caseBtn && (caseBtn.disabled = true);
      setMsg(`Only ${available} singles available – not enough for a full case.`);
      return;
    }
    
    // Cases: max = floor(available / 12)
    const maxCases = Math.floor(available / 12);
    console.log('[BBG] Max cases allowed:', maxCases);
    if (caseQty) caseQty.setAttribute("max", String(maxCases));
    setMsg("");
  }

  // Initialize on different events to ensure we catch everything
  function init() {
    console.log('[BBG] Initializing Bundle Guard');
    applyPdpLimits(document);
    applyCartLimits(document);
  }

  // DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  
  // Shopify theme events
  document.addEventListener("shopify:section:load", (e) => {
    console.log('[BBG] Section loaded');
    applyPdpLimits(e.target);
    applyCartLimits(e.target);
  });
  
  // Cart drawer events
  document.addEventListener("cart:refresh", () => {
    console.log('[BBG] Cart refreshed');
    setTimeout(() => applyCartLimits(document), 100);
  });
  
  document.addEventListener("cart-drawer:open", () => {
    console.log('[BBG] Cart drawer opened');
    setTimeout(() => applyCartLimits(document), 100);
  });

  // Re-apply on cart updates
  document.addEventListener("bbg:cart-updated", () => {
    applyCartLimits(document);
  });
  
  // Also check periodically for dynamic content
  let checkInterval = setInterval(() => {
    const cartDrawer = document.querySelector('[id*="CartDrawer"]');
    if (cartDrawer) {
      console.log('[BBG] Found cart drawer, applying limits');
      applyCartLimits(document);
      clearInterval(checkInterval); // Stop once we've found and processed it
    }
  }, 500);
  
  // Stop checking after 10 seconds
  setTimeout(() => clearInterval(checkInterval), 10000);

  window.BBG_READY = true;
})();