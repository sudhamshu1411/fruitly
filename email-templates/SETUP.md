# Go-live runbook — fruitly.fit

Do these in order. Steps 1–3 are the ones that break things silently if
skipped; everything after is verification.

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

## 2. Mail sending — the mailboxes are at GoDaddy, and GoDaddy can't do this

GoDaddy sells two email products. Which one you have changes the reason, not the
conclusion. Check under **GoDaddy account → Email & Office**, or:

```bash
dig MX fruitly.fit +short
```

| MX | Product | Why it can't send your auth mail |
|---|---|---|
| `…mail.protection.outlook.com` | Microsoft 365 from GoDaddy | Microsoft permanently disabled basic-auth SMTP submission in Exchange Online in Sept 2025 |
| `smtp.secureserver.net` | Workspace Email (legacy) | works, but the credential *is* the mailbox password, the cap is ~250/day, and the product is being retired |

On Microsoft 365 the only supported route is SMTP AUTH with OAuth 2.0. Supabase's
SMTP form takes a username and a password and nothing else — there is no field
for a token, so there is nothing to configure. This is not a setting to hunt for.

Keep the GoDaddy mailboxes for reading and replying to people. Auth mail goes
through a sender built for it. **Nothing below changes where
`support@fruitly.fit` receives mail.**

### Set up Resend

1. Sign up at `resend.com` — free, no card. **Domains → Add Domain** →
   `fruitly.fit` → pick the region nearest Bengaluru.
2. Resend prints three or four DNS records. Add them at
   **GoDaddy → My Products → Domains → fruitly.fit → DNS → Records**, exactly as
   printed.
3. **API Keys → Create API Key**, name it `fruitly-supabase-auth`, permission
   **Sending access** — not Full access. Shown once.

Then in Supabase, **Project Settings → Authentication → SMTP Settings**, enable
custom SMTP:

```
Sender email:  support@fruitly.fit
Sender name:   Fruitly
Host:          smtp.resend.com
Port:          587
Username:      resend          # the literal word, not an address
Password:      your re_… key
```

### Three things that go wrong at GoDaddy specifically

**The Name field is relative.** Resend displays a full name like
`send.fruitly.fit`; GoDaddy appends the domain itself, so you type only `send`.
Entering the whole thing creates `send.fruitly.fit.fruitly.fit`, which resolves
to nothing and leaves verification failing with no explanation. The apex is `@`.

**Don't touch the existing MX rows.** Those are your mailboxes. Resend's MX sits
on the `send` name — a different host — so the two coexist and mail keeps
arriving.

**Don't add a second SPF record at the apex.** Your apex already has a GoDaddy
SPF row, and two SPF records at one name is a hard fail. Resend's SPF goes on
`send`. If anything ever asks for an apex SPF, merge the `include:` into the
existing row rather than adding another.

---

## 3. DNS — the part that decides whether mail arrives

Without these three records, confirmation emails land in spam, **and anyone can
send mail that appears to come from `order@fruitly.fit`**. For a business that
emails customers about deliveries and payments, that is a phishing vector aimed
at your own customers, not a deliverability nicety.

Add at your DNS host, on the `fruitly.fit` zone:

### SPF and DKIM — both come from Resend
Resend prints these when the domain verifies; you never invent them. Typically:
```
Type: TXT   Name: send                Value: v=spf1 include:amazonses.com ~all
Type: MX    Name: send                Value: <provider-supplied>   Priority: 10
Type: TXT   Name: resend._domainkey   Value: p=<long public key>
```
They all sit on the `send` name, not the apex — which is exactly why they don't
collide with the GoDaddy SPF and MX rows already there. Paste the DKIM value
whole, no line breaks. Add every selector Resend gives you.

### DMARC — what receivers should do when SPF/DKIM fail
Start in report-only so nothing gets blocked while you verify:
```
Type: TXT   Name: _dmarc   Value: v=DMARC1; p=none; rua=mailto:support@fruitly.fit; pct=100
```
Once reports show only your real senders passing — usually a week or two —
tighten to `p=quarantine`, then `p=reject`. **`p=none` protects nobody**; it only
gathers evidence. Finishing the move to `p=reject` is the point.

