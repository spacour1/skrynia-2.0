import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { serializeJsonLd } from "@/lib/json-ld";

describe("structured data HTML boundary", () => {
  it("keeps untrusted closing tags inside a single inert JSON script", () => {
    const value = {
      name: '</script><script>window.injected=true</script>',
      description: '<!-- <ScRiPt>alert(1)</sCrIpT> & Ukrainian: іїє'
    };
    const serialized = serializeJsonLd(value);
    const html = renderToStaticMarkup(
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serialized }} />
    );
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelectorAll("script")).toHaveLength(1);
    expect(serialized).not.toContain("<");
    expect(JSON.parse(document.querySelector("script")!.textContent!)).toEqual(value);
  });

  it("preserves nested values, Unicode and ordinary JSON escaping", () => {
    const value = { nested: [{ text: 'line\n"quoted" \\ slash / <>', enabled: true }], missing: null };
    expect(JSON.parse(serializeJsonLd(value))).toEqual(value);
  });
});
