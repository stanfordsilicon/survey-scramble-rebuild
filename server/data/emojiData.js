// Emoji "boards" — each has an emoji and its top-10 ranked keywords (rank 0 = most popular).
// Source: QMoji 2.0 Gameplay Prototyping Project keyword survey -- these are predetermined
// from that offline survey, not submitted live by players during a game.
// Scoring reads straight off `keywords` index, so editing this list is all that's
// needed to add/remove/re-rank boards — nothing elsewhere hardcodes emoji names.

const EMOJI_BOARDS = [
  { emoji: '🤣', keywords: ['crying', 'face', 'floor', 'funny', 'haha', 'happy', 'hehe', 'hilarious', 'joy', 'laugh'] },
  { emoji: '😘', keywords: ['adorbs', 'bae', 'blowing', 'face', 'flirt', 'heart', 'ily', 'kiss', 'love', 'lover'] },
  { emoji: '👏', keywords: ['applause', 'approval', 'awesome', 'clap', 'congrats', 'congratulations', 'excited', 'good', 'great', 'hand'] },
  { emoji: '😳', keywords: ['amazed', 'awkward', 'crazy', 'dazed', 'dead', 'disbelief', 'embarrassed', 'face', 'flushed', 'geez'] },
  { emoji: '😎', keywords: ['awesome', 'beach', 'bright', 'bro', 'chilling', 'cool', 'face', 'rad', 'relaxed', 'shades'] },
  { emoji: '👌', keywords: ['awesome', 'bet', 'dope', 'fleek', 'fosho', 'got', 'gotcha', 'hand', 'legit', 'ok'] },
  { emoji: '💪', keywords: ['arm', 'beast', 'bench', 'biceps', 'bodybuilder', 'bro', 'curls', 'flex', 'gains', 'gym'] },
  { emoji: '😏', keywords: ['boss', 'dapper', 'face', 'flirt', 'homie', 'kidding', 'leer', 'shade', 'slick', 'sly'] },
  { emoji: '💯', keywords: ['100', 'a+', 'agree', 'clearly', 'definitely', 'faithful', 'fleek', 'full', 'hundred', 'keep'] },
  { emoji: '😜', keywords: ['crazy', 'epic', 'eye', 'face', 'funny', 'joke', 'loopy', 'nutty', 'party', 'stuck-out'] },
  { emoji: '😐', keywords: ['awkward', 'blank', 'deadpan', 'expressionless', 'face', 'fine', 'jealous', 'meh', 'neutral', 'oh'] },
  { emoji: '😇', keywords: ['angel', 'angelic', 'angels', 'blessed', 'face', 'fairy', 'fairytale', 'fantasy', 'halo', 'happy'] },
  { emoji: '💰', keywords: ['bag', 'bank', 'bet', 'billion', 'cash', 'cost', 'dollar', 'gold', 'million', 'money'] },
  { emoji: '😑', keywords: ['awkward', 'dead', 'expressionless', 'face', 'fine', 'inexpressive', 'jealous', 'meh', 'not', 'oh'] },
  { emoji: '💩', keywords: ['bs', 'comic', 'doo', 'dung', 'face', 'fml', 'monster', 'pile', 'poo', 'poop'] },
  { emoji: '👋', keywords: ['bye', 'cya', 'g2g', 'greetings', 'gtg', 'hand', 'hello', 'hey', 'hi', 'later'] },
  // Previously 8 of these 10 slots were near-duplicate spellings of the same
  // single association (gay/genderqueer/glbt/glbtq/lesbian/lgbt/lgbtq/lgbtqia),
  // crowding out every other real-world reading of this emoji -- rainbow
  // itself wasn't even a keyword for the rainbow emoji. Kept the genuine
  // pride/lgbtq association (still real and common) at one entry each, and
  // filled the rest with the other common associations that had zero
  // representation.
  { emoji: '🌈', keywords: ['rainbow', 'colorful', 'colors', 'pride', 'lgbtq', 'weather', 'unicorn', 'hope', 'diversity', 'happy'] },
  { emoji: '👊', keywords: ['absolutely', 'agree', 'boom', 'bro', 'bruh', 'bump', 'clenched', 'correct', 'fist', 'hand'] },
  { emoji: '🥹', keywords: ['admiration', 'aww', 'back', 'cry', 'embarrassed', 'face', 'feelings', 'grateful', 'gratitude', 'holding'] },
  { emoji: '😙', keywords: ['143', 'closed', 'date', 'dating', 'eye', 'eyes', 'face', 'flirt', 'ily', 'kiss'] },
];

