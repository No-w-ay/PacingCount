// PacingCount — serveur d'alertes push : Worker + Durable Object.
//
// Le téléphone envoie des horaires absolus. Ce serveur les mémorise (un Durable Object par
// appareil), se réveille à chaque horaire et envoie un push SANS contenu au service push du
// navigateur. Le texte de la notification vit sur l'appareil (plan stocké par l'app, lu par sw.js) :
// ni ce serveur ni un tiers ne peut donc faire afficher un message arbitraire.
//
// Secrets à définir (jamais dans le dépôt) :
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex. "mailto:...")
//   en production : wrangler secret put <NOM>   |   en local : fichier .dev.vars
// Variable pour les tests locaux uniquement (.dev.vars) :
//   ALLOW_NO_ORIGIN=true  (accepte curl, qui n'envoie pas d'en-tête Origin)

import { DurableObject } from "cloudflare:workers";

// Plafonds et délais : valeurs prudentes, à ajuster après les tests.
const MAX_BODY_BYTES = 4096;
const MAX_FIRE_COUNT = 50;
const MAX_AHEAD_MS = 24 * 3600 * 1000;   // durée maximale entre « maintenant » et un horaire
const PAST_TOLERANCE_MS = 60 * 1000;     // horaire légèrement passé accepté (envoi immédiat)
const PUSH_TTL_SECONDS = 300;            // au-delà, un rappel tardif n'a plus de sens
const STALE_AFTER_MS = PUSH_TTL_SECONDS * 1000;
const MAX_RETRIES = 3;
// Limite par appareil : au plus 30 envois d'horaires (/schedule) ou annulations (/cancel) par heure.
// Un usage normal en fait quelques-uns ; protège le quota gratuit contre un client en boucle.
// Compteur en mémoire du Durable Object (il ne coûte aucune écriture ; il repart de zéro si l'objet est évincé).
const MAX_CALLS_PER_HOUR = 30;
const RATE_WINDOW_MS = 3600 * 1000;
const RETRY_DELAY_MS = 15 * 1000;

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{22,64}$/;

// Seuls les vrais services push sont acceptés (Chrome, Edge, Brave, Samsung : Google ;
// Firefox : Mozilla ; Safari / iOS : Apple ; Windows : Microsoft). Sans cette liste, le serveur
// pourrait être détourné pour contacter n'importe quelle adresse.
const PUSH_HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com"]);
const PUSH_HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

// ---------- Utilitaires ----------

const encoder = new TextEncoder();

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}

function allowedOrigins(env) {
  return new Set((env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean));
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// Lit le corps JSON en s'arrêtant dès que la taille maximale est dépassée.
async function readJsonLimited(request, maxBytes) {
  if (Number(request.headers.get("Content-Length")) > maxBytes) return { status: 413 };
  if (!request.body) return { status: 400 };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { status: 413 };
    }
    chunks.push(value);
  }
  try {
    return { value: JSON.parse(await new Blob(chunks).text()) };
  } catch {
    return { status: 400 };
  }
}

// ---------- Validation ----------

function isAllowedEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 1024) return false;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") return false;
  const host = url.hostname;
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function isShortString(v) {
  return typeof v === "string" && v.length > 0 && v.length <= 128;
}

// Numéro de séquence facultatif (entier positif) : les anciennes versions de l'app n'en envoient pas.
function parseSeq(v) {
  if (v === undefined) return { ok: true, seq: undefined };
  if (!Number.isSafeInteger(v) || v < 1) return { ok: false };
  return { ok: true, seq: v };
}

