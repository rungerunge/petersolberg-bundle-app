import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * App Proxy endpoint: /apps/bbg/base-stock?baseVariantId=gid://shopify/ProductVariant/... or &sku=TEST-1X
 * Returns { available: number }
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { appProxy, admin } = await authenticate.public.appProxy(request);

  // If the request is not a valid app proxy, the above throws 400; continue with minimal context
  const url = new URL(request.url);
  const baseVariantId = url.searchParams.get("baseVariantId");
  const sku = url.searchParams.get("sku");
  const shop = url.searchParams.get("shop");

  if (!baseVariantId && !sku) {
    return json({ error: "Missing baseVariantId or sku" }, { status: 400 });
  }

  try {
    // Resolve base variant id by SKU if necessary
    let resolvedVariantId = baseVariantId || null;
    if (!resolvedVariantId && sku && admin) {
      const resp = await admin.graphql(
        `#graphql
        query VariantBySku($sku: String!) {
          productVariants(first: 1, query: $sku) { edges { node { id sku } } }
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
    const invResp = await admin.graphql(
      `#graphql
      query VariantInventory($id: ID!) {
        productVariant(id: $id) {
          id
          inventoryItem { inventoryLevels(first: 100) { edges { node { available } } } }
        }
      }`,
      { variables: { id: resolvedVariantId } }
    );
    const inv = await invResp.json();
    const levels = inv?.data?.productVariant?.inventoryItem?.inventoryLevels?.edges || [];
    const available = levels.reduce((sum: number, e: any) => sum + (e?.node?.available ?? 0), 0);
    return json({ available, shop, resolvedVariantId });
  } catch (error: any) {
    return json({ error: error?.message || "Unknown error" }, { status: 500 });
  }
}

export const action = loader;


