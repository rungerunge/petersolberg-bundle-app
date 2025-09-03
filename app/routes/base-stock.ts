import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";

// App Proxy doesn't need CORS headers - Shopify handles it

/**
 * App Proxy endpoint: /apps/bbg/base-stock?baseVariantId=gid://shopify/ProductVariant/... or &sku=TEST-1X
 * Returns { available: number }
 */
export async function loader({ request }: LoaderFunctionArgs) {
  console.log("[BBG] Base stock endpoint called");
  const url = new URL(request.url);
  const baseVariantId = url.searchParams.get("baseVariantId");
  const sku = url.searchParams.get("sku");
  const shopParam = url.searchParams.get("shop");
  const shopHeader = request.headers.get("x-shopify-shop-domain") || request.headers.get("Shopify-Shop-Domain");
  const shop = shopParam || shopHeader || undefined;
  
  console.log("[BBG] Request params:", { baseVariantId, sku, shop });

  if (!baseVariantId && !sku) {
    return json({ error: "Missing baseVariantId or sku" }, { status: 400 });
  }

  try {
    // Prefer app proxy auth if present, otherwise fall back to unauthenticated admin using shop header/param
    let admin: any;
    try {
      const ctx = await authenticate.public.appProxy(request);
      admin = ctx.admin;
    } catch {
      if (!shop) return json({ available: 0, error: "Missing shop context" }, { status: 200 });
      const unauth = await unauthenticated.admin(shop);
      admin = unauth.admin;
    }

    // Resolve base variant id by SKU if necessary
    let resolvedVariantId = baseVariantId;
    if (!resolvedVariantId && sku) {
      const resp = await admin.graphql(
        `#graphql
        query($sku: String!) {
          productVariants(first: 1, query: $sku) {
            edges { node { id } }
          }
        }`,
        { variables: { sku } }
      );
      const data = await resp.json();
      resolvedVariantId = data?.data?.productVariants?.edges?.[0]?.node?.id || null;
    }

    if (!resolvedVariantId || !admin) {
      return json({ available: 0, shop, resolvedVariantId: resolvedVariantId || null });
    }

    // Fetch inventory quantity for the base single variant across locations (sum)
    console.log("[BBG] Fetching inventory for variant:", resolvedVariantId);
    const invResp = await admin.graphql(
      `#graphql
      query($id: ID!) {
        productVariant(id: $id) {
          id
          sku
          inventoryQuantity
          inventoryItem {
            id
            inventoryLevels(first: 10) {
              edges {
                node { 
                  available
                  location {
                    name
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { id: resolvedVariantId } }
    );
    const inv = await invResp.json();
    console.log("[BBG] Inventory response:", JSON.stringify(inv, null, 2));
    
    const variant = inv?.data?.productVariant;
    if (!variant) {
      console.error("[BBG] No variant found for ID:", resolvedVariantId);
      return json({ available: 0, error: "Variant not found", shop, resolvedVariantId });
    }
    
    // Try inventoryQuantity first (simpler approach)
    const inventoryQuantity = variant.inventoryQuantity;
    if (inventoryQuantity !== null && inventoryQuantity !== undefined) {
      console.log("[BBG] Using inventoryQuantity:", inventoryQuantity);
      return json({ available: inventoryQuantity, shop, resolvedVariantId, sku: variant.sku });
    }
    
    // Fall back to inventoryLevels
    const levels = variant.inventoryItem?.inventoryLevels?.edges || [];
    const available = levels.reduce((sum: number, e: any) => sum + (e?.node?.available ?? 0), 0);
    console.log("[BBG] Calculated available from levels:", available);
    return json({ available, shop, resolvedVariantId, sku: variant.sku });
  } catch (error: any) {
    return json({ error: error?.message || "Unknown error" }, { status: 500 });
  }
}

export const action = loader;