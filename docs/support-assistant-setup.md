# Support assistant — setup for Michael

The website chat button and the Facebook Page bot use one assistant. It reads live prices, deposits, and open slots from the shop, and it pauses a chat (and pings you) when someone asks for a person or sends a payment proof.

Nothing here changes production until you set the variables on Railway and point the Page webhook at the site. Do that when you are ready; deploying the code alone keeps the old Page token working and answers from the built-in script until an OpenAI key is set.

## Railway environment variables

In the Railway service for playstation-hub, add:

| Variable | Required | What it is |
|---|---|---|
| `OPENAI_API_KEY` | For model replies | API key from [platform.openai.com](https://platform.openai.com/api-keys). Without it, the assistant still answers prices, how to rent, payments, and game slots from the database. It just does not free-form the wording. |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini` (tool calling, cheap). |
| `OPENAI_BASE_URL` | No | Defaults to `https://api.openai.com/v1`. Set this only if you use another OpenAI-compatible host. |
| `FB_PAGE_ACCESS_TOKEN` | For Messenger replies | Page access token from the Meta app (step 3 below). If this is empty, the app keeps using the existing `MESSENGER_PAGE_TOKEN`. |
| `FB_APP_SECRET` | For webhook signatures | App Secret from the Meta app dashboard. Once this is set, posts without a valid `X-Hub-Signature-256` are rejected. Leave it unset only while you are still testing the old token. |
| `FB_VERIFY_TOKEN` | For the webhook handshake | Any long random string you invent. The same value goes in Meta’s webhook form. If empty, the app uses `MESSENGER_VERIFY_TOKEN`, then `playstation_hub_verify`. |
| `FB_PAGE_INBOX_APP_ID` | No | Defaults to `263902037430900` (Page Inbox). That is the app id Meta uses so a handoff shows up in Business Suite for you to reply. |
| `SITE_URL` | Already used | `https://www.playstation-hub.com` so links in replies point at the real site. |

You do not need to rename `MESSENGER_PAGE_TOKEN` or `MESSENGER_VERIFY_TOKEN` if they are already set. The new `FB_*` names win when both exist.

After saving, Railway redeploys. Check the deploy log for `Messenger webhook verified` the first time Meta calls the site, and for a warning if `FB_APP_SECRET` is still missing.

## Meta app and the Page webhook

1. Open [developers.facebook.com](https://developers.facebook.com/) → **My Apps** → **Create App**. Choose the **Business** type. Name it something you will recognise (for example `PlayStation Hub Support`).
2. Add the **Messenger** product to the app.
3. Under Messenger → **Access Tokens**, connect the PlayStation Hub Page and generate a **Page access token**. Put that value in `FB_PAGE_ACCESS_TOKEN`. Under **App settings → Basic**, copy the **App secret** into `FB_APP_SECRET`.
4. Messenger → **Webhooks** → **Add callback URL**.
   - Callback URL: `https://www.playstation-hub.com/webhook`
   - Verify token: the same string as `FB_VERIFY_TOKEN`
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
5. Send “I want to talk to a human”. The bot should say it flagged Michael, then go quiet. In `/admin` → **Messaging**, the chat appears under **Support handoffs**, and the bell shows **Support chat needs you**. A Telegram alert fires too, unless you switched **Support handoff** off under Settings → Phone alerts.
6. Reply to that person from the Page Inbox if you need to. When you are done, press **Resume bot** on that card. The next message is answered by the bot again.

## What the assistant will and will not say

- Prices come from **price categories** (and a game’s own discount, when it has one), plus the deposit and the weekly/monthly promo in Settings. Change them in admin and the next reply uses the new numbers.
- “Is Elden Ring available?” uses the same slot counts as the game page (Trophy, Non-Trophy, and PS4 Primary only when the game runs on PS4) and a waitlist **count**. It does not see other customers’ names, order refs, or payment details.
- Payment screenshots, “I already paid”, refunds, and “talk to a human” always pause the bot, even when the model is off.
- The public chat allows 12 messages per IP each 10 minutes. Messenger allows 12 per person in the same window. A paused Messenger chat stays silent even if they keep typing.

## If replies do not show up

- Webhook log says `bad signature`: `FB_APP_SECRET` does not match the app whose token you are using.
- Verify GET returns 403: the verify token in Meta and `FB_VERIFY_TOKEN` differ.
- The bot never sends: `FB_PAGE_ACCESS_TOKEN` / `MESSENGER_PAGE_TOKEN` is empty or expired. Generate a new Page token.
- Two replies arrive: Meta Business Agent or Inbox → Automations is still on.
- Handoff does not appear in the inbox: the app is not the Primary receiver, or `messaging_handovers` is not subscribed. The admin card still lists the chat, because the pause flag does not depend on Meta accepting the handover.
