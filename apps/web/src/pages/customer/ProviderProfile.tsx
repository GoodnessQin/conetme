import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatNaira } from "@connectme/shared";
import { publicUrl, rpc } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import type { PublicProvider } from "../../lib/types";
import { RATING_LABELS, StarRow } from "../../components/Rating";
import { Cover, LikeShare } from "../../components/ProviderCard";
import { useLikes } from "../../lib/likes";
import { Avatar, Button, Card, Dialog, EmptyState, ListSkeleton, Pill, VerifiedBadge } from "../../components/ui";

type Tab = "reviews" | "work" | "about";

/** How a provider looks to customers. Also used by providers to preview their own profile. */
export function ProviderProfileView({ id, slug, backLabel, canRequest }: { id?: string; slug?: string; backLabel: string; canRequest: boolean }) {
  const { liked } = useLikes();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "reviews";
  const [photo, setPhoto] = useState<{ src: string; caption: string | null } | null>(null);
  const q = useQuery({ queryKey: ["public-provider", slug ?? id], queryFn: () => (slug ? rpc<PublicProvider | null>("public_provider_by_slug", { p_slug: slug }) : rpc<PublicProvider | null>("public_provider", { p_provider: id })) });
  if (q.isLoading) return <ListSkeleton />;
  const p = q.data;
  if (!p) return <EmptyState title="Profile not available" body="This provider is not currently verified on ConnectMe." />;
  const total = Object.values(p.rating_breakdown ?? {}).reduce((a, b) => a + b, 0);
  const tabs: [Tab, string][] = [["reviews", `Reviews${p.rating_count ? ` (${p.rating_count})` : ""}`], ["work", `Work${p.portfolio.length ? ` (${p.portfolio.length})` : ""}`], ["about", "About"]];

  return (
    <div className="mx-auto max-w-2xl">
      <button onClick={() => nav(-1)} className="mb-3 text-sm font-medium text-brand hover:underline">‹ {backLabel}</button>
      <Card className="overflow-hidden !p-0">
        <div className="relative">
          <Cover banner={p.banner} seed={p.services[0]?.name ?? p.name} label={p.services[0]?.name} className="h-36 md:h-48" />
          <div className="absolute right-3 top-3"><LikeShare id={p.id} name={p.name} slug={p.slug} liked={liked.has(p.id) || p.liked} /></div>
        </div>
        <div className="p-5">
        <div className="flex items-center gap-4">
          <Avatar name={p.name} path={p.avatar} size={72} />
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold leading-tight tracking-tight">{p.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"><VerifiedBadge level={p.level} />{p.area && <span className="text-sm text-muted">{p.area}</span>}{p.likes > 0 && <span className="text-sm text-muted">♥ {p.likes} {p.likes === 1 ? "recommendation" : "recommendations"}</span>}</div>
          </div>
        </div>
        {p.tagline && <p className="mt-4 text-ink/85">{p.tagline}</p>}
        <dl className="mt-4 grid grid-cols-3 divide-x divide-line rounded-2xl bg-surface py-3 text-center">
          <div><dt className="text-xs text-muted">Rating</dt><dd className="text-lg font-extrabold">{p.rating_count ? <>★ {Number(p.rating).toFixed(1)}</> : "New"}</dd></div>
          <div><dt className="text-xs text-muted">Jobs done</dt><dd className="text-lg font-extrabold">{p.jobs}</dd></div>
          <div><dt className="text-xs text-muted">Experience</dt><dd className="text-lg font-extrabold">{p.years ? `${p.years} yrs` : "–"}</dd></div>
        </dl>
        {canRequest && p.services[0] && <Button className="mt-4" onClick={() => nav(`/customer/new/${p.services[0]!.slug}`, { state: { preferred: { id: p.id, name: p.name } } })}>Request {p.name.split(" ")[0]} directly</Button>}
        </div>
      </Card>

      <div className="mt-5 flex gap-1 border-b border-line" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setSp({ tab: k }, { replace: true })}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-bold ${tab === k ? "border-brand text-brand" : "border-transparent text-muted"}`}>{l}</button>
        ))}
      </div>

      <div className="mt-5" id="reviews">
        {tab === "reviews" && (p.rating_count === 0 ? (
          <Card><p className="font-bold">No reviews yet</p><p className="mt-1 text-sm text-muted">{p.name.split(" ")[0]} is new on ConnectMe and has been through our full verification. Your payment is held until you confirm the work.</p></Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <div className="flex items-center gap-5">
                <div className="text-center"><p className="text-4xl font-extrabold">{Number(p.rating).toFixed(1)}</p><StarRow value={p.rating} size={14} /><p className="mt-1 text-xs text-muted">{p.rating_count} {p.rating_count === 1 ? "review" : "reviews"}</p></div>
                <ul className="flex-1 space-y-1">
                  {([5, 4, 3, 2, 1] as const).map((n) => {
                    const c = p.rating_breakdown?.[String(n) as "1"] ?? 0;
                    return <li key={n} className="flex items-center gap-2 text-xs"><span className="w-14 text-muted">{RATING_LABELS[n]}</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-amber-500" style={{ width: `${total ? (c / total) * 100 : 0}%` }} /></span><span className="w-5 text-right text-muted">{c}</span></li>;
                  })}
                </ul>
              </div>
              {p.top_tags.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{p.top_tags.map((t) => <Pill key={t.tag} tone="success">{t.tag} · {t.n}</Pill>)}</div>}
            </Card>
            {p.reviews.map((r, i) => (
              <Card key={i}>
                <div className="flex items-center justify-between"><div className="flex items-center gap-2"><StarRow value={r.stars} /><span className="text-sm font-bold">{RATING_LABELS[r.stars]}</span></div><span className="text-xs text-muted">{fmtDate(r.at)}</span></div>
                {r.comment && <p className="mt-2 text-sm">{r.comment}</p>}
                {r.tags?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{r.tags.map((t) => <Pill key={t}>{t}</Pill>)}</div>}
                <p className="mt-2 text-xs text-muted">{r.by.charAt(0).toUpperCase() + r.by.slice(1).toLowerCase()}{r.service ? ` · ${r.service}` : ""}</p>
              </Card>
            ))}
          </div>
        ))}

        {tab === "work" && (p.portfolio.length === 0 ? <p className="text-sm text-muted">No work photos yet.</p> : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {p.portfolio.map((w) => (
              <button key={w.path} onClick={() => setPhoto({ src: publicUrl("portfolio", w.path) ?? "", caption: w.caption })} className="overflow-hidden rounded-xl border border-line">
                <img src={publicUrl("portfolio", w.path) ?? ""} alt={w.caption ?? "Past work"} loading="lazy" className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
        ))}

        {tab === "about" && (
          <div className="space-y-4">
            {p.bio && <Card><p className="whitespace-pre-line text-ink/85">{p.bio}</p></Card>}
            <Card>
              <p className="mb-2 font-bold">Services</p>
              <ul className="divide-y divide-line">{p.services.map((s) => <li key={s.name} className="flex justify-between py-2.5 text-sm"><b>{s.name}</b><span className="text-muted">{s.typical_price_kobo ? `Typically from ${formatNaira(s.typical_price_kobo)}` : "Price on request"}</span></li>)}</ul>
              <p className="mt-3 text-sm text-muted">{p.area} · Member since {fmtDate(p.member_since)}</p>
            </Card>
            <Card className="bg-surface"><p className="text-sm"><b>Verified Pro.</b> ConnectMe has checked this provider’s identity, address, guarantor, work credentials and references before they could take jobs.</p></Card>
          </div>
        )}
      </div>

      <Dialog open={!!photo} onClose={() => setPhoto(null)} title={photo?.caption ?? "Past work"} footer={<Button variant="ghost" onClick={() => setPhoto(null)}>Close</Button>}>
        {photo && <img src={photo.src} alt={photo.caption ?? "Past work"} className="max-h-[60vh] w-full rounded-2xl object-contain" />}
      </Dialog>
    </div>
  );
}

export default function ProviderProfile() {
  const { id = "" } = useParams();
  return <ProviderProfileView id={id} backLabel="Back" canRequest />;
}

/** The shareable page at /pro/:slug. Works for visitors and signed-in people. */
export function PublicProviderPage() {
  const { slug = "" } = useParams();
  return <ProviderProfileView slug={slug} backLabel="Providers" canRequest />;
}