// Retourne { deviceId, subscription, fireAt, seq } ou null si la requête est invalide.
// Le téléphone envoie aussi son heure (clientNow) : le serveur corrige l'écart d'horloge,
// ce qui rend les horaires fiables même si l'horloge du téléphone est décalée.
function parseSchedule(body, now) {
  if (!body || typeof body !== "object") return null;
  const { deviceId, subscription, clientNow, fireAt } = body;
  if (typeof deviceId !== "string" || !DEVICE_ID_RE.test(deviceId)) return null;
  const seq = parseSeq(body.seq);
  if (!seq.ok) return null;
  if (!Number.isFinite(clientNow)) return null;
  if (!subscription || typeof subscription !== "object" || !isAllowedEndpoint(subscription.endpoint)) return null;

  let keys = null;
  if (subscription.keys !== undefined) {
    if (!isShortString(subscription.keys?.p256dh) || !isShortString(subscription.keys?.auth)) return null;
    keys = { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth };
  }

  if (!Array.isArray(fireAt) || fireAt.length === 0 || fireAt.length > MAX_FIRE_COUNT) return null;
  const offset = now - clientNow;
  const times = [];
  for (const t of fireAt) {
    if (!Number.isFinite(t)) return null;
    const corrected = Math.round(t + offset);
    if (corrected < now - PAST_TOLERANCE_MS || corrected > now + MAX_AHEAD_MS) return null;
    times.push(corrected);
  }
  return {
    deviceId,
    subscription: { endpoint: subscription.endpoint, keys },
    fireAt: [...new Set(times)].sort((a, b) => a - b),
    seq: seq.seq,
  };
}

// ---------- Envoi du push (signature VAPID, RFC 8292) ----------

