import { Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { money } from "@/lib/api";
import { productMediaUrls } from "@/lib/product-media";
import { Input, Textarea } from "./form-kit";
import type { EditProduct, SellerProduct } from "./types";

export function SellerListings({
  products,
  editing,
  setEditing,
  update,
  remove
}: {
  products: SellerProduct[];
  editing: EditProduct | null;
  setEditing: (product: EditProduct | null) => void;
  update: (input: { id: string; body: Record<string, unknown> }) => void;
  remove: (id: string) => void;
}) {
  return (
    <section className="rounded-lg border border-line bg-card p-5 shadow-soft">
      <h2 className="text-xl font-extrabold text-ink">Мои лоты</h2>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {products.map((product) => {
          const mediaUrl = productMediaUrls(product)[0];
          return (
            <article key={product.id} className="rounded-lg border border-line bg-surface/60 p-4">
              {editing?.id === product.id ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    update({
                      id: product.id,
                      body: {
                        title: editing.title,
                        description: editing.description,
                        price: editing.price.trim(),
                        stock: editing.stock
                      }
                    });
                  }}
                >
                  <Input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
                  <Textarea rows={3} value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
                  <div className="grid grid-cols-2 gap-3">
                    <Input type="number" step="0.01" value={editing.price} onChange={(event) => setEditing({ ...editing, price: event.target.value })} />
                    <Input type="number" value={editing.stock} onChange={(event) => setEditing({ ...editing, stock: Number(event.target.value) })} />
                  </div>
                  <div className="flex gap-2">
                    <button className="app-button">Сохранить</button>
                    <button className="app-button-secondary" type="button" onClick={() => setEditing(null)}>
                      Отмена
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex gap-4">
                    {mediaUrl ? <img className="h-24 w-24 shrink-0 rounded-lg object-cover" src={mediaUrl} alt={product.title} /> : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-extrabold text-ink">{product.title}</h3>
                          <p className="mt-1 text-sm text-muted">{[product.gameName, product.sectionName, product.categoryName].filter(Boolean).join(" / ")}</p>
                          <p className="mt-1 text-xs text-muted">
                            {product.productType ?? "service"} · {product.deliveryType === "instant" ? "мгновенная доставка" : "ручная доставка"} · продано {product.salesCount ?? 0}
                          </p>
                        </div>
                        <div className="text-right">
                          {product.oldPriceCents ? <p className="text-xs text-muted line-through">{money(product.oldPriceCents, product.currency)}</p> : null}
                          <p className="font-extrabold text-ink">{money(product.priceCents, product.currency)}</p>
                          <StatusBadge status={product.status} />
                        </div>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm text-muted">{product.description}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button className="app-button-secondary px-3 py-1 text-sm" onClick={() => update({ id: product.id, body: { status: "active" } })}>
                      Активировать
                    </button>
                    <button className="app-button-secondary px-3 py-1 text-sm" onClick={() => update({ id: product.id, body: { status: "paused" } })}>
                      Пауза
                    </button>
                    <button
                      className="app-button-secondary px-3 py-1 text-sm"
                      onClick={() =>
                        setEditing({
                          id: product.id,
                          title: product.title,
                          description: product.description,
                          price: String(product.priceCents / 100),
                          stock: product.stock
                        })
                      }
                    >
                      Изменить
                    </button>
                    <button className="app-button-danger px-3 py-1 text-sm" onClick={() => remove(product.id)}>
                      <Trash2 className="h-4 w-4" />
                      Удалить
                    </button>
                  </div>
                </>
              )}
            </article>
          );
        })}
        {!products.length ? <p className="text-sm text-muted">Лотов пока нет.</p> : null}
      </div>
    </section>
  );
}
