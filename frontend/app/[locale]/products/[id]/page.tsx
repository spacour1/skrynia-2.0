import type { Metadata } from "next";
import type { Product } from "@/lib/api";
import { fetchServerSide } from "@/lib/server-api";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { defaultLocale, isLocale, locales } from "@/i18n/config";
import { getT } from "@/i18n/dictionaries";
import { ProductPageClient } from "./ProductPageClient";
import { moneyCentsToMajorUnits } from "@/lib/money";

type ProductResponse = { product: Product };

async function loadProduct(id: string) {
  const data = await fetchServerSide<ProductResponse>(`/marketplace/products/${id}`);
  return data?.product ?? null;
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ id: string; locale: string }>;
}): Promise<Metadata> {
  const { id, locale: routeLocale } = await params;
  const locale = isLocale(routeLocale) ? routeLocale : defaultLocale;
  const t = getT(locale);
  const product = await loadProduct(id);
  if (!product) return { title: t("product.notFound") };

  const description = (product.description ?? "").slice(0, 160);
  const image = product.media?.[0]?.url;
  const url = `${SITE_URL}/${locale}/products/${product.id}`;

  return {
    title: product.title,
    description,
    alternates: {
      canonical: url,
      languages: Object.fromEntries(locales.map((item) => [item === "ua" ? "uk" : item, `${SITE_URL}/${item}/products/${product.id}`]))
    },
    openGraph: {
      title: product.title,
      description,
      url,
      siteName: SITE_NAME,
      images: image ? [{ url: image }] : undefined
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: product.title,
      description,
      images: image ? [image] : undefined
    }
  };
}

function buildProductJsonLd(product: Product) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description,
    image: product.media?.length ? product.media.map((item) => item.url) : undefined,
    offers: {
      "@type": "Offer",
      url: `${SITE_URL}/${defaultLocale}/products/${product.id}`,
      price: moneyCentsToMajorUnits(product.priceCents),
      priceCurrency: product.currency,
      availability: product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"
    },
    ...(product.sellerReviewCount
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: product.sellerRating,
            reviewCount: product.sellerReviewCount
          }
        }
      : {})
  };
}

export default async function ProductPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await loadProduct(id);

  return (
    <>
      {product ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildProductJsonLd(product)) }}
        />
      ) : null}
      <ProductPageClient id={id} />
    </>
  );
}