**Do not add `adkim=s; aspf=s`.** Those demand that the signing domain match
`fruitly.fit` exactly. Resend signs as `send.fruitly.fit`, which satisfies
DMARC's default *relaxed* alignment but fails strict — so with the strict flags set, every message you send fails
DMARC. Harmless at `p=none`, but it means the reports look broken and can never
be cleared, and at `p=reject` it silently destroys all of your own mail.
Relaxed is the default; leaving both flags off is what you want.

### Verify
```bash
dig +short MX fruitly.fit                          # must still be GoDaddy/Outlook
dig +short TXT _dmarc.fruitly.fit
dig +short TXT resend._domainkey.fruitly.fit
```
If the first one no longer shows your mail servers, you edited the wrong row.
Put it back before anything else — that is your inbound mail.
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


---

## 6. Vercel — the domain itself

**Vercel → Project → Settings → Domains**

Add **both** `fruitly.fit` and `www.fruitly.fit`, set `fruitly.fit` as primary.

At your DNS host, use **the exact values Vercel prints on that Domains
screen**. Do not copy them from a blog post: Vercel moved off the old
`76.76.21.21` apex address, so a stale A record points at nothing.

**This part already appears to be done.** As of the last check:
```
fruitly.fit       A      216.198.79.1
www.fruitly.fit   CNAME  …vercel-dns-017.com   (64.29.17.65)
```
Both resolve to Vercel, so unless the dashboard flags an error, leave them
alone.

`vercel.json` also redirects `www` → apex at the edge, so the origin is the
same no matter which one someone types. That is not cosmetic: **a session
created on `www` is a different origin from one on the apex**, and if Supabase's
Site URL is the apex while a customer signed in on `www`, OAuth returns them to
an origin that has no session. Pick one, force it, and use the same one
everywhere below.

---

## 7. Verify it actually works

Once 1–6 are done, walk these in a private window:

| Check | Expect |
|---|---|
| `https://www.fruitly.fit` | redirects to `https://fruitly.fit` |
| Sign up with a real address | confirmation mail arrives, branded, from `support@fruitly.fit` |
| Click the link | lands on `/auth-callback.html`, then your account |
| Click the same link twice | "That link has expired", with a way back |
| Sign in before confirming | "still needs confirming" + a resend button |
| Continue with Google | Google account chooser, then back into the account |
| Forgot password | reset mail arrives, link sets a new password |
| `curl -sI https://fruitly.fit \| grep -i strict-transport` | HSTS header present |

Header check in one go:
```bash
curl -sI https://fruitly.fit | grep -iE 'strict-transport|content-security|x-content-type|referrer-policy|x-frame'
```

Mail authentication check — send yourself a confirmation, then in Gmail use
*Show original* and confirm all three say **PASS**:
```
SPF: PASS    DKIM: PASS    DMARC: PASS
```

---

## Two things left in the code, deliberately

**supabase-js is not version-pinned.** Every page loads
`@supabase/supabase-js@2` from jsDelivr — a floating major version with no
Subresource Integrity hash, on pages that handle the auth session. Pin it:
```bash
V=2.58.0   # check the real latest
curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@$V/dist/umd/supabase.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```
then in every page use `...@$V/...` with `integrity="sha384-<hash>" crossorigin="anonymous"`.
Not done here because this environment's egress blocks the CDN, so the version
and hash could not be verified — and a wrong SRI hash blocks the script and
takes the whole site down.

**Google Fonts is a render-blocking third-party request.** `preconnect` and
`display=swap` already soften it, and the site is only ~67KB of its own bytes,
but self-hosting the four font files under `/assets/fonts/` and serving them
from your own origin removes a DNS+TLS+fetch round trip before first paint —
and stops every visitor's browser contacting Google. Same reason it is not done
here: the font CDN is blocked from this environment.
