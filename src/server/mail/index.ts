import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

export interface MailMessage { to: string; subject: string; text: string; html?: string }

/** Email sending seam. Pick the implementation with MAIL_TRANSPORT=file|console|resend|postmark. */
export interface MailTransport {
  readonly name: string;
  send(msg: MailMessage): Promise<void>;
}

/** Dev: writes <MAIL_DEV_DIR>/<ts>-<rand>.json (and .txt) so tests/devs can read the message. Never use in production. */
export class FileTransport implements MailTransport {
  readonly name = "file";
  constructor(private dir: string, private from: string) {}
  async send(msg: MailMessage) {
    fs.mkdirSync(this.dir, { recursive: true });
    const base = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    fs.writeFileSync(path.join(this.dir, `${base}.json`), JSON.stringify({ from: this.from, ...msg, sentAt: new Date().toISOString() }, null, 2));
    fs.writeFileSync(path.join(this.dir, `${base}.txt`), `To: ${msg.to}\nFrom: ${this.from}\nSubject: ${msg.subject}\n\n${msg.text}\n`);
  }
}

export class ConsoleTransport implements MailTransport {
  readonly name = "console";
  constructor(private from: string) {}
  async send(msg: MailMessage) {
    console.log(`[mail] From: ${this.from}\n[mail] To: ${msg.to}\n[mail] Subject: ${msg.subject}\n${msg.text}\n`);
  }
}

/** Resend (https://resend.com/docs/api-reference/emails/send-email). UNTESTED LIVE (no API key available). */
export class ResendTransport implements MailTransport {
  readonly name = "resend";
  constructor(private apiKey: string, private from: string, private fetchFn: typeof fetch = fetch) {}
  async send(msg: MailMessage) {
    const res = await this.fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) throw new Error(`Resend send failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

/** Postmark (https://postmarkapp.com/developer/api/email-api). UNTESTED LIVE (no server token available). */
export class PostmarkTransport implements MailTransport {
  readonly name = "postmark";
  constructor(private token: string, private from: string, private fetchFn: typeof fetch = fetch) {}
  async send(msg: MailMessage) {
    const res = await this.fetchFn("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { "x-postmark-server-token": this.token, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ From: this.from, To: msg.to, Subject: msg.subject, TextBody: msg.text, HtmlBody: msg.html, MessageStream: "outbound" }),
    });
    if (!res.ok) throw new Error(`Postmark send failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

export function createTransport(): MailTransport {
  const m = config.mail;
  switch (m.transport) {
    case "file": return new FileTransport(path.resolve(m.devDir), m.from);
    case "console": return new ConsoleTransport(m.from);
    case "resend":
      if (!m.resendApiKey) throw new Error("MAIL_TRANSPORT=resend requires RESEND_API_KEY");
      return new ResendTransport(m.resendApiKey, m.from);
    case "postmark":
      if (!m.postmarkToken) throw new Error("MAIL_TRANSPORT=postmark requires POSTMARK_SERVER_TOKEN");
      return new PostmarkTransport(m.postmarkToken, m.from);
    default:
      throw new Error("No mail transport configured: set MAIL_TRANSPORT (file|console|resend|postmark)");
  }
}

export const sendMail = (msg: MailMessage) => createTransport().send(msg);
