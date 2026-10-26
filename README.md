# Appa Translator (English · தமிழ் · Melayu)

A small personal translator for daily use, built for an elderly user. It translates English, Tamil and Malay in any direction. It's a static web app (HTML/CSS/JS) with no build step, no server and no secret keys.

## Features
- **Paragraph mode** is the default for English→Tamil and available for every pair. Paste a multi-paragraph letter or bank notice and it splits on blank lines (long paragraphs are split again into sentence chunks of ≤450 characters). Each paragraph is translated in turn with a progress bar. Results show the English paragraph above its Tamil translation, each with its own **Copy** and **Play**. **Copy all Tamil** and **Share all** buttons sit above the list. The other mode, **Quick**, is for short phrases. The app remembers which mode you last used for each language pair.
- **Numbers are always preserved exactly.** Before translating, the app masks amounts (`RM 1,250.00`, `RM0.50`, `$`, `MYR`…), dates (`26/10/2026`, `26 October 2026`, `Oct 30, 2026`), times (`14:35`), account, card, reference and phone numbers (`5123-4567-8901`, `****5678`, `TXN20261026-88341`, `1-300-88-6688`), percentages and any other token containing a digit. It also masks My words. These are replaced with `[1]`, `[2]`… placeholders and put back afterwards. If any placeholder doesn't come back, the paragraph shows a yellow “⚠ Check these numbers/words” note.
- **Daily quota counter** at the top: “Today: X / 5,000 free characters used”. It turns orange at 75% and red when the limit is reached. A prominent box offers to add an email, which raises the limit to 50,000/day. When MyMemory reports the quota is used up, a red banner says so in English, Tamil and Malay. Any remaining paragraphs are marked “Not translated (limit reached)” and the ones already translated are kept.
- Big From / To pickers with a ⇅ swap button. Labels are in English with Tamil and Malay hints.
- **Type**, **Speak** (Web Speech API: en-MY→en-US, ta-IN, ms-MY), or **Photo** (Tesseract.js OCR from a CDN: eng, tam+eng, msa+eng). You can edit the OCR text before translating.
- Output in large text, with **Play** (speechSynthesis, picks a matching voice), **Copy**, and **Share** (native share sheet, or WhatsApp link as a fallback).
- **History**: the last 50 translations are saved in localStorage. Tap one to reuse it.
- **My words**: a glossary of names and medicines that are kept as-is, or replaced with your preferred word.
- PWA: the manifest and service worker let you "Add to Home screen". The app shell works offline, but translating needs internet.
- Settings: an optional email for MyMemory (raises the free quota) and a text size of Large, Larger or Largest.

## Run locally
```bash
cd dad-translator
python3 -m http.server 8765
# open http://localhost:8765 (or http://<computer-LAN-IP>:8765 from a phone on the same Wi-Fi)
```
The microphone, service worker/install, and clipboard need **HTTPS** (or localhost). Over a plain LAN IP, typing, photo and translate still work, but speech input and install may be blocked. Host it on HTTPS (below) for real phone use.

## Translation engines (pluggable)
`translateEngine(text, from, to)` in `app.js` is the single entry point. It dispatches to the `ENGINES` table:

| id | Engine | Status |
|---|---|---|
| `mymemory` | MyMemory, free, no key (default) | ✅ tested |
| `google` | Google Cloud Translation Basic v2 (`translate/v2?key=`) | code ready, untested (no key) |
| `gemini` | Gemini API `gemini-3.1-flash-lite` (`generateContent`, `x-goog-api-key`) | code ready, untested (no key) |
| `xai` | xAI Grok API `grok-4.3` (OpenAI-compatible `/v1/chat/completions`) | code ready, untested (no key). May need a proxy if the browser blocks it (CORS). Put `https://proxy/v1|KEY` in the key field. |

You choose the engine in Settings. **No keys ship with the app.** If you type a key in Settings, it is stored only in that phone's localStorage. That's fine on Dad's own phone. On a public URL, anyone with the phone could read it, so restrict the key (Google: HTTP-referrer plus Translation-API-only restriction), or put a small Cloudflare Worker or Netlify Function in front that holds the key. To add a new engine, add one object with `name`, `maxChunk`, `needsKey` and `translate()`. The masking, chunking, quota and UI all stay the same.

