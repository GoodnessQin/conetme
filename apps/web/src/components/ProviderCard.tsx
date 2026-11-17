import { Link } from "react-router-dom";
import { formatNaira } from "@connectme/shared";
import type { MarketCard } from "../lib/types";
import { publicUrl, messageFrom } from "../lib/api";
import { providerUrl, shareLink } from "../lib/entry";
import { useLikes } from "../lib/likes";
import { Avatar, Stars, useToast } from "./ui";
import { HeartIcon, PinIcon, ShareIcon } from "./icons";

/** Flat brand colours for providers who have no banner yet. */
const FLAT = [
  { bg: "bg-brand", fg: "text-white" },
  { bg: "bg-ink", fg: "text-white" },
  { bg: "bg-lime", fg: "text-ink" },
] as const;
const flat = (seed: string) => FLAT[[...seed].reduce((n, c) => n + c.charCodeAt(0), 0) % FLAT.length]!;
const STRIPES = { backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,.07) 0 14px, transparent 14px 28px)" };

/** Banner photo, then the service picture, then a flat brand colour. Never an empty grey box. */
export function Cover({ banner, service, seed, label, className = "h-36" }: { banner?: string | null; service?: string | null; seed: string; label?: string; className?: string }) {
  const src = publicUrl("portfolio", banner) ?? publicUrl("portfolio", service);
  if (src) return <img src={src} alt="" loading="lazy" className={`w-full object-cover ${className}`} />;
  const c = flat(seed);
  return (
    <div aria-hidden className={`flex w-full items-end p-4 ${c.bg} ${c.fg} ${className}`} style={STRIPES}>
      {label && <span className="text-xs font-bold uppercase tracking-[.14em] opacity-80">{label}</span>}
    </div>
  );
}

export function LikeShare({ id, name, slug, liked }: { id: string; name: string; slug: string; liked: boolean }) {
  const { toggle } = useLikes();
  const toast = useToast();
  const cls = "grid h-9 w-9 place-items-center rounded-full bg-white text-ink shadow-sm ring-1 ring-black/5 transition hover:scale-105";
  return (
    <div className="flex gap-2">
      <button type="button" aria-label={liked ? `Remove ${name} from saved` : `Save ${name}`} aria-pressed={liked} className={`${cls} ${liked ? "!text-danger" : ""}`}
        onClick={async (e) => { e.preventDefault(); e.stopPropagation(); try { await toggle(id, name); } catch (x) { toast(messageFrom(x)); } }}><HeartIcon size={18} filled={liked} /></button>
      <button type="button" aria-label={`Share ${name}`} className={cls}
        onClick={async (e) => { e.preventDefault(); e.stopPropagation(); const r = await shareLink(`${name} on ConnectMe`, `Book ${name}, a verified provider on ConnectMe.`, providerUrl(slug)); if (r === "copied") toast("Link copied. Paste it anywhere to share."); if (r === "failed") toast("Could not share. Copy the link from your browser."); }}><ShareIcon size={17} /></button>
    </div>
  );
}

export function ProviderCard({ c }: { c: MarketCard }) {
  const { liked } = useLikes();
  const isLiked = liked.has(c.provider_id) || c.liked;
  return (
    <Link to={`/pro/${c.slug}`} className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-white transition hover:border-brand/40 hover:shadow-md">
      <div className="relative">
        <Cover banner={c.banner_path} service={c.service_image} seed={c.service_name} label={c.service_name} className="aspect-[16/8]" />
        <div className="absolute right-3 top-3"><LikeShare id={c.provider_id} name={c.name} slug={c.slug} liked={isLiked} /></div>
        {c.featured && <span className="absolute left-3 top-3 rounded-full bg-lime px-3 py-1 text-xs font-extrabold text-ink">Featured</span>}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-3">
          <Avatar name={c.name} path={c.avatar_path} size={44} />
          <div className="min-w-0">
            <p className="truncate font-extrabold leading-tight group-hover:text-brand">{c.name}</p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted"><PinIcon size={14} />{c.area ?? "Nigeria"}{c.available_today && <span className="ml-1 font-semibold text-success">· Available today</span>}</p>
          </div>
        </div>
        <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-ink/80">{c.tagline || `${c.service_name}, verified by ConnectMe`}</p>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 text-sm">
          <Stars value={c.rating_avg} count={c.rating_count} />
          {c.from_price_kobo ? <span className="whitespace-nowrap text-muted">from <b className="text-ink">{formatNaira(c.from_price_kobo)}</b></span> : null}
        </div>
      </div>
    </Link>
  );
}
