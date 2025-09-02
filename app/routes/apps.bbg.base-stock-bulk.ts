import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";

// Bulk proxy for Function fetch target. Accepts body: { lines: [{id, sku, qty}] }
export async function action({ request }: LoaderFunctionArgs) {
  console.log("[BBG] Bulk endpoint called from:", request.headers.get("user-agent"));
  console.log("[BBG] Headers:", Object.fromEntries(request.headers.entries()));
  
  try {
    // Try app proxy auth; fall back to unauthenticated admin using shop header
    let admin: any;
    let shop: string | null = null;
    
    try {
      const ctx = await authenticate.public.appProxy(request);
      admin = ctx.admin;
      shop = ctx.shop;
      console.log("[BBG] Authenticated via app proxy for shop:", shop);
    } catch (e) {
      console.log("[BBG] App proxy auth failed:", e);
      shop = request.headers.get("x-shopify-shop-domain") || request.headers.get("Shopify-Shop-Domain");
      if (!shop) {
        console.log("[BBG] No shop domain in headers");
        return json({ baseVariantInventories: {}, error: "No shop domain" });
      }
      const unauth = await unauthenticated.admin(shop);
      admin = unauth.admin;
      console.log("[BBG] Using unauthenticated admin for shop:", shop);
    }

    const body = await request.json();
    const lineItems: Array<{ id?: string; sku?: string; qty?: number }> = body?.lines || [];

    const skuRegex = /^(.+?)-(\d{1,3})X$/;
    const invMap: Record<string, number> = {};
    const skuToVariantId: Record<string, string> = {};

    // Helper to fetch available by variant id
    async function fetchAvailableByVariantId(variantId: string): Promise<number> {
      const invResp = await admin.graphql(
        `#graphql
        query VariantInventory($id: ID!) {
          productVariant(id: $id) {
            id
            inventoryItem { inventoryLevels(first: 100) { edges { node { available } } } }
          }
        }`,
        { variables: { id: variantId } }
      );
      const inv = await invResp.json();
      const levels = inv?.data?.productVariant?.inventoryItem?.inventoryLevels?.edges || [];
      return levels.reduce((sum: number, e: any) => sum + (e?.node?.available ?? 0), 0);
    }

    // Helper to find variant id by SKU
    async function findVariantIdBySku(sku: string): Promise<string | null> {
      const resp = await admin.graphql(
        `#graphql
        query VariantBySku($sku: String!) {
          productVariants(first: 1, query: $sku) { edges { node { id sku } } }
        }`,
        { variables: { sku } }
      );
      const data = await resp.json();
      const id = data?.data?.productVariants?.edges?.[0]?.node?.id || null;
      if (id) skuToVariantId[sku] = id;
      return id;
    }

    for (const line of lineItems) {
      const sku = line.sku as string | undefined;
      const id = line.id as string | undefined;
      if (sku && skuRegex.test(sku)) {
        const match = sku.match(skuRegex)!;
        const baseSku = `${match[1]}-1X`;
        const baseVariantId = skuToVariantId[baseSku] || (await findVariantIdBySku(baseSku));
        if (baseVariantId && invMap[baseVariantId] == null) {
          invMap[baseVariantId] = await fetchAvailableByVariantId(baseVariantId);
        } else if (!baseVariantId) {
          invMap[baseSku] = 0;
        }
      }
      // For single lines (1X) we key by variantId
      if (sku && sku.endsWith('-1X') && id) {
        skuToVariantId[sku] = id;
        if (invMap[id] == null) invMap[id] = await fetchAvailableByVariantId(id);
      }
    }

    console.log("[BBG] Returning inventory map:", invMap);
    return json({ baseVariantInventories: invMap, skuToVariantId });
  } catch (error: any) {
    console.error("[BBG] Error in bulk endpoint:", error);
    return json({ baseVariantInventories: {}, error: error?.message }, { status: 200 });
  }
}

export const loader = action;


