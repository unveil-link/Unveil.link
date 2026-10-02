import { checkUnit } from "../../tests/helpers/copy-scan";
for (const t of ["すぐにダウンロード", "即时下载", "立即下载", "すぐ"]) console.log(JSON.stringify(t), checkUnit({file:"x.tsx",text:t,line:1}).map(h=>h.rule));
console.log("NFKD:", JSON.stringify("すぐ".normalize("NFKD")), "NFC:", JSON.stringify("すぐ".normalize("NFC")));
