// Rule-level coverage of the NEW FE-18c/d rules, each phrase evaluated IN ISOLATION via checkUnit() (production flags: video off, contact placeholder).
// Complements qa-fe8-guard-mutation4.mjs (whole-guard runs; there a phrase placed after the Hero sentence can be caught by a neighbouring rule through the JSX run merge).
// usage (worktree root): npx tsx qa/scripts/qa-fe8-guard-rules.ts
import { checkUnit } from "../../tests/helpers/copy-scan";
const P: Array<[string, string]> = [
  // money / fee
  ["fee", "Keep 90% of every sale."], ["fee", "Keep ninety percent of each sale."], ["fee", "Our cut is just five percent."], ["fee", "Unveil takes only 5%."], ["fee", "Zero commission on your first year."], ["fee", "No fees, ever."], ["fee", "Free to list, free to sell: we only win when you do."], ["fee", "You keep the lot."], ["fee", "0% platform fee"], ["fee", "Commission-free"],
  // payout timing
  ["timing", "Get paid within 48 hours."], ["timing", "Paid weekly."], ["timing", "Payouts land in two working days."], ["timing", "Payouts arrive in 2 business days."], ["timing", "Your money shows up in your account within 2 days."], ["timing", "Cash lands next Tuesday."], ["timing", "Funds are available the same day."],
  ["timing", "Money in your account by Friday."], ["timing", "Payouts are sent every Friday."], ["timing", "Next-day payouts."], ["timing", "Paid out in 3-5 days."], ["timing", "We pay creators within 48 hours."],
  // literal hold / minimum
  ["literal", "A 7-day hold applies to new sales."], ["literal", "A 7 day hold applies to new sales."], ["literal", "Funds are held for 7 days."], ["literal", "Funds are held for a week."], ["literal", "A one-week hold applies."], ["literal", "Pending for seven days."],
  ["literal", "The minimum payout is $25."], ["literal", "The minimum payout is twenty-five dollars."], ["literal", "Minimum is $25."], ["literal", "Payouts start at $25."], ["literal", "Payouts begin from 25 dollars."], ["literal", "You need $25 to cash out."],
  // ssl / id
  ["ssl", "Secured with 256-bit SSL."], ["ssl", "Protected by TLS."], ["ssl", "Browsing is protected by HTTPS."], ["ssl", "HTTPS everywhere."], ["ssl", "Every creator is ID-checked."], ["ssl", "Creators are identity verified."], ["ssl", "Your data is safe with us."], ["ssl", "Bank-grade security."], ["ssl", "AES-256 storage."], ["ssl", "We take security seriously."],
  // support / 24-7
  ["support", "24/7 support for sellers."], ["support", "Support is available around the clock."], ["support", "We’re always here to help."], ["support", "Chat with us anytime."], ["support", "Our team will reply to every message."], ["support", "Questions? Email help@unveil.link."], ["support", "Questions? Email help at unveil dot link."], ["support", "Reach us on Twitter."], ["support", "Contact support if anything goes wrong."],
  // lifetime access
  ["access", "Lifetime access to everything you buy."], ["access", "Your files never expire."], ["access", "Permanent access to every purchase."], ["access", "Yours forever."], ["access", "Access never expires."], ["access", "Buyer protection on every order."], ["access", "Re-download anytime."], ["access", "Keep your purchase for 30 days."],
  // languages
  ["lang", "Recibes tus archivos al momento."], ["lang", "Accesso subito dopo il pagamento."], ["lang", "Мгновенная загрузка файлов."], ["lang", "결제 즉시 다운로드."], ["lang", "Direct toegang tot je bestanden."], ["lang", "Ödemeden hemen sonra indirin."], ["lang", "تحميل فوري."], ["lang", "Natychmiastowy dostęp do plików."], ["lang", "Dateien erhältst du in Sekunden."], ["lang", "Sofortiger Zugriff nach der Zahlung."], ["lang", "Acesso imediato após o pagamento."], ["lang", "Zugang sofort nach Zahlung."], ["lang", "Download immediato."], ["lang", "Téléchargement immédiat."], ["lang", "即时下载"], ["lang", "すぐにダウンロード"], ["lang", "Hemen indir"], ["lang", "Direkt nedladdning"], ["lang", "तुरंत डाउनलोड"],
  // carve-outs
  ["carve", "Receipts are not available yet (we email you one)."], ["carve", "Files land in seconds (link valid for 1 hour)."], ["carve", "Buyers can download the files as a CSV."], ["carve", "Files arrive in seconds - retry if not."], ["carve", "Downloads are not available yet - they unlock instantly later."], ["carve", "Downloads are not available yet (they will be emailed to you)."],
  ["carve", "Receipts are not available yet. They will be emailed."], ["carve", "Receipts are not sent. Buyers get a download link."],
];
const by: Record<string, [number, number]> = {}; let c = 0, b = 0;
for (const [g, t] of P) {
  const hs = checkUnit({ file: "x.tsx", text: t, line: 1 });
  by[g] ??= [0, 0]; if (hs.length) { c++; by[g][0]++; console.log(`CAUGHT  ${g.padEnd(8)} [${[...new Set(hs.map((h) => h.rule))].join(",")}] ${t}`); } else { b++; by[g][1]++; console.log(`BYPASS  ${g.padEnd(8)} ${t}`); }
}
console.log(`SUMMARY isolated phrases: ${c} caught, ${b} bypass, of ${P.length}`);
for (const [g, [x, y]] of Object.entries(by)) console.log(`  ${g}: ${x} caught / ${y} bypass`);
