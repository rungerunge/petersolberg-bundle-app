import type {
  CartValidationsGenerateRunInput,
  CartValidationsGenerateRunResult,
  ValidationError,
} from "../generated/api";

/**
 * Business rule: Prevent oversell when product has Single (1X) and Case (12X) variants.
 * Only the base single variant tracks inventory; case multiplies demand by 12.
 *
 * Mapping strategy:
 * - Prefer explicit JSON mapping stored in shop metafield namespace "bbg", key "settings" with shape:
 *   { "caseVariantId": { "base": "gid://shopify/ProductVariant/...", "multiplier": 12 }, ... }
 * - Fallback to SKU regex (default ^(.+?)-(\d{1,3})X$) to derive base SKU and multiplier.
 */
export function cartValidationsGenerateRun(
  input: CartValidationsGenerateRunInput
): CartValidationsGenerateRunResult {
  const errors: ValidationError[] = [];

  // Settings could be injected via future fetch target; default sensible values for now
  let settings: {
    skuRegex?: string;
    enableSkuFallback?: boolean;
    mappings?: Record<string, { base: string; multiplier: number }>;
    baseVariantInventories?: Record<string, number>;
  } = {};

  const skuRegex = new RegExp(settings.skuRegex || "^(.+?)-(\\d{1,3})X$");
  const enableSkuFallback = settings.enableSkuFallback !== false; // default true

  type LineInfo = {
    variantId: string;
    productTitle: string;
    sku: string | null | undefined;
    multiplier: number;
    quantity: number;
  };

  const lines: LineInfo[] = input.cart.lines.map((line) => {
    const merch = line.merchandise as any;
    const variantId: string = merch?.id ?? "";
    const sku: string | null | undefined = merch?.sku;
    const productTitle: string = merch?.product?.title ?? merch?.title ?? "";

    // explicit mapping by variantId
    let multiplier = 1;
    if (settings.mappings && settings.mappings[variantId]) {
      multiplier = Number(settings.mappings[variantId].multiplier || 1);
    } else if (enableSkuFallback && sku) {
      const match = skuRegex.exec(sku);
      if (match) {
        const mult = Number(match[2]);
        if (!Number.isNaN(mult) && mult > 0) multiplier = mult;
      }
    }

    return {
      variantId,
      productTitle,
      sku,
      multiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1,
      quantity: line.quantity,
    };
  });

  // Compute demand per base product by bottle-equivalents.
  // We will group by base key derived from explicit mapping base variant id (preferred)
  // or by variant id itself if multiplier === 1, else by SKU base (X-1X fallback).
  const demandByKey: Record<string, { productTitle: string; required: number }> = {};

  for (const line of lines) {
    // Determine base key: prefer explicit mapping base variant id, else SKU base from regex, else own variant id
    let baseKey = line.variantId;
    if (settings.mappings && settings.mappings[line.variantId]?.base) {
      baseKey = settings.mappings[line.variantId].base;
    } else if (line.multiplier === 1) {
      baseKey = line.variantId; // singles map to themselves
    } else if (enableSkuFallback && line.sku) {
      const m = skuRegex.exec(line.sku);
      if (m) baseKey = m[1] + "-1X"; // stable key from base sku
    }

    const required = line.quantity * line.multiplier;
    const entry = demandByKey[baseKey] || { productTitle: line.productTitle, required: 0 };
    entry.required += required;
    entry.productTitle = entry.productTitle || line.productTitle;
    demandByKey[baseKey] = entry;
  }

  // Available inventories for base singles should be passed via settings.baseVariantInventories by the fetch target
  // Shopify injects fetchResult.jsonBody back into input.fetchResult for the run target. Merge if present.
  try {
    const invMap = (input as any)?.fetchResult?.jsonBody?.baseVariantInventories;
    if (invMap && typeof invMap === "object") {
      settings.baseVariantInventories = {
        ...(settings.baseVariantInventories || {}),
        ...invMap,
      };
    }
  } catch {}
  // If inventories missing, we don't block.
  for (const [baseKey, { productTitle, required }] of Object.entries(demandByKey)) {
    const available = settings.baseVariantInventories?.[baseKey];
    if (typeof available === "number" && available >= 0 && required > available) {
      errors.push({
        message: `You’re trying to buy ${required} bottles (including cases) for ‘${productTitle}’, but only ${available} are in stock. Reduce singles or cases to proceed.`,
        target: "$.cart",
      });
    }
  }

  return {
    operations: [
      {
        validationAdd: {
          errors,
        },
      },
    ],
  };
}