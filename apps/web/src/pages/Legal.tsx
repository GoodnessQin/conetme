import { Link, useParams } from "react-router-dom";
import { Logo } from "../components/Logo";

export const TERMS_VERSION = "draft-2026-10";
type Doc = { title: string; intro: string; sections: [string, string[]][] };
const DOCS: Record<string, Doc> = {
  terms: {
    title: "Terms of Service",
    intro: "These terms govern your use of ConnectMe. Please read them carefully.",
    sections: [
      ["Who we are", ["ConnectMe is an online marketplace that connects customers with independent service providers. ConnectMe is not the employer of any provider and does not itself perform the services."]],
      ["Accounts", ["You sign in with your phone number. You must give true information and keep your account secure. One person may hold one account per role.", "Providers must pass ConnectMe's verification before taking jobs. We may suspend or remove any account that breaks these terms or puts people at risk."]],
      ["Requests, offers and bookings", ["Customers describe a job. Verified providers may send offers. A booking is formed when a customer accepts an offer. The offer price is the price of the job, except for services that begin with a paid site inspection, where a separate quote follows."]],
      ["Payments", ["The customer pays through ConnectMe. ConnectMe holds the payment and releases it to the provider after the customer confirms the work, or automatically after the review period set in the app if no problem is reported. ConnectMe keeps a service fee, shown to providers before they send an offer.", "Customers and providers agree not to take bookings or payments outside ConnectMe. Contact details are shared only through the app's protected features."]],
      ["Cancellations and refunds", ["A customer may cancel before paying at no cost, and before work starts for a full refund. After a provider has set out, a callout fee of up to 15% of the payment may be kept. If a provider cancels, the customer is refunded in full. Repeated provider cancellations reduce ranking and may lead to suspension."]],
      ["Problems and disputes", ["Either side may report a problem while the job is in progress. Payment stays held while ConnectMe reviews it. ConnectMe may refund the customer, pay the provider, or split the payment, and will explain the decision. Decisions are made fairly on the evidence available."]],
      ["Providers are independent", ["Providers are independent contractors. They set their own prices and methods, and are responsible for their work, tools, taxes and any licences their trade requires."]],
      ["Safety", ["Everyone must follow the Safety Code of Conduct. Providers must arrive as the person verified in the app and ask for the customer's door code before starting work."]],
      ["Liability", ["To the extent the law allows, ConnectMe is not liable for the quality of a provider's work or for losses caused by events outside our reasonable control. Nothing in these terms limits liability that cannot be limited by law."]],
      ["Changes and contact", ["We may update these terms and will tell you in the app. Continuing to use ConnectMe means you accept the updated terms. Questions can be sent to the support contact shown in the app."]],
    ],
  },
  privacy: {
    title: "Privacy Notice",
    intro: "This notice explains what personal data ConnectMe collects, why, and your rights under Nigerian data protection law.",
    sections: [
      ["What we collect", ["Account data: your name, phone number and photo. Booking data: job details, address and map pin, messages, ratings and payment records.", "For providers: identity documents and selfie, National Identification Number (stored only as a one-way code and its last four digits), bank account details, guarantor and reference contacts, address proof, credentials and work photos."]],
      ["Why we use it", ["To run the marketplace, verify providers, protect customers and providers, process payments and payouts, prevent fraud, resolve disputes, send service messages, and meet legal obligations."]],
      ["Who sees it", ["Providers see only a customer's first name and exact address after payment, never the phone number. Customers see a provider's name, photo, ratings, verified badges and work photos. Our review team sees verification documents.", "We share data with service partners who help us operate: payment processors, identity verification providers, SMS and hosting providers. We require them to protect it."]],
      ["Legal basis and consent", ["We process data to perform our contract with you, to meet legal duties, for our legitimate interests in safety and fraud prevention, and with your consent where required, such as for identity checks and for contacting your guarantor and references."]],
      ["Security and retention", ["Documents are stored privately and opened only by authorised staff, and every access is logged. We keep records for as long as needed for the purposes above and the periods the law requires, then delete or anonymise them."]],
      ["Your rights", ["You may ask to access, correct or delete your data, to object to or restrict processing, and to withdraw consent, subject to legal record-keeping duties. You may complain to the Nigeria Data Protection Commission."]],
      ["Contact", ["Contact the data protection contact shown in the app for any privacy request."]],
    ],
  },
  safety: {
    title: "Safety Code of Conduct",
    intro: "ConnectMe exists so that people can let each other into their homes with confidence. Everyone agrees to this code.",
    sections: [
      ["For providers", ["Arrive as the person verified in the app. Never send someone else in your place.", "Ask the customer for the 4-digit door code before you start. Do not start without it.", "Be respectful of the customer's home and property. Do not take photos of people or private items, and do not enter areas you were not asked to.", "Never ask for, or give, personal contact details. Keep all communication in the app.", "Never accept cash or transfers outside ConnectMe.", "Report any incident to ConnectMe straight away."]],
      ["For customers", ["Check the provider's face and name against the app before letting them in.", "Give the door code only to the verified person who asks for it.", "Treat providers with respect. Do not ask for work outside the agreed scope or for payment outside ConnectMe.", "If you ever feel unsafe, leave or ask them to leave, and contact the police and then ConnectMe."]],
      ["What happens if the code is broken", ["Safety reports lead to immediate suspension while we review. Serious breaches are permanent removal and, where the law is broken, are reported to the authorities."]],
    ],
  },
};

export default function Legal() {
  const { doc = "terms" } = useParams();
  const d = DOCS[doc] ?? DOCS.terms!;
  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <Link to="/" aria-label="ConnectMe home"><Logo size={26} /></Link>
      <div className="mt-6 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900"><b>Draft for legal review.</b> This text is a starting point written for ConnectMe. A Nigerian lawyer must review and finalise it before launch.</div>
      <h1 className="mt-6 text-3xl font-extrabold tracking-tight">{d.title}</h1>
      <p className="mt-2 text-muted">{d.intro}</p>
      <p className="mt-1 text-xs text-muted">Version {TERMS_VERSION}</p>
      {d.sections.map(([h, ps]) => (
        <section key={h} className="mt-6"><h2 className="text-lg font-bold">{h}</h2>{ps.map((p, i) => <p key={i} className="mt-2 text-ink/85">{p}</p>)}</section>
      ))}
      <nav className="mt-10 flex flex-wrap gap-4 border-t border-line pt-4 text-sm font-semibold text-brand">
        <Link to="/legal/terms">Terms of Service</Link><Link to="/legal/privacy">Privacy Notice</Link><Link to="/legal/safety">Safety Code</Link>
      </nav>
    </main>
  );
}

export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-muted ${className}`}>
      By continuing you agree to our <a className="font-semibold text-brand" href="/legal/terms" target="_blank" rel="noreferrer">Terms</a>, <a className="font-semibold text-brand" href="/legal/privacy" target="_blank" rel="noreferrer">Privacy Notice</a> and <a className="font-semibold text-brand" href="/legal/safety" target="_blank" rel="noreferrer">Safety Code</a>.
    </p>
  );
}
