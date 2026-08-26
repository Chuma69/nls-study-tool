// Transactional email via Resend's REST API (no SDK dependency).
// Env-gated: with no RESEND_API_KEY the caller falls back to a copy-and-send link,
// so the invite flow keeps working locally and in demo without email configured.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

type SendResult = { sent: boolean; reason?: string; detail?: string };

function inviteEmailHtml(inviteUrl: string, expiresLabel: string) {
  return `<!doctype html><html><body style="margin:0;background:#f2f5f8;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1c2733;">
    <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
      <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#5b6b7c;margin:0 0 6px;">Call Ready · Bar Part II Prep</p>
      <h1 style="font-size:24px;margin:0 0 14px;color:#12202e;">You're invited to review questions</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
        You've been invited to join the Call Ready expert review panel. Reviewers help verify
        answers to Bar Part II practice questions. Your reviews stay independent and private
        until you submit.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${inviteUrl}" style="display:inline-block;background:#1f5f8b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:9px;font-size:15px;">Accept invitation</a>
      </p>
      <p style="font-size:13px;line-height:1.6;color:#5b6b7c;margin:0 0 6px;">
        Accept using <strong>this email address</strong>. The link expires ${expiresLabel}.
      </p>
      <p style="font-size:12px;line-height:1.6;color:#8a97a4;margin:16px 0 0;word-break:break-all;">
        If the button doesn't work, paste this link into your browser:<br/>${inviteUrl}
      </p>
    </div>
  </body></html>`;
}

export async function sendExpertInviteEmail(to: string, inviteUrl: string, expiresLabel: string): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  // A verified sending domain is required to email arbitrary recipients in production.
  // Until one is set via EXPERT_INVITE_FROM, fall back to Resend's shared test sender.
  const from = process.env.EXPERT_INVITE_FROM || "Call Ready <onboarding@resend.dev>";
  if (!apiKey) return { sent: false, reason: "no_api_key" };
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: "You're invited to review questions on Call Ready",
        html: inviteEmailHtml(inviteUrl, expiresLabel),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { sent: false, reason: "send_failed", detail: detail.slice(0, 300) };
    }
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: "send_error", detail: error instanceof Error ? error.message : String(error) };
  }
}