// Points for guessing the keyword at a given rank index (0 = top keyword).
// Mirrors the original prototype's formula: (10 - rank) * 10. `total`
// defaults to 10 (every English board's exact size) so this is unchanged
// for existing content; a language board with fewer than 10 keywords (see
// getBoardsForLanguage below) scales the same way relative to its own size.
function pointsForRank(rankIndex, total = 10) {
  return (total - rankIndex) * 10;
}

// Per-language boards (see server/data/lang/*.json), generated from QMoji's
// shared CLDR emoji-keyword source: for each of this file's 21 emoji, that
// language's own keywords for it, when there are enough to be worth
// playing. Unlike EMOJI_BOARDS' keywords -- ranked by an actual player
// survey -- CLDR keyword order carries no popularity signal, so a language
// board's keyword order is just the source data's own order, not "most
// guessed first." Not every Game Language has enough coverage across
// enough of these 21 emoji to be worth shipping as its own board set; only
// languages that cleared that bar at generation time have a file here.
const fs = require("fs");
const path = require("path");
const phaseFilter = require("./phaseFilter");
const LANG_DATA_DIR = path.join(__dirname, "lang");
const langBoardsCache = new Map();

// A room needs at least this many boards to pick TOTAL_ROUNDS (3, see
// roomManager.js) distinct ones from -- mirrored here as a plain constant
// rather than imported, since roomManager.js already imports this file and
// importing back would be circular. If qmoji-2's Phase system restricts a
// language down to fewer boards than this, filtering isn't usable for that
// language and getBoardsForLanguage falls back to the unfiltered set,
// exactly like Munchers' equivalent "would break the round generator"
// fallback.
const MIN_PLAYABLE_BOARDS = 3;

function loadBoardsFromDisk(lang) {
  // English always uses the deliberately-curated survey boards, even though
  // server/data/lang/en.json also exists -- that file is a mechanical
  // byproduct of generating the other 49 languages' CLDR-derived data (same
  // 20-emoji roster, on purpose, so every language's board set lines up),
  // not a considered replacement for content an actual survey produced.
  if (lang === "en") return EMOJI_BOARDS;
  const file = path.join(LANG_DATA_DIR, `${lang}.json`);
  if (!fs.existsSync(file)) return EMOJI_BOARDS;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : EMOJI_BOARDS;
  } catch (e) {
    console.error(`Failed to load Moji Mojo boards for language "${lang}":`, e.message);
    return EMOJI_BOARDS;
  }
}

function getBoardsForLanguage(lang) {
  if (!lang) return EMOJI_BOARDS;

  // Never blocks: reads whatever the last background fetch already found
  // (null/no restriction until one lands) and kicks off a fresh one if this
  // language's result is missing or stale. See phaseFilter.js. Applies to
  // "en" too -- it used to short-circuit past this whole function (English
  // has no per-language file, it just *is* EMOJI_BOARDS), but that also
  // meant English could never be Phase-restricted, which is exactly the
  // language an admin is most likely to curate first. loadBoardsFromDisk
  // already returns EMOJI_BOARDS as-is for "en" (no lang/en.json file
  // exists), so it naturally becomes the base this filters against.
  phaseFilter.refreshInBackground(lang);
  const allowedSet = phaseFilter.getAllowedSet(lang);
  const cacheKey = allowedSet ? `${lang}|v${phaseFilter.getVersion(lang)}` : `${lang}|unfiltered`;
  if (langBoardsCache.has(cacheKey)) return langBoardsCache.get(cacheKey);

  let boards = loadBoardsFromDisk(lang);
  if (allowedSet) {
    const filtered = boards.filter((b) => allowedSet.has(b.emoji));
    // Only apply the restriction if enough boards survive it -- an admin
    // curating a Phase set has no way to know it needs to overlap this
    // game's specific 21-emoji roster, so a too-small overlap falls back to
    // the unfiltered set rather than breaking the round generator.
    if (filtered.length >= MIN_PLAYABLE_BOARDS) boards = filtered;
  }

  langBoardsCache.set(cacheKey, boards);
  return boards;
}

module.exports = { EMOJI_BOARDS, pointsForRank, getBoardsForLanguage };
