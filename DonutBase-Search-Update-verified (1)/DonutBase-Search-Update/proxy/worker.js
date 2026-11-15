// Cloudflare Worker: checks that a username exists on DonutSMP without exposing your API key to the browser.
// Setup: create a Worker, paste this file, add a secret named DONUT_API_KEY (generate the key in-game with /api),
// optionally add ALLOW_ORIGIN (your site's URL). Then put the Worker URL + "/verify" in VERIFY_URL in index.html.
// Docs: https://api.donutsmp.net/index.html  (confirm the Authorization header format there if you get 401s)
export default {
  async fetch(req, env) {
    const h = {
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
      "Content-Type": "application/json",
    };
    const send = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: h });
    const user = new URL(req.url).searchParams.get("user") || "";
    if (!/^\.?[A-Za-z0-9_]{3,16}$/.test(user)) return send({ ok: false, error: "Invalid username." }, 400);
    try {
      // /stats works for offline players too, so it's a better "does this player exist" check than /lookup
      const r = await fetch("https://api.donutsmp.net/v1/stats/" + encodeURIComponent(user), {
        headers: { Authorization: "Bearer " + env.DONUT_API_KEY },
      });
      if (r.status === 401 || r.status === 403) return send({ ok: false, error: "Verification server key is not set up correctly." });
      if (r.status === 429) return send({ ok: false, error: "Too many checks right now. Try again in a minute." });
      if (!r.ok) return send({ ok: false, error: "That username wasn't found on DonutSMP." });
      return send({ ok: true, name: user });
    } catch (e) {
      return send({ ok: false, error: "Could not reach DonutSMP. Try again." });
    }
  },
};
