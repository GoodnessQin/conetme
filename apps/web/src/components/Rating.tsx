import { useState } from "react";
import { Button } from "./ui";

export const RATING_LABELS = ["", "Terrible", "Bad", "Okay", "Good", "Excellent"] as const;
export const PROVIDER_TAGS = { good: ["On time", "Professional", "Clean work", "Fair price", "Friendly", "Skilled"], bad: ["Late", "Poor quality", "Overpriced", "Rude", "Messy", "No show"] };
export const CUSTOMER_TAGS = { good: ["Friendly", "Clear access", "Easy to deal with"], bad: ["Rude"] };

export function StarRow({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} out of 5`} style={{ fontSize: size, lineHeight: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= Math.round(value) ? "text-amber-500" : "text-line"}>★</span>)}
    </span>
  );
}

/** Tap a star: the scale label appears (Terrible, Bad, Okay, Good, Excellent) and relevant tags are offered. */
export function RatingInput({ who, tags, busy, error, onSubmit }: {
  who: string; tags: { good: readonly string[]; bad: readonly string[] }; busy: boolean; error?: string;
  onSubmit: (v: { stars: number; comment: string; tags: string[] }) => void;
}) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const offered = stars >= 4 ? tags.good : stars > 0 && stars <= 2 ? tags.bad : stars === 3 ? [...tags.good.slice(0, 3), ...tags.bad.slice(0, 3)] : [];
  const toggle = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : p.length >= 5 ? p : [...p, t]));
  return (
    <div className="text-center">
      <p className="text-xl font-extrabold" aria-live="polite">{stars ? RATING_LABELS[stars] : `How was it with ${who}?`}</p>
      {stars > 0 && <p className="text-sm text-muted">Tap a different star to change it.</p>}
      <div className="my-3 flex justify-center gap-2" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? "s" : ""}, ${RATING_LABELS[n]}`}
            onClick={() => { setStars(n); setPicked([]); }} className={`text-5xl leading-none transition ${n <= stars ? "text-amber-500" : "text-line"}`}>★</button>
        ))}
      </div>
      {offered.length > 0 && (
        <div className="mb-3 flex flex-wrap justify-center gap-2">
          {offered.map((t) => <button key={t} type="button" aria-pressed={picked.includes(t)} onClick={() => toggle(t)} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${picked.includes(t) ? "border-brand bg-brand-50 text-brand" : "border-line bg-white"}`}>{t}</button>)}
        </div>
      )}
      {stars > 0 && <textarea aria-label="Comment" rows={3} className="input text-left" maxLength={400} placeholder="Add a comment (optional). No phone numbers." value={comment} onChange={(e) => setComment(e.target.value)} />}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <Button className="mt-3" disabled={!stars} loading={busy} onClick={() => onSubmit({ stars, comment, tags: picked })}>Submit rating</Button>
    </div>
  );
}
