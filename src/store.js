// store.js — lagring. Importeras i BÅDE panelen och content-scriptet.
//   Profil (markerade ankare) → chrome.storage.local, nyckel host+path-bucket.
//     Content-scriptet läser den direkt; ingen service-worker-routing behövs.
//   OpenRouter-nyckel → chrome.storage.session (nås EJ av content scripts default).
//     Opt-in "kom ihåg" → storage.local, i klartext. Aldrig storage.sync.

// Grov path-bucket: första path-segmentet. Skiljer /support från /checkout när samma
// företag kör olika widgets, utan att spreta sig på query/hash.
export function pathBucket(pathname) {
  const seg = (pathname || '/').split('/').filter(Boolean)[0] || '';
  return seg.toLowerCase().slice(0, 40);
}

export function profileKey(host, bucket) {
  return `profile:${host}:${bucket}`;
}

/** Läs profilen för en given URL (host + bucket). Returnerar null om ingen finns
 * eller om URL:en är ogiltig/tom (t.ex. om fliken inte kunde läsas). */
export async function getProfile(url = location.href) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const key = profileKey(u.host, pathBucket(u.pathname));
  const got = await chrome.storage.local.get(key);
  return got[key] || null;
}

export async function saveProfile(profile) {
  const key = profileKey(profile.host, profile.pathBucket);
  await chrome.storage.local.set({ [key]: profile });
}

export async function clearProfile(host, bucket) {
  await chrome.storage.local.remove(profileKey(host, bucket));
}

/* ---------- OpenRouter-nyckel ---------- */

const KEY_NAME = 'orKey';

export async function getKey() {
  const s = await chrome.storage.session.get(KEY_NAME);
  if (s[KEY_NAME]) return s[KEY_NAME];
  const l = await chrome.storage.local.get(KEY_NAME); // opt-in "kom ihåg"
  return l[KEY_NAME] || '';
}

/** @param {boolean} remember true = spara på disk (klartext), annars bara i minnet. */
export async function setKey(key, remember) {
  await chrome.storage.session.set({ [KEY_NAME]: key });
  if (remember) await chrome.storage.local.set({ [KEY_NAME]: key });
  else await chrome.storage.local.remove(KEY_NAME);
}

export async function forgetKey() {
  await chrome.storage.session.remove(KEY_NAME);
  await chrome.storage.local.remove(KEY_NAME);
}
