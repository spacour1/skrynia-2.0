import { useEffect, useState } from "react";
import { slugify } from "@/lib/catalog-api";

/**
 * Keeps `slug` auto-derived from `name` while the entity is still a draft and
 * the admin has not hand-edited the slug.
 */
export function useAutoSlug(name: string, initialSlug: string, editable: boolean) {
  const [slug, setSlug] = useState(initialSlug);
  const [touched, setTouched] = useState(initialSlug.length > 0);

  useEffect(() => {
    if (editable && !touched) setSlug(slugify(name));
  }, [name, editable, touched]);

  return {
    slug,
    setSlug: (value: string) => {
      setTouched(true);
      setSlug(value);
    }
  };
}
