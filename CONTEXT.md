# Context

Pi Emphasis changes how an assistant reply is drawn in Pi's terminal. It never changes what is stored, copied or exported.

## Glossary

- **Pill**: `[[Word]]` in a reply, drawn as a rounded chip. Its color and icon come from its word.
- **Word**: the known term a pill starts with, such as Done or Needs you. Matching ignores case and extra spaces.
- **Detail**: text after the word inside the same pill, such as the "12/12" in "Passed 12/12".
- **Tone**: the color group a word belongs to: error, warning, success, danger, mode, owner, or neutral for any unknown word.
- **Synonym**: a word that is displayed as another word, so one state always reads the same (Completed is shown as Done).
- **Label**: a `##` heading, or bold text that opens a line or list item. A known label takes an icon.
- **Lead-in**: a bold word ending in a colon that introduces the action a pill calls for, such as "Check:".
- **Reply guidance**: the rules added to the system prompt as the `reply_style` section, in the terminal interface only.
- **Palette**: the colors taken from the current Pi theme. It is rebuilt when the theme changes.

## Rules and where each lives

All rules live in `index.ts` and are tested in `test/emphasis.test.ts` without Pi running.

- Which tone a word has, and which words agents are told to write: `VOCABULARY` (`core` is taught, `also` is only accepted), read by `toneOf`.
- Which icon a pill word has: `PILL_ICONS`.
- Which words are synonyms: `SYNONYMS`.
- Which labels take an icon: `LABEL_ICONS`, applied by `labelIconFor`.
- Which lead-in words take an icon after a pill: `ACTION_ICONS`.
- What the agent is told: `replyGuidance`, whose word lists are read from the tables above.
- How a pill label splits into icon, word and detail: `splitLabel`.
- What is left untouched (fenced code, inline code, links, HTML, escaped markers): `decorate`.

## Border

Pi hands the extension an assistant message's Markdown and the current theme. The extension returns Markdown with terminal color codes added. Before each run in the terminal interface, the extension also hands Pi the reply guidance as one prompt section. Nothing else crosses.
