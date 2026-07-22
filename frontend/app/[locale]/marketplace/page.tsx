"use client";

import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { ProductCard } from "@/components/ProductCard";
import { apiFetch, type Product } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function MarketplacePage() {
  return (
    <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-panel" />}>
      <MarketplaceContent />
    </Suspense>
  );
}

function MarketplaceContent() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const category = searchParams.get("category")?.trim() ?? "";
  const query = category ? `?limit=24&category=${encodeURIComponent(category)}` : "?limit=24";
  const products = useQuery({
    queryKey: ["marketplace-products", category],
    queryFn: () => apiFetch<{ products: Product[] }>(`/marketplace/products${query}`)
  });

  return (
    <section className="space-y-5">
      <h1 className="text-xl font-black text-ink">{t("home.sections.fresh")}</h1>
      {products.isLoading ? <div className="h-48 animate-pulse rounded-xl bg-panel" /> : null}
      {products.isError ? <p className="text-sm text-muted">{t("home.emptyOffers")}</p> : null}
      {!products.isLoading && !products.isError && !products.data?.products.length ? <p className="text-sm text-muted">{t("home.emptyOffers")}</p> : null}
      {products.data?.products.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {products.data.products.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      ) : null}
    </section>
  );
}
