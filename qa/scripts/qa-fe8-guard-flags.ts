// readFlags() behaviour on spellings of the flags (VIDEO_UPLOAD "possibly true unless literally false"; contact placeholder detection). usage: npx tsx qa/scripts/qa-fe8-guard-flags.ts (worktree root)
import { readFlags } from "../../tests/helpers/copy-scan";
const v = (src: string, contact = "import { ComingSoon } from 'x'; export default () => <ComingSoon/>") => readFlags((rel) => (rel === "lib/features.ts" ? src : rel === "src/app/contact/page.tsx" ? contact : null));
const rows: Array<[string, string, boolean]> = [ // [label, source, expected videoUpload in the guard's eyes (true = "possibly on")]
  ["literal false;", "export const VIDEO_UPLOAD = false;", false], ["typed boolean = false;", "export const VIDEO_UPLOAD: boolean = false;", false], ["false as const;", "export const VIDEO_UPLOAD = false as const;", false],
  ["false; // comment", "export const VIDEO_UPLOAD = false; // photos only", false], ["false /* c */;", "export const VIDEO_UPLOAD = false /* off */;", false], ["(false)", "export const VIDEO_UPLOAD = (false);", false], ["!true", "export const VIDEO_UPLOAD = !true;", false],
  ["false satisfies boolean", "export const VIDEO_UPLOAD = false satisfies boolean;", false], ["no semicolon, EOF", "export const VIDEO_UPLOAD = false", false], ["= true", "export const VIDEO_UPLOAD = true;", true], ["= false as boolean", "export const VIDEO_UPLOAD = false as boolean;", true],
  ["env driven", 'export const VIDEO_UPLOAD = process.env.NEXT_PUBLIC_VIDEO === "1";', true], ["let VIDEO_UPLOAD = false (mutable)", "export let VIDEO_UPLOAD = false;", false], ["re-export alias", "const V = true; export { V as VIDEO_UPLOAD };", false], ["function getter", "export const VIDEO_UPLOAD = () => true;", true],
  ["second declaration true after false", "export const VIDEO_UPLOAD = false;\nexport const VIDEO_UPLOAD2 = true;", false], ["const false then reassigned via object", "export const VIDEO_UPLOAD = false;\nexport const features = { VIDEO_UPLOAD: true };", false],
];
let bad = 0;
for (const [label, src, expect] of rows) { const got = v(src).videoUpload; const good = got === expect; if (!good) bad++; console.log(`${good ? "AS-EXPECTED" : "DIFFERS    "} videoUpload=${got} (expected ${expect}) :: ${label}`); }
const c = (s: string) => v("export const VIDEO_UPLOAD = false;", s).contactPlaceholder;
for (const [label, page, expect] of [["ComingSoon component", "import { ComingSoon } from 'x'; <ComingSoon/>", true], ["alias import (no 'ComingSoon' text)", "import { Pending } from 'x'; <Pending/>", true], ["text 'Coming soon' in JSX", "<p>Coming soon</p>", true], ["real contact form", "<form><input name='email'/></form>", false], ["placeholder reworded 'Not available yet'", "<p>Not available yet</p>", true]] as Array<[string, string, boolean]>) {
  const got = c(page); console.log(`${got === expect ? "AS-EXPECTED" : "DIFFERS    "} contactPlaceholder=${got} (page really is ${expect ? "a placeholder" : "real"}) :: ${label}`);
}
