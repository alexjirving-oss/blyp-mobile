# BLYP Product Workbook — Admin Integration

## Objective

Integrate the authoritative BLYP product workbook into the existing authenticated `admin.blyp.world` console. The public site and DNS remain untouched. Existing admin routes, API behaviour, and navigation stay intact.

## Native information architecture

The existing sidebar gains a dedicated **Product** group containing one route:

| Sidebar group | Menu item | Route |
|---|---|---|
| Product | Product Workbook | `/workbook` |

The workbook route uses compact in-page sheet navigation rather than creating eight additional global sidebar items.

| Workbook view | Purpose | Controlled records |
|---|---|---:|
| Summary | Status distributions, product-area coverage, revision, and download | 30 areas |
| Feature Register | Search, six controlled filters, disclosure, evidence/runtime drill-through, and reviewer status | 633 features |
| Evidence | Searchable evidence ledger with expandable provenance | 312 records |
| Runtime Paths | End-to-end runtime descriptions and failure boundaries | 18 paths |
| Components | Physical component and authority map | 20 components |
| Production Gates | Controlled production-readiness gate definitions | 14 gates |
| Sources | Source/revision roles and limitations | 11 sources |
| Decisions | Explicit reconciliation decisions and approval gaps | 5 decisions |

## Implementation rules

The workbook page will use the admin console’s existing CSS variables, cards, controls, badges, and typography. A route-specific stylesheet may add only workbook layouts and responsive behaviour. The route will be lazy-loaded so the authoritative dataset does not increase the initial bundle used by other admin pages.

Audited facts remain read-only. Reviewer-controlled production status is stored separately in browser storage and must never overwrite implementation, completeness, verification, gate, or production-conclusion fields. Evidence and runtime references remain navigable across workbook views.

The generated TypeScript dataset is copied unchanged from the validated workbook projection. The downloadable Excel source is copied unchanged into the admin public assets. Record counts, ordered identifiers, production-gate names, and reviewed revision must remain exact.

## Release boundary

Implementation and validation occur in an isolated Git worktree created from the latest tracked admin-console revision. No production deployment, DNS change, or push to the user’s repository occurs without explicit confirmation after review.
