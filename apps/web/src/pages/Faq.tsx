import { useState } from "react";
import { Link } from "react-router-dom";
import { SearchIcon, ChevronIcon } from "../components/icons";

interface QA { q: string; a: string }
const GROUPS: { title: string; items: QA[] }[] = [
  { title: "Getting started", items: [
    { q: "Do I need an account to look around?", a: "No. You can browse providers, read reviews and see prices without signing in. You create a free account only when you post a request, book a provider or save one." },
    { q: "How do I sign up?", a: "Use your phone number or your Google account. With a phone number we text you a 6-digit code. There is no password to remember, and new and returning users follow the same steps." },
    { q: "I did not get my code. What now?", a: "Wait up to a minute, since some networks are slow, then tap “Send a new code”. Check the number is correct and that your phone has network. If it still does not arrive after three tries, use Google sign-in or write to support@connectme.ng." },
    { q: "Which areas do you cover?", a: "We launch one state at a time. You will see the available states when you choose your location. If yours is missing, post a request anyway and we will tell you when providers join near you." },
  ]},
  { title: "Requests and tracking", items: [
    { q: "How do I find a provider?", a: "Two ways. Open a provider’s page and request them directly, or describe the job once and choose up to five providers, or everyone nearby, to send you offers." },
    { q: "How do I track my request?", a: "Open Requests in the menu. Each request shows its stage: open, offers received, accepted or expired. You also get an alert when a provider replies." },
    { q: "How do I track a job after I accept an offer?", a: "Open Jobs. A job moves from paid, to provider on the way, to work in progress, to awaiting your confirmation, to complete. Every step is time-stamped, and you can chat with the provider inside the job." },
    { q: "How long do providers have to answer?", a: "Normal requests stay open for 24 hours and urgent ones for a few hours. If nobody answers, the request expires and you can post it again with a wider area or a different time." },
    { q: "Can I cancel a request?", a: "Yes, any time before you accept an offer and pay. After payment, the cancellation rules in our Terms apply, depending on how far the job has gone." },
  ]},
  { title: "Codes and safety", items: [
    { q: "What is the door code?", a: "After you pay, you receive a 4-digit door code. A provider who arrives must tell you the code. If they cannot, do not let them in and contact support." },
    { q: "What should I check when the provider arrives?", a: "Check their name and photo match the job, and ask for the door code. Providers on ConnectMe have been through ID, address, guarantor and reference checks." },
    { q: "Will the provider see my phone number or address?", a: "Not before you pay. Your address is shared only after payment. Your phone number is shared only if you choose to. Chat filters block phone numbers and chat-app names so conversations stay on ConnectMe." },
    { q: "What if I feel unsafe?", a: "Add a trusted contact in your account. Open the job and use the safety option, or contact support straight away. For emergencies, call the police first." },
  ]},
  { title: "Payments and refunds", items: [
    { q: "When do I pay?", a: "After you accept an offer and see the full price. Nothing is charged while you browse or request quotes." },
    { q: "Is my money safe?", a: "Yes. Your payment is held by ConnectMe through our payment partner, not handed to the provider. It is released only after you confirm the work, or after the review period passes with no complaint." },
    { q: "What does ConnectMe charge?", a: "The price you see is the price you pay. The provider pays ConnectMe a service commission out of their earnings, and any other fee is shown before you pay." },
    { q: "How do I get a refund?", a: "If the provider cancels or does not show, you are refunded in full. If you are unhappy with the work, open a dispute before confirming. Our team reviews the evidence from both sides and can refund all or part of the payment." },
    { q: "How long do refunds take?", a: "We start the refund as soon as it is approved. Your bank decides the final timing, usually within a few working days." },
    { q: "What if the provider says the job is done but I disagree?", a: "Do not confirm. Open a dispute from the job page. The payment stays held while we review messages, photos and the agreed scope." },
  ]},
  { title: "Ratings and reviews", items: [
    { q: "Who can leave a review?", a: "Only customers who completed a job with the provider. Reviews are never bought or removed for being critical." },
    { q: "How do I recommend a provider?", a: "Tap the heart on their card or page to save them, so they are counted as recommended by you. You can also rate them after a job." },
    { q: "Can I share a provider with a friend?", a: "Yes. Tap the share button on any provider page to copy or send their link. Friends can open it without an account." },
  ]},
  { title: "For providers", items: [
    { q: "How do I become a provider?", a: "Choose “Become a provider” at the top of any page, sign in, and complete the registration. You add your services, ID, address proof, a guarantor, references and work photos." },
    { q: "How long does verification take?", a: "Our team reviews applications in the order they arrive, usually within a few working days. If we need more, we tell you exactly what is missing." },
    { q: "What does it cost to join?", a: "Joining is free. ConnectMe takes a commission only on completed jobs." },
    { q: "When do I get paid?", a: "After the customer confirms the job, your earnings are queued and paid to your verified bank account after a short safety period. You can follow every payment on the Earnings page." },
    { q: "Can I change my photo, banner, area or services?", a: "Yes. Changes to your photo, banner, area and services are checked by our team before they go live, so customers can trust what they see. Your tagline and bio you can edit any time." },
    { q: "How do customers find me?", a: "Through search, your service and area, and your own page. Share your page link on WhatsApp, Instagram or your business card so your customers can book you on ConnectMe." },
  ]},
];

function Item({ qa }: { qa: QA }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line">
      <button className="flex w-full items-center justify-between gap-4 py-4 text-left font-bold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {qa.q}<span className={`flex-none transition ${open ? "rotate-180" : ""}`}><ChevronIcon size={20} /></span>
      </button>
      {open && <p className="pb-4 text-ink/80">{qa.a}</p>}
    </div>
  );
}

export default function Faq() {
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !s || (i.q + i.a).toLowerCase().includes(s)) })).filter((g) => g.items.length);
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-4xl font-extrabold tracking-tight">Help and FAQ</h1>
      <p className="mt-2 text-muted">Quick answers about requests, codes, payments and providers.</p>
      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-white px-4"><SearchIcon size={20} /><input aria-label="Search help" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, for example “refund” or “door code”" className="w-full bg-transparent py-3.5 focus:outline-none" /></div>
      {groups.map((g) => (
        <section key={g.title} className="mt-8"><h2 className="text-xl font-extrabold">{g.title}</h2><div className="mt-2 border-t border-line">{g.items.map((i) => <Item key={i.q} qa={i} />)}</div></section>
      ))}
      {groups.length === 0 && <p className="mt-8 text-muted">No answer matches “{q}”. Write to support@connectme.ng and we will help.</p>}
      <div className="mt-10 rounded-3xl bg-surface p-6"><p className="font-extrabold">Still stuck?</p><p className="mt-1 text-sm text-muted">Write to support@connectme.ng with your request or job details and we will reply as soon as we can.</p><Link to="/browse" className="mt-4 inline-flex rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white">Find a provider</Link></div>
    </div>
  );
}
