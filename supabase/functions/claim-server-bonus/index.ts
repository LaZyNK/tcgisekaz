// TCG Isekaz — Bonus "rejoindre le serveur Discord" (Edge Function claim-server-bonus)
// Secret requis : DISCORD_BOT_TOKEN (le bot doit être dans le serveur)
import { createClient } from "npm:@supabase/supabase-js@2";

const GUILD_ID = "984180525407273030";
const BONUS = "server_join";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await db.auth.getUser(jwt);
  if (!user) return json({ status: "unauthorized" }, 401);

  const discordId = user.user_metadata?.provider_id;
  if (!discordId) return json({ status: "error", message: "Compte non lié à Discord." });

  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!botToken) return json({ status: "error", message: "Bonus indisponible (configuration serveur)." });

  // Déjà réclamé ?
  const { data: existing } = await db.from("bonus_claims").select("discord_id")
    .eq("discord_id", String(discordId)).eq("bonus", BONUS).maybeSingle();
  if (existing) return json({ status: "already" });

  // Est-il membre du serveur ?
  const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${discordId}`, {
    headers: { Authorization: `Bot ${botToken}`, "User-Agent": "TCGIsekazBot (https://lazynk.github.io/tcgisekaz, 1.0)" },
  });
  if (r.status === 404) return json({ status: "not_member" });
  if (!r.ok) {
    console.error("Discord API", r.status, await r.text());
    return json({ status: "error", message: "Vérification Discord impossible pour le moment." });
  }

  const { error } = await db.from("bonus_claims").insert({ discord_id: String(discordId), bonus: BONUS });
  if (error) {
    if (error.code === "23505") return json({ status: "already" });
    console.error(error);
    return json({ status: "error", message: "Erreur d'enregistrement du bonus." });
  }
  return json({ status: "ok" });
});
