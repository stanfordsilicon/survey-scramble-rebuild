// i18n runtime for Emoji Survey Scramble.
//
// English-only for now -- there's no language switcher in this game yet.
// I18N_STRINGS.en is the single source of truth for every piece of UI
// text; more languages get added as new blocks here (I18N_STRINGS.es,
// etc.) once translations come back. The clean key -> English export
// handed off for translation lives at ../i18n-source/en.json (repo root,
// outside public/, so it's never part of what actually gets deployed) --
// keep that file's keys in sync with this one.
//
// t(key, vars) looks up a string and fills in any {placeholder} tokens
// (e.g. t('round_progress', { round: 2, total: 3 })). Falls back to the
// raw key if it's ever missing, so a typo shows up as visibly broken text
// instead of silently rendering nothing.
const I18N_LANG = 'en';

const I18N_STRINGS = {
  en: {
    app_title: "Survey Scramble!",
    app_tagline: "Guess the top keywords for each emoji before time runs out!",
    back_to_launchpad: "RETURN TO LAUNCH PAD",
    loading: "LOADING",
    username_label: "Your name",
    username_placeholder: "Player1234",
    create_room_button: "Create Room",
    divider_or: "or",
    room_code_label: "Room code",
    room_code_placeholder: "ABCD",
    join_room_button: "Join Room",
    invited_hint: "Invited to room {code} — enter a name and join!",
    generic_error: "Something went wrong.",
    kicked_from_room: "The host removed you from the room.",
    connection_error: "Connection error — please try again.",
    lobby_title: "Room Code",
    copy_invite_button: "📋 Copy Invite Link",
    invite_link_copied: "Invite link copied!",
    players_heading: "Players",
    host_suffix: "(host)",
    make_host_button: "Make host",
    kick_button: "Remove",
    kick_confirm: "Remove {name} from the room?",
    you_suffix: "(you)",
    ready_badge: "✅ Ready",
    waiting_badge: "⏳ Waiting",
    ready_up_button: "✅ Ready Up",
    cancel_ready_button: "Cancel Ready",
    start_game_button: "Start Game",
    lobby_waiting_host_ready: "Everyone is ready — start when you are!",
    lobby_waiting_guest_ready: "Waiting for the host to start the game…",
    lobby_waiting_not_ready: "Waiting for everyone to be ready…",
    play_solo_button: "🎮 Play Solo For Now",
    factoid_label: "Did you know?",
    round_progress: "Round {round} / {total}",
    score_line: "Score: {score}",
    guess_placeholder: "Type a keyword…",
    submit_button: "Submit",
    guess_correct: '✅ "{keyword}" — +{points} points!',
    guess_already_revealed: '{who} already guessed "{keyword}".',
    guess_already_revealed_fallback_who: "someone",
    guess_wrong: "Not in the top 10. Try again!",
    round_results_title: "Round {round} Results",
    final_round_results_title: "Final Round Results",
    leaderboard_heading: "Leaderboard",
    next_round_button: "Next Round",
    see_final_results_button: "See Final Results",
    scoring_waiting_host: "Waiting for the host…",
    final_results_title: "🏆 Final Results",
    play_again_button: "🔁 Play Again",
    final_waiting: "Waiting for the host to start a new game…",
    go_home_button: "Go Home",
    all_time_leaderboard_heading: "🌎 All-Time Leaderboard",
    all_time_score_summary: "best {score} · {games} games",
  },
};

function t(key, vars) {
  const table = I18N_STRINGS[I18N_LANG] || I18N_STRINGS.en;
  let text = (table && table[key]) || I18N_STRINGS.en[key] || key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      text = text.split(`{${k}}`).join(vars[k]);
    });
  }
  return text;
}

// Applies every static (non-templated) string in one pass on load --
// anything with dynamic content (a score, a room code, a countdown) is set
// directly by client.js via t() instead, since data-i18n has no way to
// carry variables.
function applyStaticTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
}
