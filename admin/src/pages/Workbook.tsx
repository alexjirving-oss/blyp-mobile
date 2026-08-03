/**
 * Native BLYP admin workbook.
 * Design rule: reuse the admin console's dark surfaces, compact controls, and aqua brand;
 * keep audited conclusions read-only and browser-local production review visibly separate.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, EmptyState, PageHeader, StatCard } from "../components/ui";
import {
  areaSummaries,
  componentRecords,
  decisionRecords,
  evidenceRecords,
  featureRecords,
  productionGateRecords,
  runtimePathRecords,
  sourceRecords,
  workbookMeta,
  workbookStats,
  type ComponentRecord,
  type EvidenceRecord,
  type FeatureRecord,
  type RuntimePathRecord,
} from "../data/workbook";
import "./Workbook.css";

const WORKBOOK_DOWNLOAD = "/BLYP_Authoritative_Product_Workbook.xlsx";
const REVIEW_STORAGE_KEY = "blyp-production-review-status-v1";

type ViewKey = "summary" | "features" | "evidence" | "runtime" | "components" | "gates" | "sources" | "decisions";
type BadgeKind = "ok" | "warn" | "err" | "info" | "neutral";

const reviewStatuses = [
  "Not reviewed",
  "Production blocker",
  "Development required",
  "In development",
  "Ready for production validation",
  "Production ready",
] as const;
type ReviewStatus = (typeof reviewStatuses)[number];

const views: Array<{ key: ViewKey; label: string; count?: number }> = [
  { key: "summary", label: "Summary" },
  { key: "features", label: "Feature Register", count: workbookStats.featureCount },
  { key: "evidence", label: "Evidence", count: workbookStats.evidenceCount },
  { key: "runtime", label: "Runtime Paths", count: workbookStats.runtimePathCount },
  { key: "components", label: "Components", count: workbookStats.componentCount },
  { key: "gates", label: "Production Gates", count: workbookStats.gateCount },
  { key: "sources", label: "Sources", count: workbookStats.sourceCount },
  { key: "decisions", label: "Decisions", count: workbookStats.decisionCount },
];

const viewCopy: Record<ViewKey, { title: string; description: string }> = {
  summary: {
    title: "Workbook summary",
    description: "A concise projection of the audited BLYP product record, with independent implementation, verification, and production conclusions.",
  },
  features: {
    title: "Feature Register",
    description: "Search every controlled requirement and inspect its intended behaviour, physical implementation, evidence, gaps, gates, and conclusion.",
  },
  evidence: {
    title: "Evidence ledger",
    description: "Trace claims to source, tests, device observations, documentation leads, contradictions, and explicit gaps.",
  },
  runtime: {
    title: "Runtime paths",
    description: "Follow implemented behaviour through actor, entrypoint, client, server, data, asynchronous work, and failure boundaries.",
  },
  components: {
    title: "Component map",
    description: "Inspect deployables, services, routes, storage, workers, identity, monitoring, commerce, and release configuration.",
  },
  gates: {
    title: "Production gates",
    description: "Review the controlled evidence conditions required before any feature can be approved as production ready.",
  },
  sources: {
    title: "Sources and revisions",
    description: "See the provenance, evidence role, revision boundary, and limitation of every source used in the audit.",
  },
  decisions: {
    title: "Decisions and changes",
    description: "Review the explicit reconciliation rules, targeted conclusions, ownership gaps, and next review points.",
  },
};

const gateFields: Array<[keyof FeatureRecord, string]> = [
  ["gateScope", "Scope"],
  ["gateArchitecture", "Architecture"],
  ["gateFunction", "Function"],
  ["gateIdentity", "Identity"],
  ["gateData", "Data"],
  ["gatePrivacy", "Privacy"],
  ["gateSafety", "Safety"],
  ["gateCommerce", "Commerce"],
  ["gateSecurity", "Security"],
  ["gateReliability", "Reliability"],
  ["gateOperations", "Operations"],
  ["gateAccessibility", "Accessibility"],
  ["gateLegalPolicy", "Legal & policy"],
  ["gateReleaseCandidate", "Release candidate"],
];

function statusKind(value: string): BadgeKind {
  const normalized = (value || "Unknown").toLowerCase();
  if (
    normalized.includes("production ready") ||
    normalized.includes("end-to-end present") ||
    normalized.includes("complete against") ||
    normalized === "pass"
  ) return "ok";
  if (
    normalized.includes("blocked") ||
    normalized.includes("blocker") ||
    normalized.includes("conflicting") ||
    normalized === "fail"
  ) return "err";
  if (
    normalized.includes("development required") ||
    normalized.includes("not started") ||
    normalized.includes("incomplete") ||
    normalized.includes("ui only") ||
    normalized.includes("backend only") ||
    normalized.includes("scaffold") ||
    normalized.includes("in development")
  ) return "warn";
  if (
    normalized.includes("partial") ||
    normalized.includes("source traced") ||
    normalized.includes("reachable") ||
    normalized.includes("device observed") ||
    normalized.includes("ready for production validation")
  ) return "info";
  return "neutral";
}

function Status({ value }: { value: string }) {
  return <Badge kind={statusKind(value)}>{value || "Unknown"}</Badge>;
}

function splitIds(value: string) {
  return value.split(/[;,]/).map((item) => item.trim()).filter(Boolean);
}

function loadReviews(): Record<string, ReviewStatus> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(REVIEW_STORAGE_KEY) || "{}") as Record<string, string>;
    return Object.fromEntries(
      Object.entries(stored).filter(([, value]) => value !== "Not reviewed" && reviewStatuses.includes(value as ReviewStatus)),
    ) as Record<string, ReviewStatus>;
  } catch {
    return {};
  }
}

function Field({ label, children, mono = false }: { label: string; children?: ReactNode; mono?: boolean }) {
  return (
    <div className="wb-field">
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{children || <span className="dim">Not recorded</span>}</dd>
    </div>
  );
}

function Pagination({ page, pageCount, total, pageSize, onPage }: { page: number; pageCount: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  if (pageCount <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <div className="wb-pagination">
      <span className="dim">{start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}</span>
      <div className="row">
        <button className="btn ghost tiny" type="button" disabled={page === 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="mono">{page} / {pageCount}</span>
        <button className="btn ghost tiny" type="button" disabled={page === pageCount} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

function SheetHeading({ view, count }: { view: ViewKey; count?: number }) {
  const copy = viewCopy[view];
  return (
    <div className="wb-sheet-heading">
      <div>
        <h2>{copy.title}</h2>
        <p>{copy.description}</p>
      </div>
      {typeof count === "number" && <span className="mono wb-record-count">{count.toLocaleString()} records</span>}
    </div>
  );
}

function Distribution({ title, values }: { title: string; values: Record<string, number> }) {
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  return (
    <section className="card wb-distribution">
      <h3>{title}</h3>
      <div className="stack">
        {Object.entries(values).sort((a, b) => b[1] - a[1]).map(([label, value]) => (
          <div key={label}>
            <div className="row spread wb-distribution-label"><span>{label}</span><strong>{value}</strong></div>
            <div className="wb-bar"><span className={`wb-bar-${statusKind(label)}`} style={{ width: `${Math.max(2, (value / total) * 100)}%` }} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SummaryView({ navigate }: { navigate: (view: ViewKey) => void }) {
  const productionReady = Object.entries(workbookStats.production)
    .find(([label]) => label === "Production ready")?.[1] ?? 0;
  return (
    <div className="stack wb-view-gap">
      <SheetHeading view="summary" />
      <div className="wb-stats">
        <StatCard label="Feature records" value={workbookStats.featureCount.toLocaleString()} hint={`${workbookStats.areaCount} product areas`} />
        <StatCard label="Evidence records" value={workbookStats.evidenceCount.toLocaleString()} hint="Every claim remains traceable" tone="ok" />
        <StatCard label="Runtime paths" value={workbookStats.runtimePathCount.toLocaleString()} hint={`${workbookStats.componentCount} physical components`} />
        <StatCard label="Production ready" value={productionReady.toLocaleString()} hint="No accountable approval supplied" tone="err" />
      </div>

      <div className="card wb-callout wb-callout-warn">
        <strong>Implementation is not production approval.</strong>
        <span> The register keeps implementation, reachability, completeness, verification, applicable gates, and accountable approval as separate facts.</span>
      </div>

      <div className="wb-distributions">
        <Distribution title="Implementation" values={workbookStats.implementation} />
        <Distribution title="Reachability" values={workbookStats.reachability} />
        <Distribution title="Completeness" values={workbookStats.completeness} />
        <Distribution title="Verification" values={workbookStats.verification} />
        <Distribution title="Production" values={workbookStats.production} />
      </div>

      <section className="card wb-card-flush">
        <div className="wb-section-bar">
          <div><h3>Coverage by product area</h3><p>All 30 areas reconcile to the same 633-record register.</p></div>
          <button className="btn ghost tiny" type="button" onClick={() => navigate("features")}>Open register</button>
        </div>
        <div className="wb-area-grid">
          {areaSummaries.map((area) => (
            <button type="button" key={area.number} onClick={() => navigate("features")}>
              <span className="mono wb-area-number">{area.number}</span>
              <span>{area.name}</span>
              <strong>{area.count}</strong>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function FeatureRow({ feature, review, onReview, onEvidence, onRuntime }: {
  feature: FeatureRecord;
  review: ReviewStatus;
  onReview: (status: ReviewStatus) => void;
  onEvidence: (id: string) => void;
  onRuntime: (id: string) => void;
}) {
  const evidenceIds = Array.from(new Set([
    ...splitIds(feature.sourceEvidenceIds),
    ...splitIds(feature.testEvidenceIds),
    ...splitIds(feature.observedEvidenceIds),
  ]));

  return (
    <details className="wb-disclosure wb-feature">
      <summary className="wb-feature-summary">
        <span className="wb-chevron" aria-hidden="true">›</span>
        <span className="mono wb-feature-id">{feature.id}</span>
        <span className="wb-feature-name"><strong>{feature.name}</strong><small>{feature.area} · {feature.recordType}</small></span>
        <span><Status value={feature.implementationState} /></span>
        <span><Status value={feature.functionalCompleteness} /></span>
        <span><Status value={feature.verificationState} /></span>
        <span><Status value={feature.productionConclusion} /></span>
      </summary>
      <div className="wb-detail">
        <section className="wb-review-panel">
          <div>
            <strong>Production review</strong>
            <p>Reviewer-controlled progress saved in this browser. It never changes the audited fields below.</p>
          </div>
          <label>
            <span className="sr-only">Production review for {feature.id}</span>
            <select value={review} onChange={(event) => onReview(event.target.value as ReviewStatus)}>
              {reviewStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
        </section>

        <div className="wb-detail-grid">
          <section><h3>Intended behaviour</h3><dl>
            <Field label="Requirement">{feature.requirement}</Field>
            <Field label="Outcome">{feature.intendedOutcome}</Field>
            <Field label="Acceptance criteria">{feature.acceptanceCriteria}</Field>
            <Field label="Scope / actor / surface">{[feature.intendedScope, feature.intendedActor, feature.intendedSurface].filter(Boolean).join(" · ")}</Field>
            <Field label="Dependencies">{feature.dependencies}</Field>
            <Field label="Product source" mono>{feature.sourceLocation}</Field>
          </dl></section>

          <section><h3>Physical implementation</h3><dl>
            <Field label="Client entry" mono>{feature.clientEntry}</Field>
            <Field label="UI components" mono>{feature.uiComponents}</Field>
            <Field label="Client services" mono>{feature.clientServices}</Field>
            <Field label="Server routes" mono>{feature.serverRoutes}</Field>
            <Field label="Data stores" mono>{feature.dataStores}</Field>
            <Field label="Workers / async" mono>{feature.workers}</Field>
            <Field label="External services">{feature.externalServices}</Field>
            <Field label="Configuration" mono>{feature.configuration}</Field>
            <Field label="Deployable runtime">{feature.deployableRuntime}</Field>
          </dl></section>

          <section><h3>Runtime and conclusion</h3><dl>
            <Field label="How it runs">{feature.runtimeNarrative}</Field>
            <Field label="Reachability"><Status value={feature.reachability} /> <span className="wb-inline-note">{feature.reachabilityDetail}</span></Field>
            <Field label="Complete against requirement">{feature.completeAgainstRequirement}</Field>
            <Field label="Known gaps">{feature.knownGaps}</Field>
            <Field label="Production blockers">{feature.productionBlockers}</Field>
            <Field label="Required next evidence">{feature.requiredNextEvidence}</Field>
            {feature.runtimePathId && <Field label="Runtime path"><button className="wb-link-button mono" type="button" onClick={() => onRuntime(feature.runtimePathId)}>{feature.runtimePathId} →</button></Field>}
          </dl></section>

          <section><h3>Verification and approval</h3><dl>
            <Field label="Evidence confidence">{feature.evidenceConfidence}</Field>
            <Field label="Last verified">{feature.lastVerifiedAt}</Field>
            <Field label="Verified revision" mono>{feature.verifiedRevision}</Field>
            <Field label="Owner">{feature.owner}</Field>
            <Field label="Approved by">{feature.approvedBy}</Field>
            <Field label="Approved at">{feature.approvedAt}</Field>
            <Field label="Review notes">{feature.reviewNotes}</Field>
            <Field label="Last updated">{feature.lastUpdated}</Field>
          </dl></section>
        </div>

        <div className="wb-reference-grid">
          <section><h3>Evidence references</h3>
            {evidenceIds.length ? <div className="row wrap">{evidenceIds.map((id) => <button key={id} type="button" className="wb-reference" onClick={() => onEvidence(id)}>{id}</button>)}</div> : <span className="dim">No evidence ID linked</span>}
          </section>
          <section><h3>Production gates</h3><div className="wb-gate-pills">
            {gateFields.map(([field, label]) => <span key={String(field)}><small>{label}</small><Status value={String(feature[field] || "Unknown")} /></span>)}
          </div></section>
        </div>
      </div>
    </details>
  );
}

function FeatureRegisterView({ onEvidence, onRuntime }: { onEvidence: (id: string) => void; onRuntime: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("All");
  const [implementation, setImplementation] = useState("All");
  const [completeness, setCompleteness] = useState("All");
  const [verification, setVerification] = useState("All");
  const [production, setProduction] = useState("All");
  const [review, setReview] = useState("All");
  const [reviews, setReviews] = useState<Record<string, ReviewStatus>>(loadReviews);
  const [page, setPage] = useState(1);
  const pageSize = 40;

  const options = useMemo(() => ({
    implementation: Object.keys(workbookStats.implementation).sort(),
    completeness: Object.keys(workbookStats.completeness).sort(),
    verification: Object.keys(workbookStats.verification).sort(),
    production: Object.keys(workbookStats.production).sort(),
  }), []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return featureRecords.filter((feature) => {
      if (area !== "All" && feature.areaNumber.padStart(2, "0") !== area) return false;
      if (implementation !== "All" && feature.implementationState !== implementation) return false;
      if (completeness !== "All" && feature.functionalCompleteness !== completeness) return false;
      if (verification !== "All" && feature.verificationState !== verification) return false;
      if (production !== "All" && feature.productionConclusion !== production) return false;
      if (review !== "All" && (reviews[feature.id] || "Not reviewed") !== review) return false;
      if (!needle) return true;
      return [feature.id, feature.name, feature.area, feature.requirement, feature.clientEntry, feature.uiComponents, feature.serverRoutes, feature.dataStores, feature.runtimeNarrative, feature.knownGaps, feature.productionBlockers]
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [area, completeness, implementation, production, query, review, reviews, verification]);

  useEffect(() => window.localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(reviews)), [reviews]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  const hasFilters = Boolean(query || [area, implementation, completeness, verification, production, review].some((value) => value !== "All"));

  function resetFilters() {
    setQuery(""); setArea("All"); setImplementation("All"); setCompleteness("All"); setVerification("All"); setProduction("All"); setReview("All");
    setPage(1);
  }

  function updateReview(id: string, status: ReviewStatus) {
    setReviews((current) => {
      const next = { ...current };
      if (status === "Not reviewed") delete next[id]; else next[id] = status;
      return next;
    });
  }

  return (
    <div className="stack wb-view-gap">
      <SheetHeading view="features" count={filtered.length} />
      <section className="card wb-filter-card">
        <input aria-label="Search feature register" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search feature, requirement, file, route, data store, or blocker…" />
        <div className="wb-filter-grid">
          <label>Area<select value={area} onChange={(event) => { setArea(event.target.value); setPage(1); }}><option>All</option>{areaSummaries.map((item) => <option key={item.number}>{item.number}</option>)}</select></label>
          <label>Implementation<select value={implementation} onChange={(event) => { setImplementation(event.target.value); setPage(1); }}><option>All</option>{options.implementation.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Completeness<select value={completeness} onChange={(event) => { setCompleteness(event.target.value); setPage(1); }}><option>All</option>{options.completeness.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Verification<select value={verification} onChange={(event) => { setVerification(event.target.value); setPage(1); }}><option>All</option>{options.verification.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Production<select value={production} onChange={(event) => { setProduction(event.target.value); setPage(1); }}><option>All</option>{options.production.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Review<select value={review} onChange={(event) => { setReview(event.target.value); setPage(1); }}><option>All</option>{reviewStatuses.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        <div className="row spread wrap wb-filter-meta">
          <span>{filtered.length.toLocaleString()} matching · <strong>{Object.keys(reviews).length.toLocaleString()}</strong> reviewed in this browser</span>
          {hasFilters && <button className="btn ghost tiny" type="button" onClick={resetFilters}>Clear filters</button>}
        </div>
      </section>

      <section className="card wb-card-flush">
        <div className="wb-feature-header"><span /><span>ID</span><span>Feature</span><span>Implementation</span><span>Completeness</span><span>Verification</span><span>Production</span></div>
        {pageItems.length ? pageItems.map((feature) => (
          <FeatureRow key={feature.id} feature={feature} review={reviews[feature.id] || "Not reviewed"} onReview={(status) => updateReview(feature.id, status)} onEvidence={onEvidence} onRuntime={onRuntime} />
        )) : <EmptyState>No feature records match these filters.</EmptyState>}
        <Pagination page={page} pageCount={pageCount} total={filtered.length} pageSize={pageSize} onPage={setPage} />
      </section>
    </div>
  );
}

function EvidenceRow({ evidence }: { evidence: EvidenceRecord }) {
  return (
    <details className="wb-disclosure">
      <summary className="wb-evidence-summary">
        <span className="wb-chevron" aria-hidden="true">›</span><span className="mono wb-feature-id">{evidence.id}</span><span>{evidence.type}</span><span><Status value={evidence.result} /></span><span className="wb-source-cell"><strong>{evidence.path}</strong><small>{evidence.symbol}</small></span><span><Status value={evidence.freshness} /></span>
      </summary>
      <div className="wb-detail wb-detail-grid wb-detail-grid-two">
        <section><dl><Field label="Evidence note">{evidence.note}</Field><Field label="Linked features" mono>{evidence.featureIds}</Field><Field label="Evidence type">{evidence.type}</Field></dl></section>
        <section><dl><Field label="Source path / system" mono>{evidence.path}</Field><Field label="Symbol / route / object" mono>{evidence.symbol}</Field><Field label="Line / locator" mono>{evidence.locator}</Field><Field label="Revision / build" mono>{evidence.revision}</Field><Field label="Observed / generated">{evidence.observedAt}</Field></dl></section>
      </div>
    </details>
  );
}

function EvidenceView({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState("All");
  const [freshness, setFreshness] = useState("All");
  const [page, setPage] = useState(1);
  const pageSize = 40;
  const resultOptions = useMemo(() => Array.from(new Set(evidenceRecords.map((item) => item.result))).sort(), []);
  const freshnessOptions = useMemo(() => Array.from(new Set(evidenceRecords.map((item) => item.freshness))).sort(), []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return evidenceRecords.filter((item) => {
      if (result !== "All" && item.result !== result) return false;
      if (freshness !== "All" && item.freshness !== freshness) return false;
      return !needle || [item.id, item.featureIds, item.type, item.path, item.symbol, item.locator, item.note].some((value) => value.toLowerCase().includes(needle));
    });
  }, [freshness, query, result]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  return (
    <div className="stack wb-view-gap">
      <SheetHeading view="evidence" count={filtered.length} />
      <section className="card wb-filter-card wb-filter-card-inline">
        <input aria-label="Search evidence" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search evidence ID, feature ID, path, symbol, locator, or note…" />
        <label>Result<select value={result} onChange={(event) => { setResult(event.target.value); setPage(1); }}><option>All</option>{resultOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Freshness<select value={freshness} onChange={(event) => { setFreshness(event.target.value); setPage(1); }}><option>All</option>{freshnessOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
      </section>
      <section className="card wb-card-flush">
        <div className="wb-evidence-header"><span /><span>ID</span><span>Type</span><span>Result</span><span>Source</span><span>Freshness</span></div>
        {pageItems.length ? pageItems.map((item) => <EvidenceRow key={item.id} evidence={item} />) : <EmptyState>No evidence records match these filters.</EmptyState>}
        <Pagination page={page} pageCount={pageCount} total={filtered.length} pageSize={pageSize} onPage={setPage} />
      </section>
    </div>
  );
}

function RuntimeCard({ item, focused }: { item: RuntimePathRecord; focused: boolean }) {
  return (
    <details className={`card wb-compact-disclosure${focused ? " wb-focused" : ""}`} open={focused || undefined}>
      <summary><span className="mono wb-reference">{item.id}</span><span><strong>{item.name}</strong><small>{item.actor} · {item.entry}</small></span><span className="wb-chevron">›</span></summary>
      <div className="wb-detail-grid wb-detail-grid-three"><section><dl><Field label="Sequence">{item.sequence}</Field><Field label="Client" mono>{item.client}</Field></dl></section><section><dl><Field label="Server" mono>{item.server}</Field><Field label="Data" mono>{item.data}</Field><Field label="Async / realtime">{item.asyncRealtime}</Field></dl></section><section><dl><Field label="External systems">{item.external}</Field><Field label="Failure / fallback">{item.failureFallback}</Field><Field label="Evidence locator" mono>{item.evidenceLocator}</Field><Field label="Verification">{item.verification}</Field></dl></section></div>
    </details>
  );
}

function RuntimeView({ focus }: { focus: string }) {
  const [query, setQuery] = useState(focus);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return !needle ? runtimePathRecords : runtimePathRecords.filter((item) => [item.id, item.name, item.actor, item.entry, item.sequence, item.client, item.server, item.data].some((value) => value.toLowerCase().includes(needle)));
  }, [query]);
  return <div className="stack wb-view-gap"><SheetHeading view="runtime" count={filtered.length} /><input aria-label="Search runtime paths" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search runtime path, actor, entrypoint, service, or data store…" />{filtered.length ? filtered.map((item) => <RuntimeCard key={item.id} item={item} focused={focus === item.id} />) : <EmptyState>No runtime paths match this search.</EmptyState>}</div>;
}

function ComponentCard({ item }: { item: ComponentRecord }) {
  return <details className="card wb-compact-disclosure"><summary><span className="mono wb-reference">{item.id}</span><span><strong>{item.name}</strong><small>{item.type} · {item.runtime}</small></span><span className="wb-chevron">›</span></summary><div><dl><Field label="Physical location" mono>{item.physicalLocation}</Field><Field label="Entry / interface" mono>{item.entryInterface}</Field><Field label="Responsibility">{item.responsibility}</Field><Field label="Authority">{item.authority}</Field><Field label="Dependencies">{item.dependencies}</Field><Field label="Configuration" mono>{item.configuration}</Field><Field label="Known caveat">{item.knownCaveat}</Field><Field label="Evidence locator" mono>{item.evidenceLocator}</Field></dl></div></details>;
}

function ComponentsView() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return !needle ? componentRecords : componentRecords.filter((item) => [item.id, item.name, item.type, item.runtime, item.physicalLocation, item.responsibility, item.authority, item.knownCaveat].some((value) => value.toLowerCase().includes(needle)));
  }, [query]);
  return <div className="stack wb-view-gap"><SheetHeading view="components" count={filtered.length} /><input aria-label="Search components" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search component, runtime, path, responsibility, authority, or caveat…" /><div className="wb-card-grid">{filtered.length ? filtered.map((item) => <ComponentCard key={item.id} item={item} />) : <EmptyState>No components match this search.</EmptyState>}</div></div>;
}

function GatesView() {
  return <div className="stack wb-view-gap"><SheetHeading view="gates" count={productionGateRecords.length} /><div className="card wb-callout wb-callout-error"><strong>Zero records are marked Production ready.</strong><span> This does not mean nothing is implemented. It means no record currently has complete gates, exact release-candidate evidence, and accountable approval.</span></div><div className="wb-card-grid">{productionGateRecords.map((gate, index) => <article className="card wb-gate-card" key={gate.name}><div className="row"><span className="mono wb-area-number">{String(index + 1).padStart(2, "0")}</span><h3>{gate.name}</h3></div><p>{gate.question}</p><dl><Field label="Pass requires">{gate.passRequires}</Field><Field label="Failure consequence">{gate.failureConsequence}</Field><Field label="Controlled values">{gate.allowedStatus}</Field></dl></article>)}</div></div>;
}

function SourcesView() {
  return <div className="stack wb-view-gap"><SheetHeading view="sources" count={sourceRecords.length} />{sourceRecords.map((source) => <article className="card wb-source-record" key={source.id}><span className="mono wb-reference">{source.id}</span><div><h3>{source.name}</h3><p className="mono">{source.location}</p></div><div><small>Role</small><p>{source.role}</p><span className="mono wb-area-number">{source.revisionDate}</span></div><div><small>Qualification</small><p>{source.limitation}</p></div></article>)}</div>;
}

function DecisionsView() {
  return <div className="stack wb-view-gap"><SheetHeading view="decisions" count={decisionRecords.length} /><div className="wb-timeline">{decisionRecords.map((decision) => <article className="card" key={decision.id}><div className="row spread wrap"><span className="mono wb-area-number">{decision.id} · {decision.scope}</span><span className="dim">{decision.date}</span></div><h3>{decision.decision}</h3><p>{decision.rationale}</p><div className="row wrap wb-decision-meta"><span>Owner: <strong>{decision.owner || "Unassigned"}</strong></span><span>Approved by: <strong>{decision.approvedBy || "Not recorded"}</strong></span><span>Next: <strong>{decision.nextReview}</strong></span></div></article>)}</div></div>;
}

export default function Workbook() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("sheet") as ViewKey | null;
  const view = views.some((item) => item.key === requested) ? requested! : "summary";
  const focus = searchParams.get("q") || "";

  function navigate(next: ViewKey, query = "") {
    const params = new URLSearchParams();
    params.set("sheet", next);
    if (query) params.set("q", query);
    setSearchParams(params);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="wb-page">
      <PageHeader
        title="Product Workbook"
        subtitle="Authoritative product definition, physical implementation, evidence, and production-readiness record"
        actions={<a className="btn" href={WORKBOOK_DOWNLOAD} download>Download Excel</a>}
      />

      <section className="card wb-meta-strip">
        <div><span className="dim">Reviewed revision</span><strong className="mono">{workbookMeta.revision.slice(0, 12)}</strong></div>
        <div><span className="dim">Reviewed</span><strong>{workbookMeta.reviewedAt}</strong></div>
        <div><span className="dim">Mode</span><strong>{workbookMeta.mode}</strong></div>
      </section>

      <nav className="wb-tabs" aria-label="Workbook sections">
        {views.map((item) => <button type="button" key={item.key} className={view === item.key ? "active" : ""} onClick={() => navigate(item.key)}><span>{item.label}</span>{typeof item.count === "number" && <small>{item.count}</small>}</button>)}
      </nav>

      {view === "summary" && <SummaryView navigate={navigate} />}
      {view === "features" && <FeatureRegisterView onEvidence={(id) => navigate("evidence", id)} onRuntime={(id) => navigate("runtime", id)} />}
      {view === "evidence" && <EvidenceView key={focus} initialQuery={focus} />}
      {view === "runtime" && <RuntimeView key={focus} focus={focus} />}
      {view === "components" && <ComponentsView />}
      {view === "gates" && <GatesView />}
      {view === "sources" && <SourcesView />}
      {view === "decisions" && <DecisionsView />}
    </div>
  );
}