async function buildVapidAuthorization(env, audience) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) throw new Error("secret VAPID manquant");
  const publicKey = b64urlToBytes(env.VAPID_PUBLIC_KEY ?? "");
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error("VAPID_PUBLIC_KEY invalide");

  // WebCrypto n'importe pas une clé privée brute : on la fournit au format JWK.
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: bytesToB64url(publicKey.slice(1, 33)), y: bytesToB64url(publicKey.slice(33, 65)), d: env.VAPID_PRIVATE_KEY },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const header = bytesToB64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToB64url(
    encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })),
  );
  const unsigned = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(unsigned)));
  return `vapid t=${unsigned}.${bytesToB64url(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Retourne "ok", "gone" (abonnement expiré), "retry" (échec passager) ou "rejected" (à ne pas réessayer).
async function sendPush(env, endpoint) {
  let authorization;
  try {
    authorization = await buildVapidAuthorization(env, new URL(endpoint).origin);
  } catch (e) {
    console.error("[push] configuration VAPID invalide :", e.message);
    return "rejected";
  }
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: authorization, TTL: String(PUSH_TTL_SECONDS), Urgency: "high" },
      redirect: "manual",
    });
    const text = await res.text().catch(() => "");
    if (res.status >= 200 && res.status < 300) return "ok";
    console.warn(`[push] réponse ${res.status} : ${text.slice(0, 200)}`);
    if (res.status === 404 || res.status === 410) return "gone";
    if (res.status === 429 || res.status >= 500) return "retry";
    return "rejected";
  } catch (e) {
    console.warn("[push] erreur réseau :", e.message);
    return "retry";
  }
}

// ---------- Durable Object : un par appareil ----------

export class DeviceAlarm extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.calls = []; // horodatages des appels récents (limite par heure)
  }

  // Limite par appareil. Retourne true si l'appel est refusé.
  isRateLimited() {
    const now = Date.now();
    this.calls = this.calls.filter((t) => now - t < RATE_WINDOW_MS);
    if (this.calls.length >= MAX_CALLS_PER_HOUR) return true;
    this.calls.push(now);
    return false;
  }

  // Numéro de séquence : chaque envoi de l'app porte un numéro croissant. Un envoi dont le numéro n'est pas
  // plus grand que le dernier accepté est périmé (un ancien envoi retardé par le réseau ne doit pas écraser un
  // envoi plus récent). Le numéro est conservé séparément de l'état : il survit à une annulation.
  // Sans numéro (ancienne version de l'app) : toujours accepté, numéro inchangé.
  // Retourne null si l'envoi est accepté, sinon { stale: true, seq } (dernier numéro accepté).
  async checkSeq(seq) {
    if (seq === undefined) return null;
    const last = (await this.ctx.storage.get("seq")) ?? 0;
    if (seq <= last) return { stale: true, seq: last };
    await this.ctx.storage.put("seq", seq);
    return null;
  }

  // Remplace entièrement le programme de l'appareil (même logique que cancelAlerts() + scheduleAlerts()).
  // Retourne { ok: true } ou { limited: true } ou { stale: true, seq }.
  async schedule(subscription, fireAt, seq) {
    if (this.isRateLimited()) return { limited: true };
    const stale = await this.checkSeq(seq);
    if (stale) return stale;
    const state = { version: crypto.randomUUID(), endpoint: subscription.endpoint, keys: subscription.keys, pending: fireAt, attempt: 0 };
    await this.ctx.storage.put("state", state);
    await this.ctx.storage.setAlarm(fireAt[0]);
    return { ok: true };
  }

  async cancel(seq) {
    if (this.isRateLimited()) return { limited: true };
    const stale = await this.checkSeq(seq);
    if (stale) return stale;
    await this.clear();
    return { ok: true };
  }

  // Efface le programme de l'appareil (adresse push comprise), en gardant le numéro de séquence.
  async clear() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.delete("state");
  }

  // Cloudflare n'autorise qu'une alarme à la fois : on garde la liste des horaires et on
  // programme le prochain à chaque passage.
  async alarm() {
    const storage = this.ctx.storage;
    const state = await storage.get("state");
    if (!state) return;

    const now = Date.now();
    const due = state.pending.filter((t) => t <= now);
    const fresh = due.filter((t) => now - t <= STALE_AFTER_MS);
    state.pending = state.pending.filter((t) => t > now);
    // Progression enregistrée AVANT l'envoi : une alarme rejouée par Cloudflare (exécution
    // « au moins une fois ») ne renvoie jamais un horaire déjà traité.
    await storage.put("state", state);

    // Plusieurs horaires échus en même temps (alarme très en retard) : un seul push suffit.
    const outcome = fresh.length > 0 ? await sendPush(this.env, state.endpoint) : "none";

    // schedule() ou cancel() ont pu s'exécuter pendant l'envoi : on ne touche alors à rien.
    const current = await storage.get("state");
    if (!current || current.version !== state.version) return;

    if (outcome === "gone") {
      await this.clear();
      return;
    }

    const retry = outcome === "retry" && state.attempt < MAX_RETRIES;
    if (retry) {
      state.attempt += 1;
      state.pending.unshift(Math.max(...fresh));
    } else {
      state.attempt = 0;
    }

    if (state.pending.length === 0) {
      await this.clear();
      return;
    }
    await storage.put("state", state);
    await storage.setAlarm(retry ? Date.now() + RETRY_DELAY_MS : state.pending[0]);
  }
}

// ---------- Worker : la « réceptionniste » ----------

// Traduit la réponse du Durable Object : 429 (trop d'appels), 409 (numéro périmé, avec le dernier numéro
// accepté : l'app s'y recale), sinon 200.
function outcome(result, extra, cors) {
  if (result.limited) return json({ error: "rate_limited" }, 429, { ...cors, "Retry-After": "600" });
  if (result.stale) return json({ error: "stale", seq: result.seq }, 409, cors);
  return json({ ok: true, ...extra }, 200, cors);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true }, 200);
    if (url.pathname !== "/schedule" && url.pathname !== "/cancel") return json({ error: "not_found" }, 404);

    const origin = request.headers.get("Origin");
    const originOk = origin !== null ? allowedOrigins(env).has(origin) : env.ALLOW_NO_ORIGIN === "true";
    if (!originOk) return json({ error: "forbidden" }, 403);
    const cors = origin !== null ? corsHeaders(origin) : {};

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
    if (!(request.headers.get("Content-Type") ?? "").startsWith("application/json")) {
      return json({ error: "unsupported_media_type" }, 415, cors);
    }

    const read = await readJsonLimited(request, MAX_BODY_BYTES);
    if (read.status) return json({ error: read.status === 413 ? "too_large" : "bad_request" }, read.status, cors);

    try {
      if (url.pathname === "/schedule") {
        const parsed = parseSchedule(read.value, Date.now());
        if (!parsed) return json({ error: "bad_request" }, 400, cors);
        const result = await env.DEVICE_ALARM.getByName(parsed.deviceId).schedule(parsed.subscription, parsed.fireAt, parsed.seq);
        return outcome(result, { count: parsed.fireAt.length }, cors);
      }

      const deviceId = read.value?.deviceId;
      if (typeof deviceId !== "string" || !DEVICE_ID_RE.test(deviceId)) return json({ error: "bad_request" }, 400, cors);
      const seq = parseSeq(read.value?.seq);
      if (!seq.ok) return json({ error: "bad_request" }, 400, cors);
      return outcome(await env.DEVICE_ALARM.getByName(deviceId).cancel(seq.seq), {}, cors);
    } catch (e) {
      console.error("[push] erreur serveur :", e.message);
      return json({ error: "server_error" }, 500, cors);
    }
  },
};
