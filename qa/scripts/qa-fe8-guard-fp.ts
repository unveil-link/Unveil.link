// False-positive surface of the copy-guard rules (30d6a48): feeds honest / legal-style sentences straight to checkUnit() with production flags (video off, contact placeholder).
// usage (from the worktree): npx tsx qa/scripts/qa-fe8-guard-fp.ts   -> prints ALLOWED / BLOCKED(rule) per sentence
import { checkUnit } from "../../tests/helpers/copy-scan";
const honest: string[] = [
  // legal / policy style
  "You may withdraw your consent at any time.", "We do not guarantee that the service will be uninterrupted.", "We make no guarantee of earnings.", "Unveil does not guarantee that any buyer will purchase.",
  "Payments are processed by a third-party payment processor.", "We may withhold or delay payouts where we suspect fraud.", "Funds may be held while a dispute is open.", "A chargeback reverses the sale and any fees.",
  "You are responsible for the content you upload.", "Sellers must be at least 18 years old.", "We encrypt passwords with bcrypt.", "Data is encrypted in transit.", "You can request deletion of your account at any time.",
  "Certified copies of your ID may be requested.", "We comply with the DMCA and respond to valid notices.", "Send DMCA notices to the designated agent listed below.", "These terms are governed by the laws of the State of New York.",
  "We may update these terms from time to time.", "Refunds are handled case by case.", "We store the email address you give at checkout.", "Cookies are used to keep you signed in.", "Your session lasts 7 days.",
  "Your reset link expires in 60 seconds.", "Try again in 30 seconds.", "Please wait 15 seconds before requesting another code.", "Locked for 15 minutes after too many attempts.",
  // product/UX honest statements
  "Photos only for now: no video.", "Video is not supported yet.", "Receipts are not available yet.", "Downloads are not available yet.", "Delivery options are coming soon.", "Payout requests are coming soon.",
  "Your link is ready to share.", "Share your link anywhere.", "Publish in one click.", "Supports JPG, PNG and WebP.", "Download your sales as CSV.", "Export your earnings as a spreadsheet.", "Files up to 25 MB.",
  "Buyers pay by card — no account needed.", "Pay securely with your card.", "Your card is charged once.", "Sales are final unless the seller agrees otherwise.", "Earnings are shown after fees.",
  "Available balance can be requested once it clears the 7-day hold.", "Pending until the hold ends.", "Sign in to see your earnings.", "Reset your password.", "Create your account.", "Sign up", "Start selling",
  "Photos stay private until a buyer pays.", "Only people with your link can see the preview.", "You choose the price.", "Set a price between $1 and $500.", "Prices are in US dollars.",
  "Contact the seller directly if you have questions about the content.", "Email addresses are never shown to other users.", "We never sell your data.", "Copyright © 2026 Unveil.", "All rights reserved.",
  // plain words that overlap rule tokens
  "Now you can see it.", "Read more", "Download", "Deliver", "Delivered", "Receipt", "Instantly", "Withdraw", "Instant",
];
let allowed = 0, blocked = 0;
for (const t of honest) {
  const hs = checkUnit({ file: "x.tsx", text: t, line: 1 });
  if (hs.length) { blocked++; console.log(`BLOCKED  [${hs.map((h) => h.rule).join(",")}] ${t}`); } else { allowed++; console.log(`ALLOWED  ${t}`); }
}
console.log(`SUMMARY honest strings: ${allowed} allowed, ${blocked} blocked, of ${honest.length}`);
