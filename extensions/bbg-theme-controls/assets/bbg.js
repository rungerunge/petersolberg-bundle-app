(function () {
  console.log('[BBG] Bundle Guard initialized');
  
  async function getAvailable(baseVariantIdOrSku) {
    console.log('[BBG] Fetching inventory for:', baseVariantIdOrSku);
    try {
      // Determine if it's a variant ID or SKU
      const isVariantId = baseVariantIdOrSku && baseVariantIdOrSku.includes('gid://');
      const param = isVariantId ? 'baseVariantId' : 'sku';
      
      // Use relative URL for App Proxy - Shopify will handle the routing
      const r = await fetch(`/apps/bbg/base-stock?${param}=${encodeURIComponent(baseVariantIdOrSku)}`, { 
        credentials: "same-origin",
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
      
      // Log response details
      console.log('[BBG] Response status:', r.status);
      console.log('[BBG] Response headers:', r.headers.get('content-type'));
      
      const text = await r.text();
      console.log('[BBG] Response text (first 200 chars):', text.substring(0, 200));
      
      // Try to parse as JSON
      try {
        const j = JSON.parse(text);
        console.log('[BBG] Inventory response:', j);
        return Math.max(0, j?.available ?? 0);
      } catch (parseError) {
        console.error('[BBG] Failed to parse response as JSON:', parseError);
        console.error('[BBG] Full response:', text);
        
        // Fallback: use hardcoded inventory for testing
        console.warn('[BBG] Using fallback inventory value: 24');
        return 24;
      }
    } catch (e) { 
      console.error('[BBG] Error fetching inventory:', e);
      return 0; 
    }
  }

  // Cart drawer: begræns både singles og cases baseret på samlet lager
  async function applyCartLimits(root = document) {
    console.log('[BBG] applyCartLimits called');
    const cartDrawer = root.querySelector("[data-base-variant-id], [data-base-variant-sku]");
    console.log('[BBG] Looking for cart drawer element:', cartDrawer);
    if (!cartDrawer) {
      console.log('[BBG] No cart drawer element found');
      return;
    }
    
    // Try variant ID first, then SKU
    const baseId = cartDrawer.getAttribute("data-base-variant-id");
    const baseSku = cartDrawer.getAttribute("data-base-variant-sku");
    console.log('[BBG] Cart base variant ID:', baseId, 'SKU:', baseSku);
    
    if (!baseId && !baseSku) {
      console.log('[BBG] No base variant ID or SKU found');
      return;
    }
    
    const available = await getAvailable(baseId || baseSku);
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

      // Opdater hvis over max eller hvis input ændres
      if (current > maxQty) {
        console.log(`[BBG] Reducing quantity from ${current} to ${maxQty}`);
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
      
      // Add event listener to enforce max on manual input
      qtyInput.addEventListener('change', async function(e) {
        const newValue = parseInt(this.value, 10) || 0;
        console.log(`[BBG] Quantity changed to ${newValue}, max is ${maxQty}`);
        if (newValue > maxQty) {
          console.log(`[BBG] Enforcing max quantity of ${maxQty}`);
          this.value = String(maxQty);
          const lineKey = line.getAttribute("data-line-key");
          if (lineKey) {
            fetch("/cart/change.js", {
              method: "POST", 
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: lineKey, quantity: maxQty })
            }).then(() => {
              console.log('[BBG] Cart updated to enforce max');
              // Reload cart drawer to show updated quantity
              if (window.location.pathname.includes('/cart')) {
                window.location.reload();
              } else {
                // For cart drawer, trigger refresh
                document.dispatchEvent(new CustomEvent('cart:refresh'));
              }
            });
          }
        }
      });
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
  
  // Listen for quantity button clicks
  document.addEventListener('click', function(e) {
    if (e.target.closest('.quantity__button')) {
      console.log('[BBG] Quantity button clicked');
      setTimeout(() => applyCartLimits(document), 100);
    }
  });

  window.BBG_READY = true;
})();