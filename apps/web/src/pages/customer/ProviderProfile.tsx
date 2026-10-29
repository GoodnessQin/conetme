import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CHECK_LABELS, CHECK_TYPES, formatNaira } from "@connectme/shared";
import { publicUrl, rpc } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import type { PublicProvider } from "../../lib/types";
import { Avatar, Button, Card, EmptyState, ListSkeleton, PageHeader, SectionTitle, Stars, VerifiedBadge } from "../../components/ui";
import { useNavigate } from "react-router-dom";

export default function ProviderProfile() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["public-provider", id], queryFn: () => rpc<PublicProvider | null>("public_provider", { p_provider: id }) });
  if (q.isLoading) return <ListSkeleton />;
  const p = q.data;
  if (!p) return <EmptyState title="Profile not available" body="This provider is not currently verified on ConnectMe." />;
  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={() => nav(-1)} className="mb-3 text-sm font-medium text-brand hover:underline">‹ Back to offers</button>
      <Card>
        <div className="flex items-center gap-4">
          <Avatar name={p.name} path={p.avatar} size={80} />
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">{p.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3"><VerifiedBadge level={p.level} /><Stars value={p.rating} count={p.rating_count} /></div>
            <p className="mt-1 text-sm text-muted">{p.area} · {p.jobs} jobs completed{p.years ? ` · ${p.years} years experience` : ""} · Member since {fmtDate(p.member_since)}</p>
          </div>
        </div>
        {p.bio && <p className="mt-4 text-ink/85">{p.bio}</p>}
        {p.services[0] && <Button className="mt-4 sm:max-w-xs" onClick={() => nav(`/customer/new/${p.services[0]!.slug}`, { state: { preferred: { id: p.id, name: p.name } } })}>Request {p.name.split(" ")[0]} directly</Button>}
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <SectionTitle>What we verified</SectionTitle>
          <ul className="space-y-2.5">
            {CHECK_TYPES.map((t) => {
              const ok = p.badges.includes(t);
              return <li key={t} className="flex items-start gap-2 text-sm"><span className={ok ? "text-success" : "text-muted"} aria-hidden>{ok ? "✓" : "○"}</span><span><b>{CHECK_LABELS[t].title}</b><span className="text-muted"> · {ok ? "Passed" : "Not completed"}</span></span></li>;
            })}
          </ul>
        </Card>
        <Card>
          <SectionTitle>Services</SectionTitle>
          <ul className="divide-y divide-line">
            {p.services.map((s) => <li key={s.name} className="flex justify-between py-2.5 text-sm"><b>{s.name}</b><span className="text-muted">{s.typical_price_kobo ? `Typically from ${formatNaira(s.typical_price_kobo)}` : "Price on request"}</span></li>)}
          </ul>
        </Card>
      </div>

      <div className="mt-6">
        <SectionTitle>Recent work</SectionTitle>
        {p.portfolio.length === 0 ? <p className="text-sm text-muted">No photos yet.</p> : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {p.portfolio.map((w) => (
              <figure key={w.path} className="overflow-hidden rounded-card border border-line bg-white">
                <img src={publicUrl("portfolio", w.path) ?? ""} alt={w.caption ?? "Past work"} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                {w.caption && <figcaption className="px-3 py-2 text-xs text-muted">{w.caption}</figcaption>}
              </figure>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6">
        <SectionTitle>Reviews</SectionTitle>
        {p.reviews.length === 0 ? (
          <Card><p className="text-sm text-muted">No reviews yet. This provider is new on ConnectMe and has been through our full verification. Your payment is held until you confirm the work.</p></Card>
        ) : (
          <div className="space-y-3">{p.reviews.map((r, i) => (
            <Card key={i}><p className="text-amber-500" aria-label={`${r.stars} out of 5`}>{"★".repeat(r.stars)}<span className="text-line">{"★".repeat(5 - r.stars)}</span></p>
              {r.comment && <p className="mt-1 text-sm">{r.comment}</p>}<p className="mt-1 text-xs text-muted">{r.by}, verified customer · {fmtDate(r.at)}</p></Card>
          ))}</div>
        )}
      </div>
    </div>
  );
}
