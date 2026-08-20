// "Did you know" factoids shown while players wait in the lobby.
// Sourced from the SILICON Factoids: Did You Knows spreadsheet.
//
// The text itself lives in public/locales/factoids.<lang>.json, keyed
// factoid_001 onward. THAT FILE IS APPEND-ONLY: never renumber an entry and
// never reuse a retired id -- the ids are what tie a translation, an
// override, and a review note to the same fact. The rule and the reasoning
// are in the README under "Factoids".
//
// Loaded SEPARATELY from the UI chrome and only on demand. Factoids are
// lobby-only content and roughly ten times the volume of the chrome, so
// making the first paint wait on them would be paying for something most of
// a session never shows. loadFactoids() is called by client.js when the
// lobby actually opens; the fetch happens once and is then reused.
//
// Falls back per key, exactly like t(): a fact missing from factoids.fr.json
// renders in English rather than vanishing or showing a raw key. A player
// reading a French UI sees English facts, which is the correct degradation
// for content that may lag the chrome.

(function (global) {
  "use strict";

  var cache = null; // Promise<string[]>, resolved once

  function fetchBundle(lang) {
    return fetch("locales/factoids." + encodeURIComponent(lang) + ".json").then(function (res) {
      if (!res.ok) throw new Error("factoids " + lang + " -> HTTP " + res.status);
      return res.json();
    });
  }

  // Resolves to an ordered array of fact strings. Never rejects: with no
  // English file at all the lobby simply shows no factoid, which is a
  // cosmetic loss, not a broken screen.
  function loadFactoids() {
    if (cache) return cache;

    // resolveI18nLang() already applies the shared normalization, including
    // the bare "pt" -> "pt-br" alias. See public/i18n.js.
    var lang = typeof resolveI18nLang === "function" ? resolveI18nLang() : "en";

    cache = fetchBundle("en")
      .catch(function (e) {
        console.error("factoids: could not load English --", e.message);
        return {};
      })
      .then(function (en) {
        if (lang === "en") return { en: en, active: en };
        return fetchBundle(lang)
          .then(function (active) {
            return { en: en, active: active };
          })
          .catch(function (e) {
            // Normal for a language nobody has translated yet.
            console.info("factoids: falling back to English --", e.message);
            return { en: en, active: en };
          });
      })
      .then(function (tables) {
        // English defines the set and the order; the active language only
        // supplies text. A fact it is missing falls back per key.
        return Object.keys(tables.en).map(function (key) {
          return tables.active[key] || tables.en[key];
        });
      });

    return cache;
  }

  global.loadFactoids = loadFactoids;
})(window);
