import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { PublicShell } from "../components/PublicShell";
import { LocationPicker } from "../components/LocationPicker";
import { ProviderCard } from "../components/ProviderCard";
import { CheckIcon, SearchIcon } from "../components/icons";
import { Skeleton } from "../components/ui";
import { useServices } from "../lib/queries";
import { useBanners, useMarket } from "../lib/market";
import { publicUrl } from "../lib/api";
import type { MarketBanner } from "../lib/types";

const DEFAULT_BANNERS: MarketBanner[] = [
  { id: "d1", title: "Fix it today", subtitle: "Verified plumbers who come to you, with the price agreed before they start.", image_path: null, link: "/browse?service=plumber", sort_order: 1, active: true },
  { id: "d2", title: "Food for every occasion", subtitle: "Book caterers for weddings, parties and office events. Pay only after the event.", image_path: null, link: "/browse?service=caterer", sort_order: 2, active: true },
  { id: "d3", title: "Power that stays on", subtitle: "Solar and inverter installers checked by our team.", image_path: null, link: "/browse?service=solar-installer", sort_order: 3, active: true },
];
const SLIDES = [
  { bg: "bg-brand", fg: "text-white", sub: "text-white/85", btn: "bg-white text-brand" },
  { bg: "bg-ink", fg: "text-white", sub: "text-white/75", btn: "bg-lime text-ink" },
  { bg: "bg-lime", fg: "text-ink", sub: "text-ink/75", btn: "bg-ink text-white" },
] as const;
const STRIPES = { backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,.06) 0 16px, transparent 16px 32px)" };

function BannerCarousel() {
  const live = useBanners().data ?? [];
  const items = live.length ? live : DEFAULT_BANNERS;
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % items.length), 6000); return () => clearInterval(t); }, [items.length]);
  const b = items[i % items.length] ?? DEFAULT_BANNERS[0]!;
  const img = publicUrl("portfolio", b.image_path);
  const t = SLIDES[i % SLIDES.length]!;
  return (
    <div className="relative overflow-hidden rounded-3xl">
      <div className={`flex min-h-[200px] flex-col justify-center px-6 py-8 md:min-h-[240px] md:px-12 ${img ? "text-white" : `${t.bg} ${t.fg}`}`}
        style={img ? { backgroundImage: "linear-gradient(90deg, rgba(11,16,32,.78), rgba(11,16,32,.15)), url(" + img + ")", backgroundSize: "cover", backgroundPosition: "center" } : STRIPES}>
        <h2 className="max-w-xl text-3xl font-extrabold leading-tight tracking-tight md:text-4xl">{b.title}</h2>
        {b.subtitle && <p className={`mt-3 max-w-md text-base ${img ? "text-white/90" : t.sub}`}>{b.subtitle}</p>}
        {b.link && <Link to={b.link} className={`mt-6 inline-flex w-fit rounded-full px-6 py-3 text-sm font-extrabold ${img ? "bg-white text-ink" : t.btn}`}>Explore</Link>}
      </div>
      {items.length > 1 && <div className="absolute bottom-4 right-5 flex gap-1.5">{items.map((x, n) => <button key={x.id} aria-label={`Banner ${n + 1}`} onClick={() => setI(n)} className={`h-2 rounded-full transition-all ${n === i ? "w-6 bg-current opacity-90" : "w-2 bg-current opacity-40"}`} />)}</div>}
    </div>
  );
}

function Row({ title, to, children }: { title: string; to: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <div className="mb-4 flex items-end justify-between"><h2 className="text-2xl font-extrabold tracking-tight">{title}</h2><Link to={to} className="text-sm font-bold text-brand">See all</Link></div>
      {children}
    </section>
  );
}

