import type { Metadata } from "next";
import type { Product } from "../../../lib/api";
import { fetchServerSide } from "../../../lib/server-api";
import { SITE_NAME, SITE_URL } from "../../../lib/site";
import { ProductPageClient } from "./ProductPageClient";

type ProductResponse = { product: Product };

async function loadProduct(id: string) {
  const data = await fetchServerSide<ProductResponse>(`/marketplace/products/${id}`);
  return data?.product ?? null;
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const product = await loadProduct(params.id);
  if (!product) return { title: "Товар не найден" };

  const description = (product.description ?? "").slice(0, 160);
  const image = product.media?.[0]?.url;
  const url = `${SITE_URL}/products/${product.id}`;

  return {
    title: product.title,
    description,
    alternates: { canonical: url },
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
      url: `${SITE_URL}/products/${product.id}`,
      price: (product.priceCents / 100).toFixed(2),
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

export default async function ProductPage({ params }: { params: { id: string } }) {
  const product = await loadProduct(params.id);

  return (
    <>
      {product ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildProductJsonLd(product)) }}
        />
      ) : null}
      <ProductPageClient id={params.id} />
    </>
  );
}
