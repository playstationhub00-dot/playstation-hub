# Support assistant — setup for Michael

The website chat button and the Facebook Page bot use one assistant. It reads live prices, deposits, and open slots from the shop, and it pauses a chat (and pings you) when someone asks for a person or sends a payment proof.

Production already has `ANTHROPIC_API_KEY` set, and no `OPENAI_API_KEY`. After this deploy the assistant calls Claude with that key. The Page webhook already reads `MESSENGER_PAGE_TOKEN` and `MESSENGER_VERIFY_TOKEN`, so those do not need new names. The built-in script answers only when neither an Anthropic key nor an OpenAI key is present.

## Railway environment variables

In the Railway service for playstation-hub:

| Variable | Required | What it is |
|---|---|---|
| `ANTHROPIC_API_KEY` | For model replies | Already set in production. The assistant calls Claude’s Messages API with tool use when this is present. No other running code reads this variable. |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-haiku-5-5` (fast, tool calling, low cost). Set this to switch models without a code change. |
| `OPENAI_API_KEY` | No | Optional. Used only when `ANTHROPIC_API_KEY` is empty. |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini` when the OpenAI path is the one running. |
| `OPENAI_BASE_URL` | No | Defaults to `https://api.openai.com/v1`. Set this only if you use another OpenAI-compatible host. |
| `MESSENGER_PAGE_TOKEN` | Already set | Page access token the webhook uses to send replies. `FB_PAGE_ACCESS_TOKEN` overrides it when both are set. |
| `MESSENGER_VERIFY_TOKEN` | Already set | Verify token the webhook handshake checks. Put this same value in Meta’s webhook form. `FB_VERIFY_TOKEN` overrides it when both are set. |
| `FB_APP_SECRET` | For webhook signatures | App Secret from the Meta app dashboard. `MESSENGER_APP_SECRET` is the older name and still works. Once a secret is set, posts without a valid `X-Hub-Signature-256` are rejected. |
| `FB_PAGE_INBOX_APP_ID` | No | Defaults to `263902037430900` (Page Inbox). That is the app id Meta uses so a handoff shows up in Business Suite for you to reply. |
| `SITE_URL` | Already used | `https://www.playstation-hub.com` so links in replies point at the real site. |

`ANTHROPIC_API_KEY` wins over `OPENAI_API_KEY` when both exist. With neither key, prices, how to rent, payments, and game slots still come from the database; only the free-form wording is the script.

After saving, Railway redeploys. Check the deploy log for `Messenger webhook verified` the first time Meta calls the site, and for a warning if `FB_APP_SECRET` is still missing.

## Meta app and the Page webhook

