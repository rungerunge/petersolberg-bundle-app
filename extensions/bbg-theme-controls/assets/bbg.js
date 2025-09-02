(function () {
  async function getAvailable(baseVariantId) {
    try {
      const r = await fetch(`/apps/bbg/base-stock?baseVariantId=${encodeURIComponent(baseVariantId)}`, { credentials: "same-origin" });
      const j = await r.json();
      return Math.max(0, j?.available ?? 0);
    } catch { return 0; }
  }

  // Cart drawer: begræns både singles og cases baseret på samlet lager
  async function applyCartLimits(root = document) {
    const baseIdEl = root.querySelector("[data-base-variant-id]");
    if (!baseIdEl) return;
    const baseId = baseIdEl.getAttribute("data-base-variant-id");
    const available = await getAvailable(baseId);

    const lines = Array.from(root.querySelectorAll("[data-bbg-line]"));
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
    const baseIdEl = root.querySelector("[data-base-variant-id]");
    const caseQty = root.querySelector("[data-bbg-case-qty]");
    const caseBtn = root.querySelector("[data-bbg-case-add]");
    const singleQty = root.querySelector("[data-bbg-single-qty]");
    const singleBtn = root.querySelector("[data-bbg-single-add]");
    const msg = root.querySelector("[data-bbg-msg]");
    if (!baseIdEl) return;

    const baseId = baseIdEl.getAttribute("data-base-variant-id");
    const available = await getAvailable(baseId);

    function setMsg(t){ if (msg) { msg.textContent = t || ""; msg.style.display = t ? "block" : "none"; } }

    if (available <= 0) {
      caseBtn && (caseBtn.disabled = true);
      singleBtn && (singleBtn.disabled = true);
      setMsg("Out of stock");
      return;
    }
    
    // Singles: max = available
    if (singleQty) singleQty.setAttribute("max", String(available));
    
    if (available < 12) {
      caseBtn && (caseBtn.disabled = true);
      setMsg(`Only ${available} singles available – not enough for a full case.`);
      return;
    }
    
    // Cases: max = floor(available / 12)
    const maxCases = Math.floor(available / 12);
    if (caseQty) caseQty.setAttribute("max", String(maxCases));
    setMsg("");
  }

  document.addEventListener("DOMContentLoaded", () => {
    applyPdpLimits(document);
    applyCartLimits(document);
  });
  
  document.addEventListener("shopify:section:load", (e) => {
    applyPdpLimits(e.target);
    applyCartLimits(e.target);
  });

  // Re-apply on cart updates
  document.addEventListener("bbg:cart-updated", () => {
    applyCartLimits(document);
  });

  window.BBG_READY = true;
})();