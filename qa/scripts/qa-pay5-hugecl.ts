// @ts-nocheck
import net from "node:net";
import { makeSeller, makeDrop, db, done } from "./qa-pay5-lib";
(async () => { const s = await makeSeller("hugecl"); const dr = await s.http.json("POST", "/api/drops", { json: { title: "d", priceCents: 1000 } }); const id = dr.json.drop.id; const cookie = [...s.http.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
 const sock = net.connect(3917, "127.0.0.1"); let buf = ""; sock.on("data", (d) => (buf += d)); sock.write(`POST /api/drops/${id}/files HTTP/1.1\r\nHost: localhost:3917\r\nCookie: ${cookie}\r\nContent-Type: multipart/form-data; boundary=x\r\nContent-Length: 999999999999\r\nConnection: close\r\n\r\n--x`); await new Promise((r) => setTimeout(r, 1500)); console.log("huge declared Content-Length upload ->", buf.split("\r\n")[0]); sock.destroy(); await done(); })();
