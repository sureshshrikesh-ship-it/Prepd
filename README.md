# Prepd

Snap your shop, get your week. Step 1 is the receipt reader: take a photo of a supermarket receipt, Claude reads every line into structured data, and you mark each line right or wrong to measure accuracy.

## Run it on your laptop

```bash
npm install
cp .env.example .env.local   # then paste your API key into it
npm run dev                  # open http://localhost:3000
npm test                     # unit tests for the parsing logic
```

## Put it online (Vercel, about 10 minutes)

1. Get an API key at console.anthropic.com → API Keys. Add a few pounds of credit and set a monthly spend limit.
2. Push this folder to a **private** GitHub repo.
3. On vercel.com, choose Add New → Project, import the repo, and keep the defaults.
4. Under Environment Variables, add:
   - `ANTHROPIC_API_KEY`: your key
   - `APP_PASSCODE`: any phrase. Testers type it once. Without it the server refuses every request, so strangers can't spend your credit.
   - `ANTHROPIC_MODEL` (optional): defaults to `claude-sonnet-5-5`
5. Deploy. Open the URL on your phone, then Share → Add to Home Screen.

## How it works

| Piece | File |
| --- | --- |
| Prompt, output schema, tolerant parsing | `lib/receipt.ts` |
| Photo shrinking on the phone (long edge 1800 px, JPEG) | `lib/shrink.ts` |
| API route: passcode check → Claude → validated JSON | `app/api/read-receipt/route.ts` |
| Scan and review screen, local test log | `app/page.tsx` |

- Photos are never stored. They're shrunk on the phone, sent once, and dropped after reading.
- The test log lives in the phone's browser. Use **Copy log for Claude** to share results.
- Each reading reports its token usage, so we can estimate the cost per receipt.

## Next

- Supabase: login (Google, Apple or magic link) and Postgres tables for receipts, items, pantry, plans and the store product map.
- Pantry and the meal-plan screens from the mockups.
