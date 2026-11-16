// Liest eine HUT-Aufstellung (Screenshot oder Foto) mit Gemini aus.
// Der API-Schluessel liegt als Secret GEMINI_API_KEY im Projekt und erreicht nie den Browser.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Erstes verfuegbares Modell gewinnt; ein abgeschaltetes Modell wird uebersprungen.
const MODELS = (Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite")
  .split(",").map((m) => m.trim()).filter(Boolean);
const ALLOWED = ["https://ghchris97.github.io", "http://localhost:8765", "http://127.0.0.1:8765"];
const MAX_BYTES = 6_000_000;

const PROMPT = `Das Bild zeigt eine Aufstellung aus "Hockey Ultimate Team" (EA SPORTS NHL), als Screenshot oder als Foto vom Fernseher.
Lies JEDE sichtbare Spielerkarte aus. Pro Karte:
- name: Vor- und Nachname genau wie auf der Karte, in Grossbuchstaben (z. B. "TYLER BERTUZZI")
- ovr: die grosse Zahl oben links auf der Karte
- pos: die Position auf der Karte oder darueber (LW, C, RW, LD, RD, G; deutsche Kuerzel umrechnen: LA=LW, RA=RW, LV=LD, RV=RD, Torhueter=G)
- line: die Reihe, falls erkennbar (z. B. "Angriff 1", "Verteidigung 2", "Goalies"), sonst leer
Lass nichts weg und erfinde nichts. Ist ein Name nur teilweise lesbar, gib den lesbaren Teil zurueck.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    cards: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { name: { type: "STRING" }, ovr: { type: "INTEGER" }, pos: { type: "STRING" }, line: { type: "STRING" } },
        required: ["name", "ovr"],
      },
    },
  },
  required: ["cards"],
};

function cors(origin: string | null) {
  const ok = origin && ALLOWED.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, h: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const h = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405, h);
  if (!origin || !ALLOWED.includes(origin)) return json({ error: "Nicht erlaubt" }, 403, h);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "Der Gemini-Schlüssel fehlt im Server." }, 500, h);

  let body: { image?: string; mime?: string };
  try { body = await req.json(); } catch { return json({ error: "Ungültige Anfrage" }, 400, h); }
  const image = String(body.image ?? "");
  const mime = /^image\/(jpeg|png|webp)$/.test(String(body.mime)) ? String(body.mime) : "image/jpeg";
  if (!image || image.length > MAX_BYTES) return json({ error: "Bild fehlt oder ist zu groß." }, 400, h);

  let res: Response | null = null, out: any = null, model = "";
  for (const m of MODELS) {
    model = m;
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime, data: image } }, { text: PROMPT }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
      }),
    });
    out = await res.json().catch(() => null);
    const msg = String(out?.error?.message ?? "");
    // abgeschaltet, ueberlastet oder Kontingent dieses Modells leer: naechstes Modell probieren
    const skip = res.status === 404 || res.status === 503 || res.status === 429 ||
      /no longer available|not found|not supported|high demand|overloaded|unavailable|quota/i.test(msg);
    if (!skip) break;
  }
  if (!res || !res.ok) {
    const msg = out?.error?.message ?? `HTTP ${res?.status}`;
    const busy = res?.status === 429;
    return json({ error: busy ? "Das kostenlose Gemini-Kontingent ist gerade ausgeschöpft. Versuch es später noch einmal." : "Gemini-Fehler: " + msg }, busy ? 429 : 502, h);
  }
  const text = out?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  try {
    const parsed = JSON.parse(text);
    const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];
    return json({ cards, model }, 200, h);
  } catch {
    return json({ error: "Gemini hat keine lesbare Liste geliefert." }, 502, h);
  }
});
