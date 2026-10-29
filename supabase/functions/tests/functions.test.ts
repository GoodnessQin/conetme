// Run (needs Deno):  CM_TEST=1 deno test -A supabase/functions/tests
// Handlers are exercised against a stubbed fetch that plays the roles of Supabase and Paystack.
Deno.env.set("CM_TEST", "1");
Deno.env.set("SUPABASE_URL", "http://sb.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");

// Tiny assertions so the tests need no network packages.
function assert(cond: unknown, msg = "assertion failed"): asserts cond { if (!cond) throw new Error(msg); }
function assertEquals(a: unknown, b: unknown, msg = "") { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg} expected ${y} but got ${x}`); }

type Call = { url: URL; method: string; body: any };
function stub(route: (c: Call) => Response | undefined): Call[] {
  const calls: Call[] = [];
  (globalThis as any).fetch = (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    let body: any; try { body = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { body = String(init?.body); }
    const c = { url, method: init?.method ?? "GET", body };
    calls.push(c);
    return Promise.resolve(route(c) ?? new Response("{}", { status: 404 }));
  };
  return calls;
}
const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const rpcName = (c: Call) => c.url.pathname.replace("/rest/v1/rpc/", "");

const webhook = await import("../paystack-webhook/index.ts");
const init = await import("../paystack-init/index.ts");
const runner = await import("../finance-runner/index.ts");
const bank = await import("../resolve-bank/index.ts");
const kyc = await import("../kyc-identity/index.ts");
const notify = await import("../dispatch-notification/index.ts");

Deno.test("HMAC-SHA512 matches a published test vector", async () => {
  assertEquals(await webhook.hmacSha512Hex("key", "The quick brown fox jumps over the lazy dog"),
    "b42af09057bac1e2d41708e48a902e09b5ff7f12ab428a4fe86653c73dd248fb82f948a549f7b791a5b41915ee4d1ec3935357e4e2317250d0372afa2ebeeb3a");
  assert(webhook.timingSafeEqual("abc", "abc")); assert(!webhook.timingSafeEqual("abc", "abd")); assert(!webhook.timingSafeEqual("abc", "ab"));
});

Deno.test("webhook: rejects a bad or missing signature and never touches the database", async () => {
  Deno.env.set("PAYSTACK_SECRET_KEY", "sk_test_secret");
  const calls = stub(() => ok(true));
  const body = JSON.stringify({ event: "charge.success", data: { reference: "cmabc", amount: 1000 } });
  assertEquals((await webhook.handler(new Request("http://x", { method: "POST", body }))).status, 401);
  assertEquals((await webhook.handler(new Request("http://x", { method: "POST", body, headers: { "x-paystack-signature": "deadbeef" } }))).status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("webhook: a signed charge.success applies the payment once", async () => {
  Deno.env.set("PAYSTACK_SECRET_KEY", "sk_test_secret");
  const calls = stub((c) => (rpcName(c) === "log_webhook" ? ok(true) : rpcName(c) === "apply_payment_success" ? ok("ok") : rpcName(c) === "finish_webhook" ? ok(null) : undefined));
  const body = JSON.stringify({ event: "charge.success", data: { reference: "cmabc123", amount: 800000, fees: 12000 } });
  const sig = await webhook.hmacSha512Hex("sk_test_secret", body);
  const res = await webhook.handler(new Request("http://x", { method: "POST", body, headers: { "x-paystack-signature": sig } }));
  assertEquals(res.status, 200);
  const apply = calls.find((c) => rpcName(c) === "apply_payment_success")!;
  assertEquals(apply.body.p_reference, "cmabc123"); assertEquals(apply.body.p_amount_kobo, 800000); assertEquals(apply.body.p_fee_kobo, 12000);
});

Deno.test("webhook: a replayed event is acknowledged but not applied again", async () => {
  Deno.env.set("PAYSTACK_SECRET_KEY", "sk_test_secret");
  const calls = stub((c) => (rpcName(c) === "log_webhook" ? ok(false) : ok(null)));
  const body = JSON.stringify({ event: "charge.success", data: { reference: "cmabc123", amount: 800000 } });
  const sig = await webhook.hmacSha512Hex("sk_test_secret", body);
  const res = await webhook.handler(new Request("http://x", { method: "POST", body, headers: { "x-paystack-signature": sig } }));
  assertEquals(res.status, 200);
  assertEquals(calls.filter((c) => rpcName(c) === "apply_payment_success").length, 0);
});

Deno.test("webhook: a mismatched amount is recorded as an error for finance", async () => {
  Deno.env.set("PAYSTACK_SECRET_KEY", "sk_test_secret");
  const calls = stub((c) => (rpcName(c) === "log_webhook" ? ok(true) : rpcName(c) === "apply_payment_success" ? ok("amount_mismatch") : ok(null)));
  const body = JSON.stringify({ event: "charge.success", data: { reference: "cmbad", amount: 1 } });
  await webhook.handler(new Request("http://x", { method: "POST", body, headers: { "x-paystack-signature": await webhook.hmacSha512Hex("sk_test_secret", body) } }));
  assertEquals(calls.find((c) => rpcName(c) === "finish_webhook")!.body.p_error, "charge.success amount_mismatch");
});

Deno.test("checkout: payer email and Paystack body", () => {
  assertEquals(init.payerEmail("ada@example.com", "11111111-2222-3333-4444-555555555555", "pay.x.ng"), "ada@example.com");
  assertEquals(init.payerEmail(null, "11111111-2222-3333-4444-555555555555", "pay.x.ng"), "u1111111122223333@pay.x.ng");
  const b = init.buildInitBody({ reference: "cmabc", amountKobo: 1200000, email: "a@b.co", callbackUrl: "https://app/x", jobId: "j", paymentId: "p", label: "Deposit" });
  assertEquals(b.amount, 1200000); assertEquals(b.currency, "NGN"); assertEquals(b.metadata.milestone, "Deposit");
});

Deno.test("checkout: refuses when not configured, and when not signed in", async () => {
  Deno.env.delete("PAYSTACK_SECRET_KEY"); Deno.env.delete("APP_URL");
  assertEquals((await init.handler(new Request("http://x", { method: "POST", body: "{}" }))).status, 501);
  Deno.env.set("PAYSTACK_SECRET_KEY", "sk_test"); Deno.env.set("APP_URL", "https://app.test");
  stub((c) => (c.url.pathname.includes("/auth/v1/user") ? ok({ message: "no" }, 401) : undefined));
  assertEquals((await init.handler(new Request("http://x", { method: "POST", body: "{}" }))).status, 401);
});

Deno.test("payouts: forbidden without the cron secret or a finance login", async () => {
  Deno.env.set("CRON_SECRET", "cron123");
  stub((c) => (rpcName(c) === "finance_ok" ? ok(false) : ok({})));
  assertEquals((await runner.handler(new Request("http://x", { method: "POST" }))).status, 403);
  assertEquals((await runner.handler(new Request("http://x", { method: "POST", headers: { "x-cron-secret": "wrong" } }))).status, 403);
});

Deno.test("payouts: nothing is sent while payment mode is test", async () => {
  Deno.env.set("CRON_SECRET", "cron123");
  const calls = stub((c) => (c.url.pathname.endsWith("/settings") ? ok({ value: "test" }) : ok([])));
  const res = await runner.handler(new Request("http://x", { method: "POST", headers: { "x-cron-secret": "cron123" } }));
  assertEquals((await res.json()).skipped !== undefined, true);
  assertEquals(calls.some((c) => c.url.host.includes("paystack")), false);
});

Deno.test("payouts: creates a recipient, sends the transfer with an idempotent reference, records success", async () => {
  Deno.env.set("CRON_SECRET", "cron123"); Deno.env.set("PAYSTACK_SECRET_KEY", "sk_test");
  const calls = stub((c) => {
    if (c.url.pathname.endsWith("/settings")) return ok({ value: "paystack" });
    if (rpcName(c) === "claim_payouts") return ok([{ payout_id: "po1", reference: "po-abc", net_kobo: 900000, provider_id: "pr1", bank_name: "Guaranty Trust Bank", bank_code: null, account_number: "0123456789", account_name: "CHIDI OKAFOR", recipient_code: null }]);
    if (rpcName(c) === "claim_refunds") return ok([]);
    if (c.url.host === "api.paystack.co" && c.url.pathname === "/bank") return ok({ status: true, data: [{ name: "Guaranty Trust Bank", code: "058" }] });
    if (c.url.pathname === "/transferrecipient") return ok({ status: true, data: { recipient_code: "RCP_1" } });
    if (c.url.pathname === "/transfer") return ok({ status: true, data: { status: "success", transfer_code: "TRF_1" } });
    return ok(null);
  });
  const res = await (await runner.handler(new Request("http://x", { method: "POST", headers: { "x-cron-secret": "cron123" } }))).json();
  assertEquals(res.payouts_sent, 1);
  const t = calls.find((c) => c.url.pathname === "/transfer")!;
  assertEquals(t.body.reference, "po-abc"); assertEquals(t.body.amount, 900000); assertEquals(t.body.recipient, "RCP_1");
  assertEquals(calls.find((c) => rpcName(c) === "mark_payout_sent")!.body.p_transfer_code, "TRF_1");
  assertEquals(calls.find((c) => rpcName(c) === "save_recipient_code")!.body.p_bank_code, "058");
});

Deno.test("payouts: a rejected transfer is recorded as a retryable failure, never as sent", async () => {
  Deno.env.set("CRON_SECRET", "cron123"); Deno.env.set("PAYSTACK_SECRET_KEY", "sk_test");
  const calls = stub((c) => {
    if (c.url.pathname.endsWith("/settings")) return ok({ value: "paystack" });
    if (rpcName(c) === "claim_payouts") return ok([{ payout_id: "po2", reference: "po-x", net_kobo: 500000, provider_id: "pr1", bank_name: "Zenith", bank_code: "057", account_number: "0123456789", account_name: "A B", recipient_code: "RCP_9" }]);
    if (rpcName(c) === "claim_refunds") return ok([]);
    if (c.url.pathname === "/transfer") return ok({ status: false, message: "Insufficient balance" }, 400);
    return ok(null);
  });
  const res = await (await runner.handler(new Request("http://x", { method: "POST", headers: { "x-cron-secret": "cron123" } }))).json();
  assertEquals(res.payouts_failed, 1);
  assertEquals(calls.some((c) => rpcName(c) === "mark_payout_sent"), false);
  assertEquals(calls.find((c) => rpcName(c) === "mark_payout_failed")!.body.p_final, false);
});

Deno.test("refunds: sent through Paystack against the original payment", async () => {
  Deno.env.set("CRON_SECRET", "cron123"); Deno.env.set("PAYSTACK_SECRET_KEY", "sk_test");
  const calls = stub((c) => {
    if (c.url.pathname.endsWith("/settings")) return ok({ value: "paystack" });
    if (rpcName(c) === "claim_payouts") return ok([]);
    if (rpcName(c) === "claim_refunds") return ok([{ refund_id: "rf1", amount_kobo: 800000, payment_reference: "cmabc", payment_provider: "paystack" }]);
    if (c.url.pathname === "/refund") return ok({ status: true, data: { id: 555 } });
    return ok(null);
  });
  const res = await (await runner.handler(new Request("http://x", { method: "POST", headers: { "x-cron-secret": "cron123" } }))).json();
  assertEquals(res.refunds_sent, 1);
  assertEquals(calls.find((c) => c.url.pathname === "/refund")!.body, { transaction: "cmabc", amount: 800000 });
});

Deno.test("bank matching and name comparison", () => {
  const banks = [{ name: "Guaranty Trust Bank", code: "058" }, { name: "Kuda Microfinance Bank", code: "50211" }, { name: "OPay Digital Services Limited (OPay)", code: "999992" }, { name: "Zenith Bank", code: "057" }];
  assertEquals(bank.matchBank("Guaranty Trust Bank (GTBank)", banks)?.code, "058");
  assertEquals(bank.matchBank("Kuda Microfinance Bank", banks)?.code, "50211");
  assertEquals(bank.matchBank("OPay", banks)?.code, "999992");
  assertEquals(bank.matchBank("Zenith Bank", banks)?.code, "057");
  assertEquals(bank.matchBank("Nonexistent Bank", banks), null);
  assert(bank.nameScore("OKAFOR CHIDI", "Chidi Emeka Okafor") >= 0.66);
  assert(bank.nameScore("ADE BOLA", "Chidi Okafor") < 0.4);
  assertEquals(runner.matchBankCode("Zenith", banks), "057");
});

Deno.test("identity: Dojah response parsing and decisions never auto-reject", () => {
  const p = kyc.parseDojah({ entity: { first_name: "CHIDI", last_name: "OKAFOR", selfie_verification: { confidence_value: 98.4, match: true } } });
  assertEquals(p.fullName, "CHIDI OKAFOR"); assertEquals(p.match, true); assertEquals(p.confidence, 98.4);
  assertEquals(kyc.evaluateFace(true, 98.4).status, "pass");
  assertEquals(kyc.evaluateFace(true, 75).status, "review");
  assertEquals(kyc.evaluateFace(false, 20).status, "review");
  assertEquals(kyc.evaluateFace(undefined, undefined).status, "review");
  assertEquals(kyc.evaluateNin(true, 1).status, "pass");
  assertEquals(kyc.evaluateNin(true, 0.2).status, "review");
  assertEquals(kyc.evaluateNin(false, 0).status, "review");
  assertEquals(kyc.parseDojah({}).found, false);
  assertEquals(kyc.toBase64(new Uint8Array([72, 105])), "SGk=");
});

Deno.test("identity: without keys the NIN is saved and checks stay manual; selfie path must belong to the user", async () => {
  Deno.env.delete("KYC_PROVIDER");
  const calls = stub((c) => (c.url.pathname.includes("/auth/v1/user") ? ok({ id: "u1", aud: "authenticated", role: "authenticated" }) : rpcName(c) === "save_nin_for" ? ok("case1") : undefined));
  const res = await kyc.handler(new Request("http://x", { method: "POST", body: JSON.stringify({ nin: "70123456789", id_type: "nin_slip", selfie_path: "someone-else/selfie.jpg" }) }));
  assertEquals((await res.json()).mode, "manual");
  assert(!calls.some((c) => c.url.host.includes("dojah")));
  assertEquals((await kyc.handler(new Request("http://x", { method: "POST", body: JSON.stringify({ nin: "123", id_type: "nin_slip" }) }))).status, 400);
});

Deno.test("alerts: messages never contain names, addresses or phone numbers", () => {
  const all = ["new_request", "offer_received", "offer_accepted", "job_paid", "job_update", "provider_approved", "provider_needs_info", "provider_rejected", "provider_suspended", "payout_sent", "payment_released", "refund_sent", "quote_received", "quote_accepted", "dispute_opened", "dispute_resolved", "job_cancelled", "auto_confirmed", "new_message"];
  for (const t of all) { const m = notify.smsFor(t, { service: "Plumber", status: "arrived", net_kobo: 1080000, amount_kobo: 800000 }); assert(m && m.length < 160, t); assert(!/\d{9,}/.test(m!), t); }
  assertEquals(notify.smsFor("payout_sent", { net_kobo: 1080000 }), "Your ConnectMe payout of ₦10,800 has been sent to your bank account.");
  assertEquals(notify.smsFor("something_else", {}), null);
  assertEquals(notify.e164("2348125936932"), "+2348125936932"); assertEquals(notify.e164("08125936932"), "+2348125936932");
});

Deno.test("alerts: only the secret holder can trigger a text, and Sendchamp gets the documented request", async () => {
  Deno.env.set("WEBHOOK_SECRET", "whs"); Deno.env.set("SMS_PROVIDER", "sendchamp"); Deno.env.set("SENDCHAMP_API_KEY", "sc_key");
  assertEquals((await notify.handler(new Request("http://x", { method: "POST", body: "{}" }))).status, 403);
  const calls = stub((c) => {
    if (c.url.pathname.endsWith("/profiles")) return ok({ phone: "2348125936932", sms_alerts: true });
    if (c.url.host === "api.sendchamp.com") return ok({ status: "success" });
    return ok([]);
  });
  const res = await notify.handler(new Request("http://x", { method: "POST", headers: { "x-webhook-secret": "whs" }, body: JSON.stringify({ record: { id: "n1", user_id: "u1", type: "new_request", payload: { service: "Plumber" } } }) }));
  assertEquals((await res.json()).sms, "sent");
  const sc = calls.find((c) => c.url.host === "api.sendchamp.com")!;
  assertEquals(sc.url.pathname, "/api/v1/sms/send"); assertEquals(sc.body.to, ["+2348125936932"]); assertEquals(sc.body.route, "dnd");
});
