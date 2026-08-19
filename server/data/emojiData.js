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
// Mirrors the original prototype's formula: (10 - rank) * 10.
function pointsForRank(rankIndex) {
  return (10 - rankIndex) * 10;
}

module.exports = { EMOJI_BOARDS, pointsForRank };
