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

## Adopted from Sid's translations

Sid (@HtchHiker42) hand-translated these games independently. His strings were
superseded by the pipeline, but not before diffing them key by key against mine.
Where his read better, his is used — credited here rather than relabelled as my
own work. **These are Sid's words and are still unverified by a native speaker.**

He caught four things I had genuinely got wrong or missed: a French
`make_host_button` I fixed in two other languages but not French, a formal
`Réessayez` and `Commencez` that slipped past my own register pass, a Russian
`в {seconds}` that means *at 5* rather than *in 5 seconds*, and the pt-br
sports-fixture register I fixed everywhere except pt-br.

His systematic weaknesses, which is why the rest was not adopted: Title Case
applied to Spanish, French, Portuguese and Russian (none of which use it),
formal register throughout Russian, and translating the game's own name.

Adopted here: **17** strings from Sid, plus
**3** of my own that this comparison exposed.

| Lang | Key | Why | Value | Source |
|---|---|---|---|---|
| `es` | `back_to_launchpad` | Sid's is far shorter and reads as arcade language. Mine (`VOLVER A LA PLATAFORMA DE LANZAMIENTO`) was the string I measured overflowing its button at 375px by up to 85%, so this fixes a real layout bug as well. | `VOLVER A LA BASE` | **from Sid** (his translation, unverified) |
| `es` | `guess_activity` | Mine rendered *guesses* as `predicciones` / `prédictions` / `предположения` — predictions, which is wrong. Sid's attempts/tentatives/попыток reads correctly in a counter. | `🎯 {count} intentos hasta ahora en esta ronda` | **from Sid** (his translation, unverified) |
| `fr` | `back_to_launchpad` | Sid's is far shorter and reads as arcade language. Mine (`VOLVER A LA PLATAFORMA DE LANZAMIENTO`) was the string I measured overflowing its button at 375px by up to 85%, so this fixes a real layout bug as well. | `RETOUR À LA BASE` | **from Sid** (his translation, unverified) |
| `fr` | `game_instructions` | **Mine regressed to formal** (`Tapez`). Sid's is informal, per house style. | `Tape l'un des mots-clés les plus populaires pour cet emoji — le premier à deviner chacun d'eux remporte les points !` | **from Sid** (his translation, unverified) |
| `fr` | `guess_activity` | Mine rendered *guesses* as `predicciones` / `prédictions` / `предположения` — predictions, which is wrong. Sid's attempts/tentatives/попыток reads correctly in a counter. | `🎯 {count} tentatives jusqu'ici ce tour` | **from Sid** (his translation, unverified) |
| `fr` | `guess_placeholder` | More casual and consistent with `Tape` in game_instructions. | `Tape un mot-clé…` | **from Sid** (his translation, unverified) |
| `fr` | `guess_wrong` | **Mine had a register bug I missed** — `Réessayez` is formal. Sid's is informal and shorter. | `Pas dans le top 10. Réessaie !` | **from Sid** (his translation, unverified) |
| `fr` | `kick_button` | `Supprimer` means delete (data); `Retirer` means remove (a person). | `Retirer` | **from Sid** (his translation, unverified) |
| `fr` | `loading` | `CHARGEMENT` matches the English's length; mine (`CHARGEMENT EN COURS`) was 172% longer and at risk of overflow. | `CHARGEMENT` | **from Sid** (his translation, unverified) |
| `fr` | `lobby_title` | Found by diffing against Sid's: mine still said `Code de la chambre` (bedroom). Set to `Code du salon` for consistency with `room_code_label` rather than Sid's `salle`. | `Code du salon` | claude-corrected, unverified |
| `fr` | `make_host_button` | **I missed this one.** I fixed `make_host_button` in es and ru but not fr, so mine still said `Créer un hôte` ("create a host"). Sid's `Nommer hôte` correctly means appoint. | `Nommer hôte` | **from Sid** (his translation, unverified) |
| `fr` | `submit_button` | `Valider` is the standard French UI verb for submitting an answer; `Envoyer` means send. | `Valider` | **from Sid** (his translation, unverified) |
| `pt-br` | `back_to_launchpad` | Sid's is far shorter and reads as arcade language. Mine (`VOLVER A LA PLATAFORMA DE LANZAMIENTO`) was the string I measured overflowing its button at 375px by up to 85%, so this fixes a real layout bug as well. | `VOLTAR À BASE` | **from Sid** (his translation, unverified) |
| `pt-pt` | `back_to_launchpad` | Sid's is far shorter and reads as arcade language. Mine (`VOLVER A LA PLATAFORMA DE LANZAMIENTO`) was the string I measured overflowing its button at 375px by up to 85%, so this fixes a real layout bug as well. | `VOLTAR À BASE` | **from Sid** (his translation, unverified) |
| `ru` | `back_to_launchpad` | Sid's is far shorter and reads as arcade language. Mine (`VOLVER A LA PLATAFORMA DE LANZAMIENTO`) was the string I measured overflowing its button at 375px by up to 85%, so this fixes a real layout bug as well. | `ВЕРНУТЬСЯ НА БАЗУ` | **from Sid** (his translation, unverified) |
| `ru` | `game_instructions` | Both Sid's and my Russian were formal (`Введите`). Rewritten informal. | `Введи одно из самых популярных ключевых слов для этого смайлика — кто первым угадает каждое, тот получает очки!` | claude-corrected, unverified |
| `ru` | `guess_activity` | Mine rendered *guesses* as `predicciones` / `prédictions` / `предположения` — predictions, which is wrong. Sid's attempts/tentatives/попыток reads correctly in a counter. | `🎯 {count} попыток в этом раунде` | **from Sid** (his translation, unverified) |
| `ru` | `guess_already_revealed` | Sid's `угадал(а)` handles player gender; mine was masculine-only and wordier. | `{who} уже угадал(а) «{keyword}».` | **from Sid** (his translation, unverified) |
| `ru` | `guess_correct` | `очков` is the ordinary Russian word for game points; mine (`баллов`) suggests exam marks. | `✅ «{keyword}» — +{points} очков!` | **from Sid** (his translation, unverified) |
| `ru` | `ready_up_button` | Sid's wording (`Я готов`, "I'm ready") is better than my formal imperative `Готовьтесь`; adopted his phrasing with sentence case instead of his Title Case. | `✅ Я готов` | claude-corrected, unverified |

## Factoids bundle

100 "Did you know" entries, `factoid_001`–`factoid_100`, translated into five
languages: **500 strings**. What follows is an honest account of what was and
was not reviewed.

### Reviewed

**1. Numeric validation — all 500, mechanically.** Every figure in the English
must appear in the translation. This ran on everything and is the one form of
coverage that is complete. It caught, and rejected until resolved:

- Seven Russian entries where a year range, a clause order, or a grouped
  thousand had changed shape. All resolved by teaching the validator that
  `1998–99` and `1998–1999` are the same range, and that clause reordering is
  not a dropped figure (pass/fail is on the set of figures; order is reported).
- Three genuine delexicalizations, now listed with reasons in
  `factoids.numeric-exempt.json`: `factoid_054` (`#1 most-used` → "the most
  used"), `factoid_097` (`COVID-related` → `COVID-19`, adding a figure), and
  `factoid_099` in Spanish (`10th` → `décimo`).

