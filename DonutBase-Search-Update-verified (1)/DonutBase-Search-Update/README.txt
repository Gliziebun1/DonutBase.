DonutBase
=================
Open index.html in a browser. No install or build step.

STORAGE
Standalone mode keeps listings, photos and chats in this browser's localStorage, so they are only
visible on this device. To share listings between players, replace the "Standalone mode" script near
the top of index.html with a real backend (Firebase, Supabase, your own API).

USERNAME CHECK (so only real DonutSMP players get in)
The page asks for a Minecraft username on entry. Out of the box it checks that the name is a real Minecraft Java
account (via playerdb.co). It does NOT check DonutSMP membership or Bedrock names until you do the steps below.
1. In-game on DonutSMP run /api to generate an API key. Docs: https://api.donutsmp.net/index.html
2. Create a Cloudflare Worker, paste proxy/worker.js, and add a secret named DONUT_API_KEY.
   (Never put the key in index.html: anyone could copy it.)
3. In index.html set VERIFY_URL near the top of the script to your Worker URL + "/verify".
4. Test with one real name and one made-up name. If real names fail with a key error, check the
   Authorization header format in the API docs and adjust worker.js.
Note: this confirms the name is a real DonutSMP player. It cannot prove the person typing it owns that
account. Stronger proof needs a server-side step, such as a one-time code the player sends in-game.

MESSAGES AND OFFERS
Private messages and offers are only shown to the people involved inside the page, but the stored data is not
encrypted. For truly private chat you need a backend with accounts.

VOUCHES AND REPORTS
Players can vouch for a seller (one vouch each) and report listings. To see reports, put your Minecraft username in
the ADMINS list near the top of the script in index.html, e.g. var ADMINS=["YourName"]; then log in with that name
and a Reports tab appears. This is hidden in the page only, not enforced on a server.

PROFILES AND AVATARS
Tap a player's icon or name to open their profile (bio, Discord, vouches, listings). Admins also see reports against
them there. Icons are Minecraft skin heads loaded from minotar.net, so the page needs internet; if an icon fails to
load a letter is shown instead. Bedrock names (starting with a dot) always show a letter.

RULES BAKED IN
In-game currency only, no coordinates in text, chat or photos, sellers must own the base they list.
Check your server's rules before running a trading site.


FIXED ICON VERSION:
The logo and favicon are embedded directly inside index.html as data URIs.
You can open index.html by itself; the logo no longer depends on the assets folder
or on the browser's current working directory. Keep the assets folder in the ZIP
as backup copies.


SEARCH UPDATE:
The Market search field now searches listing titles, descriptions, player names,
build categories/types, regions, sizes, and status. It supports ordinary keywords
such as "Christmas" (when included in a listing title or description), "farm",
"stash", or a seller's Minecraft username. Multiple words are treated as AND terms.
The existing region/type dropdown filters continue to work alongside text search.


ACCOUNT OWNERSHIP VERIFICATION (new)
After typing a username, the player must prove they own the account:
1. The site shows a random price, e.g. $717,921.
2. The player lists any cheap item (1 dirt) on the DonutSMP auction house for exactly that price.
3. They press Verify. The server reads the auction listings through the official DonutSMP API and looks for a
   listing by that player at that exact price. Only the real account owner can create it.
4. On success the player gets a signed login session (30 days) and a "Verified" badge. The listing can be removed.
The challenge expires after 15 minutes and works once. The API key never reaches the browser.

SETUP ON RENDER
1. In Render, open the service > Environment and add DONUT_API_KEY (get it by running /api in-game on DonutSMP).
2. SESSION_SECRET is generated automatically by render.yaml. Keep it private; changing it logs everyone out.
3. Deploy. Without DONUT_API_KEY the login screen shows an error instead of letting people in.
Files: server.js (routes), verify.js (verification logic). No new npm packages are needed.
If the site is opened as a plain file (no server), it falls back to the old "is this a real Minecraft name" check.
