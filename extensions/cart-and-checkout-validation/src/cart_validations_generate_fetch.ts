import type { CartValidationsGenerateRunInput, CartValidationsGenerateFetchResult } from "../generated/api";

// Returns a request for Shopify to call our proxy to get inventory availability map
export function cartValidationsGenerateFetch(input: CartValidationsGenerateRunInput): CartValidationsGenerateFetchResult {
  // Build a minimal payload of variant IDs & SKUs present in the cart
  const lines = input.cart.lines.map((l: any) => ({
    id: l.merchandise?.id,
    sku: l.merchandise?.sku,
    qty: l.quantity,
  }));

  return {
    request: {
      url: "shopify:appProxy/apps/bbg/base-stock-bulk",
      method: "POST",
      policy: { readTimeoutMs: 2000 },
      headers: [{ name: "Content-Type", value: "application/json" }],
      jsonBody: { lines },
    },
  };
}


