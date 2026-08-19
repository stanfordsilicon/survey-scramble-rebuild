# Translation notes — Moji Mojo

Provenance for every hand-overridden string in `public/locales/*.overrides.json`.

**Nothing in this table has been checked by a native speaker.** Every row was
written by Claude from inspection of the DeepL output. The `Status` column is
the record of that: it says `claude-corrected, unverified` and must only be
changed to `human-verified` by a person who actually speaks the language.

Strings *not* listed here are raw DeepL output — also unverified, but not
known to be wrong. Corrections belong in the `.overrides.json` file, never in
the generated `<lang>.json`.

Total overridden: **40** strings across 5 languages.

| Lang | Key | What was wrong | Replacement | Status |
|---|---|---|---|---|
| `fr` | `username_label` | Formal register (`Votre nom`); house style is informal. | `Ton nom` | claude-corrected, unverified |
| `fr` | `invited_hint` | Formal (`Vous êtes invité… entrez`). | `Tu es invité à rejoindre le salon {code} — entre un nom et rejoins-nous !` | claude-corrected, unverified |
| `fr` | `kicked_from_room` | Formal (`vous a exclu`). | `L'hôte t'a exclu du salon.` | claude-corrected, unverified |
| `fr` | `connection_error` | Formal (`veuillez réessayer`). | `Erreur de connexion — réessaie.` | claude-corrected, unverified |
| `fr` | `ready_up_button` | `✅ Préparez-vous !` — imperative + added exclamation; a button label became a command. | `✅ Je suis prêt` | claude-corrected, unverified |
| `fr` | `cancel_ready_button` | **Meaning inverted.** `Prêt à annuler` = "ready to cancel". The button un-readies you. | `Annuler` | claude-corrected, unverified |
| `fr` | `lobby_waiting_host_ready` | Formal, and `commencez quand vous serez prêt` repeats `prêt` awkwardly. | `Tout le monde est prêt — lance la partie quand tu veux !` | claude-corrected, unverified |
| `fr` | `factoid_label` | Formal (`Le saviez-vous ?`). | `Le savais-tu ?` | claude-corrected, unverified |
| `fr` | `round_progress` | DeepL left the English word `Round` untranslated. | `Tour {round} / {total}` | claude-corrected, unverified |
| `fr` | `guess_placeholder` | Formal (`Saisissez`). | `Saisis un mot-clé…` | claude-corrected, unverified |
| `fr` | `guess_correct` | **Stray character**: `+ {points}s points` — an `s` glued to the token. | `✅ « {keyword} » — +{points} points !` | claude-corrected, unverified |
| `fr` | `all_time_score_summary` | Telegraphic English mis-parsed: `Les meilleurs jeux {score} · Jeux {games}` ("the best games…"). See English-source note below. | `meilleur score {score} · {games} parties` | claude-corrected, unverified |
| `fr` | `go_home_button` | `Retour à la page d'accueil` is 3x the English; overflows the button. | `Accueil` | claude-corrected, unverified |
| `es` | `cancel_ready_button` | **Meaning inverted.** `Listo para cancelar` = "ready to cancel". | `Cancelar` | claude-corrected, unverified |
| `es` | `make_host_button` | `Crear un anfitrión` = "create a host"; it promotes an existing player. | `Hacer anfitrión` | claude-corrected, unverified |
| `es` | `guess_already_revealed` | Capital `Ya` mid-sentence after the token. | `{who} ya había adivinado «{keyword}».` | claude-corrected, unverified |
| `es` | `round_results_title` | `ronda n.º {round}` — over-formal ordinal for a game HUD. | `Resultados de la ronda {round}` | claude-corrected, unverified |
| `es` | `play_again_button` | `Volver a reproducir` = replay a *video*, not play a game again. | `🔁 Volver a jugar` | claude-corrected, unverified |
| `es` | `all_time_score_summary` | Same telegraphic mis-parse: `Los mejores juegos de {score} y {games}`. | `mejor puntuación {score} · {games} partidas` | claude-corrected, unverified |
| `pt-br` | `cancel_ready_button` | `Cancelar Pronto` reads as two disconnected words. | `Cancelar` | claude-corrected, unverified |
| `pt-br` | `guess_correct` | **Word order destroyed**: `+ pontos do {points}!` = "+ points of the 5!". | `✅ “{keyword}” — +{points} pontos!` | claude-corrected, unverified |
| `pt-br` | `all_time_score_summary` | Same telegraphic mis-parse: `os melhores jogos {score} · {games}`. | `melhor pontuação {score} · {games} partidas` | claude-corrected, unverified |
| `pt-pt` | `invited_hint` | Formal `Foi convidado… introduza`; mixed with informal elsewhere in the same file. | `Foste convidado para a sala {code} — introduz um nome e entra!` | claude-corrected, unverified |
| `pt-pt` | `connection_error` | Formal (`por favor, tente`). | `Erro de ligação — tenta novamente.` | claude-corrected, unverified |
| `pt-pt` | `cancel_ready_button` | `Cancelar Pronto` reads as two disconnected words. | `Cancelar` | claude-corrected, unverified |
| `pt-pt` | `round_progress` | **Word dropped**: rendered as a bare `{round} / {total}` with no `Ronda`. | `Ronda {round} / {total}` | claude-corrected, unverified |
| `pt-pt` | `guess_placeholder` | Formal (`Digite`), and Brazilian rather than European usage. | `Escreve uma palavra-chave…` | claude-corrected, unverified |
| `pt-pt` | `guess_correct` | **Word order destroyed**: `+ pontos do {points}!`. | `✅ «{keyword}» — +{points} pontos!` | claude-corrected, unverified |
| `pt-pt` | `all_time_score_summary` | Same telegraphic mis-parse. | `melhor pontuação {score} · {games} partidas` | claude-corrected, unverified |
| `ru` | `app_tagline` | Formal (`Угадайте`). | `Угадай самые популярные ключевые слова для каждого смайлика, пока не истекло время!` | claude-corrected, unverified |
| `ru` | `username_label` | Formal (`Ваше имя`). | `Твоё имя` | claude-corrected, unverified |
| `ru` | `invited_hint` | Formal (`Вы приглашены… введите`). | `Ты приглашён в комнату {code} — введи имя и присоединяйся!` | claude-corrected, unverified |
| `ru` | `kicked_from_room` | Formal (`удалил вас`). | `Ведущий удалил тебя из комнаты.` | claude-corrected, unverified |
| `ru` | `connection_error` | Formal (`попробуйте`). | `Ошибка подключения — попробуй ещё раз.` | claude-corrected, unverified |
| `ru` | `make_host_button` | `Установить ведущего` = "install a host" (server sense). | `Назначить ведущим` | claude-corrected, unverified |
| `ru` | `cancel_ready_button` | `Отменить Готово` — two disconnected words. | `Отменить готовность` | claude-corrected, unverified |
| `ru` | `lobby_waiting_host_ready` | Formal (`начинайте, когда будете готовы`). | `Все готовы — начинай, когда будешь готов!` | claude-corrected, unverified |
| `ru` | `lobby_waiting_not_ready` | **First person**: `Жду…` = "*I* am waiting". Wrong voice for UI. | `Ожидание готовности всех игроков…` | claude-corrected, unverified |
| `ru` | `see_final_results_button` | `См.` is the bibliographic "cf." abbreviation, not a button label. | `Смотреть финальные результаты` | claude-corrected, unverified |
| `ru` | `all_time_score_summary` | Same telegraphic mis-parse: `лучшие игры {score} · {games}`. | `лучший счёт {score} · игр: {games}` | claude-corrected, unverified |

## Known-remaining issue

`all_time_score_summary` is broken in **English**, not just in translation:
`best {score} · {games} games` is telegraphic enough that DeepL parsed *best*
as an adjective of *games* in all five languages. The overrides above patch
each language, but the English source is the actual defect and a reworded
English string is pending review. When it lands, revisit these five rows —
an override silently keeps winning even after its English is fixed.
