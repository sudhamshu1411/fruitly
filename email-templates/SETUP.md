# Email and auth setup for fruitly.fit

Everything here is configuration, not code. The code is already deployed and
waiting for it.

---

## 1. Which mailbox does what

| Mailbox | Purpose | Where it appears |
|---|---|---|
| `order@fruitly.fit` | Deliveries and order queries | Site footer, email footers |
| `support@fruitly.fit` | Accounts, sign-in, password trouble | Site footer, both auth emails, every lock-out screen |
| `contact@fruitly.fit` | General enquiries | Site footer |
| `business@fruitly.fit` | Stockists and partnerships | Site footer |

**Auth mail sends from `support@fruitly.fit`.** It is the address a confused
customer will reply to, so it must be a monitored inbox — not a no-reply.

---

## 2. SMTP (Supabase → Project Settings → Authentication → SMTP Settings)

Until this is set, Supabase uses a shared sender that is rate-limited to a
handful of messages an hour and may only deliver to project members. Confirmation
mail will not reach customers.

```
Sender email:  support@fruitly.fit
Sender name:   Fruitly
Host:          <your mail provider's SMTP host>
Port:          587        (STARTTLS — prefer this over 465/implicit TLS)
Username:      support@fruitly.fit
Password:      <an app password / SMTP token, never the mailbox password>
```

Use a dedicated SMTP credential that can be revoked on its own. If the provider
offers a send-only API key, use that rather than the mailbox login.

---

## 3. DNS — the part that decides whether mail arrives

Without these three records, confirmation emails land in spam, **and anyone can
send mail that appears to come from `order@fruitly.fit`**. For a business that
emails customers about deliveries and payments, that is a phishing vector aimed
at your own customers, not a deliverability nicety.

Add at your DNS host, on the `fruitly.fit` zone:

### SPF — who may send as you
```
Type: TXT   Name: @   Value: v=spf1 include:<your-provider's-spf-domain> ~all
```
One SPF record only. If one already exists, merge the `include:` into it — two
SPF records is a hard fail.

### DKIM — cryptographic signature on each message
Your mail provider generates this. Typically:
```
Type: CNAME   Name: <selector>._domainkey   Value: <provider-supplied>
```
Add every selector the provider gives you.

### DMARC — what receivers should do when SPF/DKIM fail
Start in report-only so nothing gets blocked while you verify:
```
Type: TXT   Name: _dmarc   Value: v=DMARC1; p=none; rua=mailto:support@fruitly.fit; pct=100; adkim=s; aspf=s
```
Once reports show only your real senders passing — usually a week or two —
tighten to `p=quarantine`, then `p=reject`. **`p=none` protects nobody**; it only
gathers evidence. Finishing the move to `p=reject` is the point.

### Verify
```bash
dig +short TXT fruitly.fit | grep spf1
dig +short TXT _dmarc.fruitly.fit
dig +short CNAME <selector>._domainkey.fruitly.fit
```
Then send yourself a confirmation and check the headers show
`spf=pass`, `dkim=pass`, `dmarc=pass`.

---

## 4. Supabase Auth settings

**Authentication → URL Configuration**
```
Site URL:       https://fruitly.fit
Redirect URLs:  https://fruitly.fit/auth-callback.html
                https://fruitly.fit/reset.html
```
Supabase refuses to redirect anywhere unlisted, so both flows fail silently
without this. Add the Vercel preview origin too if you still test there.

**Authentication → Sign In / Providers → Email**
- Confirm email: **ON**. This is not optional — see the note below.
- Allow new users to sign up: **ON**. It is the signup path now.

**Authentication → Email Templates**
- *Confirm signup* → paste `email-templates/confirm-signup.html`
- *Reset password* → paste `email-templates/reset-password.html`

Both use `{{ .ConfirmationURL }}`, which Supabase substitutes at send time.

---

## 5. Google sign-in

**Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web)**
```
Authorised JavaScript origins:  https://fruitly.fit
Authorised redirect URIs:       https://vmoymtsfsfurmceycmep.supabase.co/auth/v1/callback
```
The redirect URI is **Supabase's**, not your site's — that trips most people up.
Your own callback page is reached afterwards, via the Redirect URLs in step 4.

Fill in the OAuth consent screen (app name, support email
`support@fruitly.fit`, logo) before going live, or Google shows an unverified-app
warning to customers.

Then **Supabase → Authentication → Sign In / Providers → Google**: paste the
Client ID and Client Secret, enable.

---

## Why confirmation must stay ON once Google is enabled

Supabase automatically links identities that share an email address, and only
drops *unconfirmed* ones when it does. With confirmation off, someone could
register `you@gmail.com` with a password of their choosing, wait for you to
"Continue with Google", and keep a working password on your account — a
pre-account-takeover. Confirmation is what closes it.