1. Open [developers.facebook.com](https://developers.facebook.com/) → **My Apps** → **Create App**. Choose the **Business** type. Name it something you will recognise (for example `PlayStation Hub Support`).
2. Add the **Messenger** product to the app.
3. Under Messenger → **Access Tokens**, connect the PlayStation Hub Page and generate a **Page access token**. Production already sends replies with `MESSENGER_PAGE_TOKEN`; put a new token there (or in `FB_PAGE_ACCESS_TOKEN` if you set that name). Under **App settings → Basic**, copy the **App secret** into `FB_APP_SECRET`.
4. Messenger → **Webhooks** → **Add callback URL**.
   - Callback URL: `https://www.playstation-hub.com/webhook`
   - Verify token: the value already in `MESSENGER_VERIFY_TOKEN` (or `FB_VERIFY_TOKEN` if you set that name). The GET handshake accepts that value.
   - Meta sends a GET to that URL. The site answers only when the token matches.
5. Subscribe the Page to these fields: **messages**, **messaging_postbacks**, **messaging_referrals**, **messaging_handovers**.
6. Handover, so a flagged chat lands in your inbox instead of the bot keeping it:
   - Page settings → **Advanced messaging** → **Handover protocol**
   - **Primary receiver:** this app
   - **Secondary receiver:** Page Inbox
   - When the assistant flags a chat it calls `pass_thread_control` to the Page Inbox. **Resume bot** in admin calls `take_thread_control` and the bot speaks again.
7. In the Page’s Messenger settings, the app must be connected to the PlayStation Hub Page (the same Page as `m.me/PlaystationHub00`).

The existing order links (`m.me/...?ref=PH-1234`) still record which thread belongs to which order. That part did not move.

## Turn off Meta Business AI

Meta’s own agent will answer the Page at the same time as this bot if you leave it on. Turn it off before you rely on the new one.

1. Open [business.facebook.com](https://business.facebook.com/) and select the PlayStation Hub Page.
2. Open **Meta Business Agent** (under All tools, or Inbox). Switch its replies **off**. If you see **Disconnect** or **Pause**, use that.
3. Open **Inbox → Automations**. Turn **off** Instant reply, Away message, and any FAQ bot that would send a second greeting. Those are Meta’s built-in replies, separate from the agent.
4. From a personal Facebook account (not the Page), send the Page “how much is a new game for a week?”. You should get one reply, from this app, with the prices currently saved under admin price categories. You should not also get a “Facebook created this reply” message.
5. Send “ADMIN” (or “I want to talk to a human”). The bot should say it paused the chat for an admin, then go quiet. In `/admin` → **Messaging**, the chat appears under **Support handoffs**, and the bell shows **Support chat needs you**. A Telegram alert fires too, unless you switched **Support handoff** off under Settings → Phone alerts. On Messenger the thread is passed to the Page Inbox. The customer is not sent to an m.me link.
6. Reply to that person from the Page Inbox if you need to. When you are done, press **Resume bot** on that card. The next message is answered by the bot again.

## What the assistant will and will not say

- Prices come from **price categories** (and a game’s own discount, when it has one), plus the deposit and the weekly/monthly promo in Settings. The month figure it quotes is the checkout total: the category’s monthly amount minus Monthly Discount %. New Games at ₱699 with a 10% monthly promo is ₱629 at checkout, and the bot says both numbers. Set that percent to 0 if the category amount is already the price customers pay. Change them in admin and the next reply uses the new numbers. Every amount is written with ₱ (₱349, ₱100), on the website and on Messenger. A percent stays as 10%.
- Filipino and Taglish replies use po. An open slot is “Yes po”; a full one is “Wala po”. English replies stay in English, without po.
- “May slot pa ba?” is a fixed layout, not a paragraph: a hello line, the title, then each account that exists (Non-Trophy, Trophy, and PS4 Primary only when the game runs on PS4) with its slot count and checkout price. A full account says there is no slot and that the waitlist is free. If every account is full, one short line covers the free waitlist and the optional ₱100 priority fee. It does not add the late fee or a waitlist count unless the customer asks. The same spacing (short lines, a blank line between sections) is used for prices, payment, and how-to replies. If the lookup fails, the reply says so and does not invent a number.
- The waitlist is free. An optional ₱100 priority fee moves someone ahead of the free list and is taken off the rent when a slot opens. A Coming Soon game can reserve a slot (list price, paid in full now, nothing more due on release). An open slot on a released game is ordered on the site at the checkout price. There is a 3-hour free trial. Sign-in is a code; the bot never asks for a PSN password. Trophy and PS4 Primary use the refundable deposit (₱100 unless you changed it), and a late return costs the late fee per day from that deposit. Non-Trophy has no deposit.
- Every reply ends with “Reply ADMIN to talk to a person” (Filipino and Taglish: “Reply ADMIN po para makausap ang admin”). ADMIN, “talk to a human”, or “talk to Michael” pauses the bot in this chat.
- Payment screenshots, “I already paid”, refunds, and “talk to a human” always pause the bot, even when the model is off.
- The public chat allows 40 messages per IP each 10 minutes. Messenger allows 40 per person in the same window. Empty, huge, repeated, and link-dump messages are still refused. A paused Messenger chat stays silent even if they keep typing.

## If replies do not show up

- Webhook log says `bad signature`: `FB_APP_SECRET` does not match the app whose token you are using.
- Verify GET returns 403: the verify token in Meta and `MESSENGER_VERIFY_TOKEN` (or `FB_VERIFY_TOKEN`, if set) differ.
- The bot never sends: `MESSENGER_PAGE_TOKEN` (or `FB_PAGE_ACCESS_TOKEN`, if set) is empty or expired. Generate a new Page token.
- Replies stay on the short scripted lines: `ANTHROPIC_API_KEY` is missing or Claude returned an error. Prices and slots still come from the shop data.
- Two replies arrive: Meta Business Agent or Inbox → Automations is still on.
- Handoff does not appear in the inbox: the app is not the Primary receiver, or `messaging_handovers` is not subscribed. The admin card still lists the chat, because the pause flag does not depend on Meta accepting the handover.
