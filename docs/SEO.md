# Public SEO

Public pages use /ru, /uz and /en prefixes. Language switching preserves the current page. Service pages use /{language}/services/{id}-{slug}; old marketplace opened/service links permanently redirect to the canonical page. The marketplace detail view remains available with view=details and is not indexed.

Vercel serves initial HTML, title, description, canonical, language alternates, social metadata and JSON-LD from api/seo.js (frontend/api/seo.js is the Vercel project entry). The same HTML is sent to people and crawlers. React then mounts the interactive application.

/api/seo/services exposes an explicit whitelist of approved, published, current service data. It never returns colleague prices, contacts, raw descriptions, or proof. Expired, deleted, draft and unapproved services return 404. Backend failures return 503 with Retry-After rather than an empty successful page.

/robots.txt excludes private areas. Private app routes and API responses also carry noindex. Unknown pages return HTTP 404.

/sitemap.xml indexes /sitemaps/pages.xml and automatically partitioned service sitemaps. Only eligible services are included. Public static routes and service pages have reciprocal ru/uz/en alternates. Community is indexed only in Russian until its content supports other languages. Supplier-authored titles and values are preserved; the interface and labels are localized, without inventing translations of supplier data.

Run npm run build, then npm run test:seo. Route inventory is generated from React routes during builds.

After deployment, submit https://travella.uz/sitemap.xml in the verified Google Search Console and Yandex Webmaster properties. This repository does not contain search-console verification credentials; submission and indexing must be checked in those accounts. Publishing technical SEO does not guarantee immediate indexing or rankings.