export default function Marketplace() {
  const { session, loading } = useAuth();
  const nav = useNavigate();
  const services = useServices().data ?? [];
  const [q, setQ] = useState("");
  const [area, setArea] = useState("");
  const [state, setState] = useState("");
  const top = useMarket({ limit: 6 });
  const fresh = useMarket({ sort: "new", limit: 6 });
  if (!loading && session) return <Navigate to="/app" replace />;

  function search(e: React.FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (area) p.set("area", area); else if (state) p.set("state", state);
    nav(`/browse?${p}`);
  }
  const grid = (d: ReturnType<typeof useMarket>) => d.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
    : (d.data ?? []).length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{d.data!.map((c) => <ProviderCard key={c.provider_id} c={c} />)}</div> : null;

  return (
    <PublicShell>
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 md:py-14 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <h1 className="text-[2.5rem] font-extrabold leading-[1.08] tracking-tight text-ink md:text-6xl">Verified pros,<br /><span className="text-brand">at your door.</span></h1>
            <p className="mt-5 max-w-lg text-lg text-muted">Browse plumbers, caterers and solar installers near you. Compare prices and reviews, then book. You do not need an account to look around.</p>
            <form onSubmit={search} className="mt-7 max-w-2xl space-y-3 rounded-2xl border border-line bg-white p-4 shadow-sm">
              <label htmlFor="hero-q" className="sr-only">What do you need?</label>
              <div className="flex items-center gap-3 rounded-xl border border-line px-4 focus-within:border-brand"><SearchIcon size={20} /><input id="hero-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="What do you need? Leaking tap, wedding caterer, inverter" className="w-full bg-transparent py-3.5 text-base focus:outline-none" /></div>
              <LocationPicker value={area} onChange={setArea} onStateChange={setState} allowAny idPrefix="hero" compact />
              <button className="btn">Find providers</button>
            </form>
          </div>
          <aside className="rounded-3xl bg-brand p-7 text-white md:p-9" style={STRIPES}>
            <p className="text-sm font-bold uppercase tracking-[.14em] text-white/70">Why ConnectMe</p>
            <ul className="mt-5 space-y-5">
              {[["ID-checked providers", "Every provider is verified by our team before they can take a job."], ["Your money is held", "The provider is paid only after you confirm the work is done."], ["A door code on arrival", "Only the person who knows your code should come through your gate."]].map(([t, d]) => (
                <li key={t} className="flex gap-4"><span className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full bg-lime text-ink"><CheckIcon size={16} /></span><span><b className="block text-lg leading-snug">{t}</b><span className="text-sm text-white/80">{d}</span></span></li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 pt-10">
        <BannerCarousel />

        <section className="mt-12">
          <h2 className="text-2xl font-extrabold tracking-tight">Browse by service</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {services.map((s, n) => {
              const img = publicUrl("portfolio", s.image_path);
              const t = SLIDES[n % SLIDES.length]!;
              return (
                <Link key={s.id} to={`/browse?service=${s.slug}`} className={`group flex min-h-[112px] items-end justify-between rounded-2xl p-5 ${img ? "text-white" : `${t.bg} ${t.fg}`}`}
                  style={img ? { backgroundImage: "linear-gradient(to top, rgba(11,16,32,.7), rgba(11,16,32,.1)), url(" + img + ")", backgroundSize: "cover" } : STRIPES}>
                  <span><span className="block text-xl font-extrabold leading-tight">{s.name}</span><span className="text-sm opacity-80">{s.pricing_mode === "quote" ? "Free quotes" : "See prices"}</span></span>
                  <span aria-hidden className="text-2xl transition group-hover:translate-x-1">→</span>
                </Link>
              );
            })}
          </div>
        </section>

        <Row title="Top rated near you" to="/browse">{grid(top) ?? <Empty slug={services[0]?.slug ?? "plumber"} />}</Row>
        {(fresh.data ?? []).length > 0 && <Row title="New on ConnectMe" to="/browse?sort=new">{grid(fresh)}</Row>}

        <section className="mt-16 rounded-3xl bg-surface p-6 md:p-10">
          <h2 className="text-2xl font-extrabold tracking-tight">How ConnectMe works</h2>
          <ol className="mt-5 grid gap-5 md:grid-cols-4">
            {[["1", "Find or post", "Pick a provider you like, or describe the job and let providers send offers."], ["2", "Agree the price", "See the full price before you pay. Contact details stay private."], ["3", "Pay safely", "Your money is held by ConnectMe while the work is done."], ["4", "Confirm and rate", "Confirm the work and the provider is paid. Leave a review."]].map(([n, t, d]) => (
              <li key={n}><span className="grid h-9 w-9 place-items-center rounded-full bg-brand text-sm font-extrabold text-white">{n}</span><p className="mt-3 font-bold">{t}</p><p className="mt-1 text-sm text-muted">{d}</p></li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap gap-3"><Link to="/faq" className="rounded-full border-2 border-brand px-5 py-2.5 text-sm font-bold text-brand">Read the FAQ</Link></div>
        </section>

        <section className="mt-12 rounded-3xl bg-ink p-7 text-white md:p-12" style={STRIPES}>
          <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">Do this work for a living?</h2>
          <p className="mt-2 max-w-xl text-white/80">Get verified, get your own page to share, and receive job requests near you. You are paid after every completed job.</p>
          <Link to="/become-a-provider" className="mt-5 inline-flex rounded-full bg-lime px-6 py-3 font-extrabold text-ink">Become a provider</Link>
        </section>
      </div>
    </PublicShell>
  );
}

function Empty({ slug }: { slug: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-line p-8 text-center">
      <p className="text-lg font-bold">Providers are joining now</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">We approve every provider by hand, so the list grows steadily. Post a request and we will tell you the moment someone near you can help.</p>
      <Link to={`/customer/new/${slug}`} className="mt-4 inline-flex rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white">Post a request</Link>
    </div>
  );
}
