import { PageHeader } from "../components/ui";

export default function Placeholder({ title, subtitle, planned }: { title: string; subtitle: string; planned: string[] }) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={<span className="badge info">Building</span>} />
      <div className="card" style={{ maxWidth: 720 }}>
        <h3 className="panel-title">What this module will do</h3>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)", fontSize: 13.5, lineHeight: 1.9 }}>
          {planned.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="dim" style={{ fontSize: 12, marginTop: 14 }}>
          The data layer for this module is being wired up. Live functionality lands incrementally — the foundation,
          Command Center, and People are already live against the production backend.
        </div>
      </div>
    </div>
  );
}
