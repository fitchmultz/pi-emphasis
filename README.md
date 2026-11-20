# Pi Emphasis

Replies you can scan. This [Pi](https://pi.dev/) extension turns `[[Done]]`, `[[Failed]]` and `[[Needs you]]` into colored pills with icons, gives headings and lead labels an icon from their word, and colors bold text, arrows and tree lines.

![A Pi reply about a failed deploy, with colored pills, icons and labels](screenshots/reply.png)

The reply above is an invented example about an imagined deploy. This is the same reply without the extension:

![The same reply as plain Markdown, with the pills shown as bracketed words](screenshots/without.png)

It changes only what is drawn. Stored messages, copied text and HTML exports keep the original Markdown. It calls no model and costs nothing to run.

## Requirements

| You need | Why | Without it |
|---|---|---|
| [Pi](https://github.com/earendil-works/pi) 1.5 or newer (checked on 1.5.0) | This is a Pi extension | It cannot be installed |
| A terminal that can draw [Nerd Font](https://www.nerdfonts.com/) symbols | The icons and the rounded pill ends are Nerd Font symbols | You see empty boxes or question marks. See [Set up your terminal](#set-up-your-terminal) |
| A terminal with color | Pills are colored backgrounds | Pills are drawn in reverse video, all in one color |
| `git` | `pi install` clones this repository | The install fails |

Checked on macOS only. Setup takes about two minutes if your terminal already has the symbols.

## Install

```sh
pi install git:github.com/johnlindquist/pi-emphasis
```

Then run `/reload` in Pi, or start Pi again.

- Update: `pi update --extensions`
- Try once without installing: `pi -e git:github.com/johnlindquist/pi-emphasis`
- Remove: `pi remove git:github.com/johnlindquist/pi-emphasis`

## Set up your terminal

**1. Check whether your terminal already draws the symbols.** Paste this into your shell:

```sh
printf '\ue0b6\uf00c \uf128 \uf007\ue0b4\n'
```

You should see a half circle, a check mark, a question mark, a person and another half circle. If you do, skip to step 3. Ghostty, kitty and WezTerm include these symbols, so they usually pass with any font.

**2. If you see boxes, install a Nerd Font and select it.** On macOS with Homebrew:

```sh
brew install --cask font-jetbrains-mono-nerd-font
```

Or download any family from [nerdfonts.com](https://www.nerdfonts.com/font-downloads). Then choose it as the terminal's font and run the check again:

| Terminal | Where the font is set |
|---|---|
| iTerm2 | Settings, Profiles, Text, Font |
| macOS Terminal | Settings, Profiles, Text, Font |
| VS Code terminal | the `terminal.integrated.fontFamily` setting, for example `JetBrainsMono Nerd Font` |
| Alacritty | `font.normal.family` in `alacritty.toml` |

To keep your current font, install only the symbols with `brew install --cask font-symbols-only-nerd-font` and add "Symbols Nerd Font" as a fallback font where your terminal supports one.

**3. Check it in Pi.** After installing the extension and running `/reload`, ask:

> Reply with one line that uses the pills [[Done]], [[Needs you]], [[Failed]] and [[Costs money]].

You should see four rounded pills in green, yellow, soft red and solid red, each with an icon.

**No Nerd Font, or you prefer plain chips?** Start Pi with the icons and rounded ends turned off. To make it permanent, put the two `export` lines in your shell profile, such as `~/.zshrc`:

```sh
export PI_EMPHASIS_PILL_ICONS=0
export PI_EMPHASIS_ROUND_CAPS=0
pi
```

## The rules come with it

An agent writes pills only when it is told how. In Pi's terminal interface the extension adds a `reply_style` section to the system prompt on every run, so there is nothing to paste into an `AGENTS.md`. The section tells the agent:

- that `<reply_style>` governs visual presentation only in this terminal, while user and project instructions govern substance, plain language, and when plain text is required
- to keep routine 1–2 line progress updates plain (exempt from bold lead labels, mode pills, and action lead-ins), while still using red, yellow, or solid-red pills for failures, blockers, asks, or risky/costly actions and reserving full structure for substantive replies
- which words to use for each color, requiring pills on failures/blockers, asks/unchecked claims, costly/risky actions, and substantive settled findings while keeping mode (`[[Verify]]`, etc.) and ownership pills optional when helpful
- to follow attention pills with a short bold action lead-in (`**Check:**`, `**Do:**`, `**Next:**`, etc.), and to write labels as plain words so the extension adds icons

The word lists in that section are read from the same tables that color the pills, so the rules and the drawing cannot drift apart. It adds about 700 tokens to the prompt. Print, JSON and RPC runs do not get the section, since nothing there draws pills.

To keep the drawing and write your own rules, set `PI_EMPHASIS_GUIDANCE=0`.

## Pills

Write `[[Word]]` beside the thing it describes. The word decides the color and the icon.

![Every pill word, grouped by color](screenshots/vocabulary.png)

> Screenshot shows the full palette from the initial release (`Qualify` renders identically to `Verify`, which replaces it in the guidance below).

| Color | Meaning | Words |
|---|---|---|
| Red | Something is wrong | Failed, Blocked, Broken, Unsafe, Rejected, Down |
| Yellow | Look here | Needs you, Decision, Unverified, Partial, Skipped, In progress, Pending, At risk, Review, Todo, Stale, Draft |
| Green | Settled | Done, Passed, Observed, Fixed, Live, Recommended, Keep, Ready, Merged, Safe, Verified, Shipped, Approved, Healthy |
| Solid red | Consequences | Costs money, Destructive, Irreversible |
| Cyan | Kind of work | Brainstorm, Investigate, Preview, Implement, Verify (also accepts Qualify) |
| Solid blue | Ownership | Owned, Shared, Foreign |
| Soft blue | Context | Inferred, New, Changed, Optional, and any other label |

- **Detail.** A known word may be followed by detail: `[[Passed 12/12]]`, `[[Failed: 3 tests]]`, `[[In progress 40%]]`.
- **Synonyms.** Completed, Complete, OK and Finished display as Done. Fail, Failing and Error display as Failed. Pass displays as Passed, Waiting as Pending, and Needs review as Review.
- **Your own icon.** A label that starts with a Nerd Font glyph keeps that glyph.
- **Length.** A label can be up to 32 characters. Longer ones are left as typed.

## Labels and shapes

- **Headings and lead labels.** A `##` heading, or bold text at the start of a line or list item, takes an icon when it is one of: Finding, Result, Status, Evidence, Cause, Effect, Fix, Risk, Limits, Cost, Decision, Options, Plan, Next, Why, How, Rule, Example, Checked, Verdict, Rollback, Undo, Review, Scoreboard, Terminal, Folder, File, Branch, Ideas, Pills, Colors, Icons. A trailing colon is fine.
- **Action lead-ins.** Bold **Check:**, **Do:**, **Next:**, **Unblock:**, **Left:**, **Run:**, **Guard:**, **Undo:** and **See:** take an icon anywhere in a line, so the action that follows a pill is easy to find: `[[Unverified]] the red pills on your screen. **Check:** run /reload.` The colon is required.
- **Bold.** `**anchor term**` keeps its weight and takes the theme's link color.
- **Marks.** `✓` takes the success color, `✗` the error color, and `→` the accent color.
- **Trees.** `├──` and `└──` are dimmed so the content stands out.

Your own messages, inline code, fenced code and escaped asterisks are left alone.

## Settings

Environment variables. Set them in the shell before starting Pi, or in your shell profile:

- `PI_EMPHASIS_COLOR`: theme color for bold text (default `mdLink`).
- `PI_EMPHASIS_ROUND_CAPS=0`: square chips, for fonts without Nerd Font symbols.
- `PI_EMPHASIS_PILL_ICONS=0`: no icons in pills or on labels.
- `PI_EMPHASIS_GUIDANCE=0`: do not add the reply-style rules to the prompt.

To add a word, an icon or a synonym, edit the tables at the top of [`index.ts`](index.ts). The rules are the `replyGuidance` function in the same file.

## Troubleshooting

| You see | Cause | Fix |
|---|---|---|
| `[[Done]]` as plain text | The extension is not loaded | Run `/reload`. Check that `pi list` shows pi-emphasis |
| Boxes or question marks in or around pills | The terminal has no Nerd Font symbols | [Set up your terminal](#set-up-your-terminal), or turn icons and rounded ends off |
| Icons that overlap the next letter | The font draws its icons two cells wide | Use the "Mono" variant of the Nerd Font, such as JetBrainsMono Nerd Font Mono |
| Pills that are all one color, in reverse video | Pi's theme has no panel colors, which happens with the `system` theme when the terminal reports none | Choose a theme with `/theme`, such as `dark` |
| Solid red, cyan or blue pills in odd shades | Those three use your terminal's own colors | Change the terminal's color theme |
| Bold that looks no heavier than normal text | The terminal draws normal text at a medium weight, or its font has no real bold | Choose a font with a distinct bold. In Ghostty, `font-style-bold` selects a heavier face |
| The agent writes no pills | The rules reach the agent only in Pi's terminal interface, and not when `PI_EMPHASIS_GUIDANCE=0` | Unset the variable. Print, JSON and RPC runs never get the rules |
| Pills inside code blocks stay as typed | Code is left alone on purpose | Nothing to fix |

## Limits

- A bold span that continues onto a second source line is colored only on its first line.
- Checked on macOS only, in Ghostty and the Herdr app.

## Development

Use the Node version in `.nvmrc` (`24.22.3`).

```sh
npm ci --ignore-scripts
npm run check                # lockfile, types, and tests
python3 demo/shots.py        # redraw the demo replies in a real Pi session, as HTML to screenshot
```

`demo/` holds the two example replies. `sgr-sampler.sh` prints every terminal text style so you can see which ones your terminal draws.
