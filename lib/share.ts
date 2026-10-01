/** Canonical public origin used when copying/displaying share links. Override per environment with NEXT_PUBLIC_SHARE_ORIGIN. */
export const SHARE_ORIGIN = (process.env.NEXT_PUBLIC_SHARE_ORIGIN ?? "https://unveil.link").replace(/\/$/, "");
export const shareUrl = (linkId: string) => `${SHARE_ORIGIN}/u/${linkId}`;
export const shareLabel = (linkId: string) => shareUrl(linkId).replace(/^https?:\/\//, "");

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