**2. Proper nouns and technical terms — all 100 entries, mechanically, against
a list of 31 names.** No Latin-script name was lost in any language: Apple,
Google, Microsoft, Unicode, Emojipedia, Kickstarter, SwiftKey, NTT DoCoMo,
iOS all survive verbatim. What the check flagged turned out to be correct
localization, not loss: `Consortium` → `Consorcio`/`Консорциум` (the common
noun translates, `Unicode` stays), `Moby-Dick` → `Моби Дик` (the standard
Russian title), `Herman Melville` → `Германа Мелвилла` (Cyrillic, declined).

**3. Factual drift — a targeted sample, NOT all 500.** 37 of 100 entries carry
causal, attributive or hedging language, which is where a mistranslation turns
a true claim false. I read a sample of those in **French and Spanish only**.
Causation, attribution and hedging held up in the ones I read ("because" →
"car"/"porque"; "Oxford analyzed with SwiftKey" → "analysées par Oxford en
collaboration avec SwiftKey"; "about 20%" → "environ 20 %").

One real drift found and overridden:

| Lang | Key | What was wrong | Status |
|---|---|---|---|
| `es` | `factoid_004` | English says the resemblance between *emoji* and *emotion* is **coincidental**; the Spanish said `coincidencia en la pronunciación` — "a coincidence in *pronunciation*", a specific claim the source does not make. French rendered it correctly as `ressemblance fortuite`. | claude-corrected, unverified |

### NOT reviewed

- **Factual accuracy of the Portuguese and Russian factoids.** Numbers and
  names are verified mechanically; the prose around them is not. A causal or
  attributive drift like the Spanish one above would not have been caught in
  those languages.
- **Most of the French and Spanish prose.** I read a sample of the 37
  high-risk entries, not all of them, and barely touched the other 63.
- **Register**, in any language. It was fourth priority and I did not get to
  it. These are encyclopedic statements, so register matters far less here
  than in the chrome, but it is unexamined.

Treat the mechanical checks as complete and the human judgement as a spot
check. **No factoid has been read by a native speaker in any language.**