### Low-cost upgrade options for English→Tamil paragraphs (prices checked 26 Oct 2026)
| Option | Free allowance | Paid price | Notes |
|---|---|---|---|
| **Google Cloud Translation (NMT, Basic or Advanced)** | **First 500,000 characters/month free** (applied as a $10 monthly credit) | $20 per 1M characters after that | Best fit: purpose-built, strong Tamil, predictable. Needs a Google Cloud project with billing enabled and an API key. 500k chars/month is roughly 15–20 long bank letters a day. Source: https://cloud.google.com/translate/pricing |
| Google “Translation LLM” (Advanced v3) | same $10 credit | $10/1M input + $10/1M output chars | Higher quality, but v3 needs OAuth/service account, so it needs a proxy. Same source. |
| **Gemini API, `gemini-3.1-flash-lite`** | **Free tier available** (rate-limited; free-tier data *is used to improve Google products*) | $0.25/1M input tokens, $1.50/1M output tokens (Standard) | Google describes it as “optimized for … translation”. Very cheap paid. Natural, polite Tamil when prompted. Tamil script uses many tokens per word, so output costs more than English. `gemini-2.5-flash-lite` is $0.10/$0.40 per 1M. Source: https://ai.google.dev/gemini-api/docs/pricing |
| **xAI Grok API, `grok-4.3`** | No free tier listed | $1.25/1M input tokens, $2.50/1M output tokens (<200k-token prompts) | Good LLM quality. `grok-4.7` is $2/$6. Source: https://docs.x.ai/docs/models |
| MyMemory (current) | 5,000 chars/day anonymous, **50,000 chars/day with email** (`de=` parameter) | — | Source: https://mymemory.translated.net/doc/usagelimits.php |

Recommendation: stay on MyMemory with an email (50k/day) for now. If quality or quota isn't enough, Google Cloud Translation NMT is the simplest: it's free up to 500k chars/month, and the code is already in `ENGINES.google`. Gemini Flash-Lite is the cheapest LLM route for more natural, polite Tamil.

## MyMemory details
`translateEngine(text, from, to)` in `app.js` is the only function that calls an API. It currently uses **MyMemory** (`https://api.mymemory.translated.net/get?q=…&langpair=en|ta`), which is free and needs no key:
- About 500 characters per request. The app splits text by sentence into chunks of ≤450 characters, and the daily counter counts the characters actually sent. Masked numbers shrink to `[n]`, so they use less quota.
- Free limit is about 5,000 chars/day per IP, or about 50,000 chars/day if an email is set in Settings (the `de=` parameter).
- If a direct Tamil↔Malay call fails, it pivots through English automatically.

To use an AI model later, replace the body of `translateEngine`. Don't put a secret key in the client. Use a tiny proxy (Cloudflare Worker or Netlify Function) that holds the key.

## My words: how it works
Before translating, each glossary term is swapped for a placeholder like `[1]`, which MyMemory leaves alone. After translating, the placeholder is replaced with the term itself, or with your "Use instead" word.

## Tests (optional, kept locally; not included in this repo)
- `node tests/mask.unit.js` runs a unit test of the number, date and reference masking. No network is needed.
- `tests/paragraph.test.js` and `tests/ocr.test.js` are Playwright scripts. Run them with `npm i playwright && npx playwright install chromium`, start the server on port 8765, then `node tests/paragraph.test.js`. They cover paragraph mode with a bank notice, Quick-mode regressions in all directions, and a simulated quota-exhausted response. Screenshots are saved to `screenshots/`.

## Free hosting options (HTTPS, all free)
- **GitHub Pages**: push this folder to a repo, then Settings → Pages → deploy from branch. The URL will be `https://<user>.github.io/<repo>/`.
- **Cloudflare Pages**: dash.cloudflare.com → Pages → upload the folder directly (no git needed).
- **Netlify**: app.netlify.com/drop, then drag and drop the folder.

After hosting, open the URL on Dad's phone and choose Chrome menu → *Add to Home screen* (Android), or Safari Share → *Add to Home Screen* (iPhone).

## Known limitations
- **Speech input**: works well in Chrome on Android, including Tamil (ta-IN) and Malay (ms-MY). On iPhone, Safari's SpeechRecognition support is limited and unreliable for Tamil. Use the microphone key on the iPhone keyboard (with the Tamil keyboard added) instead. Firefox doesn't support it.
- **Read aloud**: depends on the voices installed on the phone. Android with Google TTS usually has Tamil and Malay voices. On iPhone, Tamil may be missing (Settings → Accessibility → Spoken Content → Voices).
- **OCR**: clear printed English and Malay read well. Tamil OCR is weaker, especially on handwriting, stylised signs and low light. The first Tamil or Malay photo downloads about 10–20 MB of language data. Always check the text before translating.
- **Quota counter is an estimate**: it is per phone and browser. MyMemory actually counts per IP or email, so other use on the same Wi-Fi also counts against the limit.
- **Masking side-effects**: a plain number is kept as digits, so “5 pm” stays “5 pm” rather than becoming Tamil wording. All-letter codes such as `TAC` or `FPX` aren't masked. Add them to My words if they get translated.
- **MyMemory quality**: good for everyday sentences, weaker for long or formal letters. There are daily limits, and you can occasionally get an empty result (it retries once).
