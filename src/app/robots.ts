import type { MetadataRoute } from "next";

/** Link pages are unlisted by design: crawlers are told to stay away (plus noindex meta + X-Robots-Tag). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: ["/u/", "/d/", "/api/", "/dashboard"] }],
  };
}
