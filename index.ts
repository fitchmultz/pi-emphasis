// pi-emphasis: display-only emphasis for assistant replies in Pi's terminal.
//
//   **anchor term**   bold keeps its weight and takes a theme color (link blue by default)
//   ✓ / ✗             take the success and error colors
//   [[Blocked]]       becomes a rounded status pill colored by its word, with that word's icon
//
// Stored messages, copied text, and HTML exports keep the original Markdown.
// In the terminal interface it also adds a reply_style section to the system prompt, telling the
// model how to write these (PI_EMPHASIS_GUIDANCE=0 turns that off).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Marked, type Token, type Tokens } from "@earendil-works/pi-tui";

type Colorize = (text: string) => string;
export type PillTone = "success" | "error" | "warning" | "danger" | "mode" | "owner" | "neutral";

export interface Palette {
	/** Wraps bold text in a color. */
	bold: Colorize;
	/** Raw foreground escape used to restore heading color after inline pills or marks. */
	headingAnsi?: string;
	/** Raw foreground escape used to restore blockquote color after inline pills or marks. */
	quoteAnsi?: string;
	passed?: Colorize;
	failed?: Colorize;
	/** Opening escapes for each pill tone: label colors and the cap color. */
	pills?: Record<PillTone, { label: string; cap: string }>;
	/** Colors for arrows and tree connectors. */
	arrow?: Colorize;
	tree?: Colorize;
	/** Rounded Nerd Font end caps; false draws square chips with a space on each side. */
	roundCaps?: boolean;
}

/** Minimal slice of Pi's Theme used to build a palette. */
export interface ThemeLike {
	fg(color: never, text: string): string;
	getFgAnsi(color: never): string;
	getBgAnsi(color: never): string;
}

/** Each tone's words. `core` are the words agents are told to write; `also` are accepted and colored the same. */
export const VOCABULARY: Record<Exclude<PillTone, "neutral">, { core: string[]; also: string[] }> = {
	error: { core: ["Failed", "Blocked", "Broken", "Unsafe"], also: ["fail", "failing", "error", "rejected", "down"] },
	warning: { core: ["Needs you", "Decision", "Unverified", "Partial", "Skipped", "In progress", "Pending", "At risk"], also: ["needs review", "waiting", "review", "todo", "stale", "draft"] },
	success: { core: ["Done", "Passed", "Observed", "Fixed", "Live", "Recommended", "Keep"], also: ["pass", "ready", "merged", "safe", "verified", "shipped", "ok", "approved", "complete", "completed", "finished", "healthy"] },
	danger: { core: ["Costs money", "Destructive", "Irreversible"], also: [] },
	mode: { core: ["Brainstorm", "Investigate", "Preview", "Implement", "Verify"], also: ["qualify"] },
	owner: { core: ["Owned", "Shared", "Foreign"], also: [] },
};
/** Words that are soft blue like any unknown label, but have an icon and a place in the guidance. */
export const CONTEXT_WORDS = ["Inferred", "New", "Changed", "Optional"];

const TONE_WORDS = Object.fromEntries(
	Object.entries(VOCABULARY).map(([tone, words]) => [tone, [...words.core, ...words.also].map((w) => w.toLowerCase())]),
) as Record<Exclude<PillTone, "neutral">, string[]>;

// Font Awesome glyphs from the Nerd Font set: one cell wide in every terminal.
const CHECK = "\uf00c";
const CROSS = "\uf00d";
const CLOCK = "\uf017";
/** The icon each known pill word carries. Words without an entry stay text-only. */
const PILL_ICONS: Record<string, string> = {
	done: CHECK, passed: CHECK, pass: CHECK, complete: CHECK, completed: CHECK, ok: CHECK, verified: CHECK,
	observed: "\uf06e", recommended: "\uf005", fixed: "\uf0ad", live: "\uf135", shipped: "\uf135", approved: "\uf164",
	failed: CROSS, fail: CROSS, failing: CROSS, error: CROSS, rejected: CROSS,
	blocked: "\uf05e", broken: "\uf127", unsafe: "\uf132", down: "\uf063",
	"needs you": "\uf007", decision: "\uf126", unverified: "\uf128", "at risk": "\uf071",
	"in progress": "\uf110", pending: CLOCK, waiting: CLOCK, partial: "\uf042", skipped: "\uf04e",
	inferred: "\uf0eb", new: "\uf067", changed: "\uf040", optional: "\uf10c", "costs money": "\uf155",
	destructive: "\uf1f8", irreversible: "\uf023", review: "\uf06e", stale: "\uf1da", draft: "\uf044", safe: "\uf132",
	brainstorm: "\uf0eb", investigate: "\uf002", preview: "\uf06e", implement: "\uf0ad", verify: "\uf0c3", qualify: "\uf0c3",
	owned: "\uf007", shared: "\uf0c0", foreign: "\uf023",
	keep: "\uf08d", ready: CHECK, merged: "\uf126", healthy: "\uf004", todo: "\uf0ae",
};

/** Words that display as one canonical word, so the same state always reads the same. */
const SYNONYMS: Record<string, string> = {
	complete: "Done", completed: "Done", ok: "Done", finished: "Done", pass: "Passed",
	fail: "Failed", failing: "Failed", error: "Failed", waiting: "Pending", "needs review": "Review",
};

/** The icon a heading or a line's leading bold label takes from its word. */
const LABEL_ICONS: Record<string, string> = {
	finding: "\uf002", terminal: "\uf120", folder: "\uf07b", file: "\uf15b", branch: "\uf126", review: "\uf06e",
	ideas: "\uf0eb", cause: "\uf0e7", fix: "\uf0ad", risk: "\uf071", limits: "\uf071", next: "\uf061", rollback: "\uf0e2",
	undo: "\uf0e2", options: "\uf0ca", result: "\uf11e", why: "\uf059", how: "\uf013", cost: "\uf155", rule: "\uf0e3",
	example: "\uf121", checked: "\uf00c", pills: "\uf02b", colors: "\uf1fc", icons: "\uf005", scoreboard: "\uf080",
	verdict: "\uf0e3", effect: "\uf140", evidence: "\uf06e", plan: "\uf0ae", status: "\uf012", decision: "\uf126",
};

// A label may open with its own Private Use Area glyph, which wins over the table's icon.
const OWN_ICON = /^\s*([\ue000-\uf8ff]|[\u{f0000}-\u{ffffd}])\s*/u;

const KNOWN = [...new Set([...Object.values(TONE_WORDS).flat(), ...Object.keys(PILL_ICONS), ...Object.keys(SYNONYMS)])].sort((a, b) => b.length - a.length);

/** A pill label read as its word: a known word may be followed by detail ("Passed 12/12", "Failed: 3 tests"). */
function splitLabel(label: string): { icon: string | undefined; word: string; key: string } {
	const own = label.match(OWN_ICON);
	const text = (own ? label.slice(own[0].length) : label).replace(/\s+/g, " ").trim();
	const lower = text.toLowerCase();
	const known = KNOWN.find((k) => lower === k || (lower.startsWith(k) && /[ :]/.test(lower[k.length])));
	const canonical = known ? SYNONYMS[known] : undefined;
	const key = (canonical ?? known ?? lower).toLowerCase();
	const word = canonical && known ? canonical + text.slice(known.length) : text;
	return { icon: own?.[1] ?? PILL_ICONS[key], word, key };
}

export function toneOf(label: string): PillTone {
	const { key } = splitLabel(label);
	for (const tone of ["danger", "error", "warning", "success", "mode", "owner"] as const) {
		if (TONE_WORDS[tone].includes(key)) return tone;
	}
	return "neutral";
}

/** A background escape turned into the same color as a foreground, for pill caps. */
function bgToFg(bg: string): string {
	return bg.replace(/\x1b\[48;/g, "\x1b[38;").replace(/\x1b\[(4|10)([0-7])m/g, (_, p: string, n: string) => `\x1b[${p === "4" ? "3" : "9"}${n}m`);
}

// Indexed ANSI 0–7 foreground escapes; bold-is-bright terminals promote these to bright 8–15 when bold.
const LOW_INDEXED_FG = /^\x1b\[(?:3[0-7]|38;5;[0-7])m$/;

export function createPalette(theme: ThemeLike, boldColor = "mdLink"): Palette {
	const fg = (name: string) => (text: string) => theme.fg(name as never, text);
	const tone = (labelFg: string, bg: string) => {
		const bgAnsi = theme.getBgAnsi(bg as never);
		// A theme without its own panel colors (Pi's system theme when the terminal reports
		// none) draws pills in reverse video: the tone's color becomes the background.
		if (!bgAnsi || /^\x1b\[49m$/.test(bgAnsi)) {
			const fgAnsi = theme.getFgAnsi((labelFg === "text" ? "accent" : labelFg) as never);
			return { label: `${fgAnsi}\x1b[7m`, cap: fgAnsi };
		}
		return { label: bgAnsi + theme.getFgAnsi(labelFg as never), cap: bgToFg(bgAnsi) };
	};
	const solidTone = (color: string, fallbackCode: number) => {
		const fgAnsi = theme.getFgAnsi(color as never);
		const base = fgAnsi && !/^\x1b\[39m$/.test(fgAnsi) ? fgAnsi : `\x1b[${fallbackCode}m`;
		return { label: `${base}\x1b[7m`, cap: base };
	};
	return {
		bold: fg(boldColor),
		headingAnsi: theme.getFgAnsi("mdHeading" as never),
		quoteAnsi: theme.getFgAnsi("mdQuote" as never),
		passed: fg("success"),
		failed: fg("error"),
		pills: {
			success: tone("success", "toolSuccessBg"),
			error: tone("error", "toolErrorBg"),
			warning: tone("warning", "searchMatchBg"),
			neutral: tone("text", "selectedBg"),
			// Solid reverse-video chips in the active theme's error, cyan, and blue tones so
			// they stay consistent across terminals and do not split under bold-is-bright.
			danger: solidTone("error", 31),
			mode: solidTone("syntaxVariable", 36),
			owner: solidTone("mdLink", 34),
		},
		arrow: fg("accent"),
		tree: fg("dim"),
		roundCaps: process.env.PI_EMPHASIS_ROUND_CAPS !== "0",
	};
}

// Pi renders replies with marked (re-exported by pi-tui), so the same parser decides structure.
const parser = new Marked();

function matchRaw(markdown: string, raw: string, from: number, limit: number): [number, number] | undefined {
	const trimmed = raw.replace(/\n+$/, "");
	if (!trimmed) return undefined;
	if (!trimmed.includes("\n") && !trimmed.includes("|")) {
		const index = markdown.indexOf(trimmed, from);
		return index < 0 || index + trimmed.length > limit ? undefined : [index, index + trimmed.length];
	}
	// marked strips each line's list indent or blockquote ">" prefix, and unescapes "\|" in table cells.
	const lines = trimmed
		.split("\n")
		.map((line) => line.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "|" ? "\\\\?\\|" : `\\${ch}`)));
	const pattern = new RegExp(lines.join("\\r?\\n[ >]*"));
	const match = pattern.exec(markdown.slice(from, limit));
	return match ? [from + match.index, from + match.index + match[0].length] : undefined;
}

/** Lead-in words that name the action a pill calls for. With a colon they take an icon anywhere in a line. */
const ACTION_ICONS: Record<string, string> = {
	check: "\uf046", do: "\uf0a4", next: "\uf061", unblock: "\uf09c", left: "\uf141", run: "\uf04b", guard: "\uf132", undo: "\uf0e2", see: "\uf08e",
};

const PILL_RE = /\[\[([^\[\]\n]{1,32})\]\]/g;
const LINE_LEAD_PREFIX = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d+[.)])[ \t]+)?(?:\[[ xX]\][ \t]+)?(?:[├└]──[ \t]+)?$/;
const ATX_HEADING_PREFIX = /^ {0,3}#{1,6}[ \t]+/;
const TRAILING_PILLS = /(?:\s*\[\[[^\[\]\n]{1,32}\]\])+\s*$/;

/** Return the Nerd Font icon for a known heading or leading bold label, or undefined. */
function labelIconFor(label: string): string | undefined {
	if (OWN_ICON.test(label) || process.env.PI_EMPHASIS_PILL_ICONS === "0") return undefined;
	const word = label.replace(/[:\s]+$/, "").trim().toLowerCase();
	return LABEL_ICONS[word] ?? (label.trimEnd().endsWith(":") ? ACTION_ICONS[word] : undefined);
}

/** Return the Nerd Font icon for an inline action lead-in (`**Check:**`, `**Next:**`, etc.). */
function actionIconFor(label: string): string | undefined {
	if (OWN_ICON.test(label) || process.env.PI_EMPHASIS_PILL_ICONS === "0") return undefined;
	if (!label.trimEnd().endsWith(":")) return undefined;
	const word = label.slice(0, -1).trim().toLowerCase();
	return ACTION_ICONS[word];
}

function isBareAutolink(token: Token | undefined): boolean {
	return token?.type === "link" && !token.raw.startsWith("[") && !token.raw.startsWith("<");
}

interface DecorateContext {
	headingDepth: number;
	inBold: boolean;
	inQuote: boolean;
	boldOpen: string;
	boldClose: string;
	pendingIcon?: string;
}

function pill(label: string, palette: Palette, disableUnderline: boolean): string {
	const style = palette.pills![toneOf(label)];
	// No-break spaces keep a two-word pill on one line when Pi wraps the paragraph.
	const { icon, word } = splitLabel(label);
	const text = (icon && word && process.env.PI_EMPHASIS_PILL_ICONS !== "0" ? `${icon} ${word}` : word || label.trim()).replace(/ /g, "\u00a0");
	const [left, right] = palette.roundCaps ? ["\ue0b6", "\ue0b4"] : ["", ""];
	const pad = palette.roundCaps ? "" : "\u00a0";
	// Terminals with bold-is-bright promote bold ANSI 0–7 to bright 8–15; match bold on caps
	// for those codes so caps and body stay the same shade.
	const capBold = LOW_INDEXED_FG.test(style.cap);
	const capL = left ? `${capBold ? "\x1b[1m" : ""}${style.cap}${left}${capBold ? "\x1b[22m" : ""}\x1b[39m` : "";
	const capR = right ? `${capBold ? "\x1b[1m" : ""}${style.cap}${right}${capBold ? "\x1b[22m" : ""}\x1b[39m` : "";
	// Use combined SGR 24;22 so chalk.underline() on H1 headings does not rewrite \x1b[24m back to \x1b[24m\x1b[4m.
	const prefix = disableUnderline ? "\x1b[24;22m" : "";
	return `${prefix}${capL}${style.label}\x1b[1m${pad}${text}${pad}\x1b[22;27m\x1b[39m\x1b[49m${capR}`;
}

function restoreAfterPill(ctx: DecorateContext, palette: Palette): string {
	if (ctx.headingDepth > 0) {
		const underline = ctx.headingDepth === 1 ? "\x1b[4m" : "";
		return `\x1b[1m${underline}${palette.headingAnsi ?? ""}`;
	}
	if (ctx.inBold) return `\x1b[1m${ctx.boldOpen}`;
	if (ctx.inQuote) return palette.quoteAnsi ?? "";
	return "";
}

function restoreAfterMark(ctx: DecorateContext, palette: Palette): string {
	if (ctx.headingDepth > 0) return palette.headingAnsi ?? "";
	if (ctx.inBold) return ctx.boldOpen;
	if (ctx.inQuote) return palette.quoteAnsi ?? "";
	return "";
}

function decorateMarksAndPills(text: string, ctx: DecorateContext, palette: Palette): string {
	// Avoid emitting \x1b[ before an unparsed "](" on the same line, or marked pairs the CSI "[" with "](" as a fake link.
	if (text.includes("](")) {
		return text
			.split(/(\r?\n)/)
			.map((part, idx) => {
				if (idx % 2 === 1) return part;
				const closeIdx = part.lastIndexOf("](");
				if (closeIdx < 0) return decorateMarksAndPills(part, ctx, palette);
				const splitAt = closeIdx + 2;
				return part.slice(0, splitAt) + decorateMarksAndPills(part.slice(splitAt), ctx, palette);
			})
			.join("");
	}
	const afterMark = restoreAfterMark(ctx, palette);
	let out = text;
	if (palette.passed) out = out.replace(/[✓✔]/g, (m) => palette.passed!(m) + afterMark);
	if (palette.failed) out = out.replace(/[✗✘]/g, (m) => palette.failed!(m) + afterMark);
	if (palette.arrow) out = out.replace(/→/g, (m) => palette.arrow!(m) + afterMark);
	if (palette.tree) out = out.replace(/[├└]──/g, (m) => palette.tree!(m) + afterMark);
	if (palette.pills) {
		const afterPill = restoreAfterPill(ctx, palette);
		const disableUnderline = ctx.headingDepth === 1;
		out = out.replace(PILL_RE, (match, label: string) => {
			if (!label.trim()) return match;
			return pill(label, palette, disableUnderline) + afterPill;
		});
	}
	return out;
}

function decorateBoldLine(
	segment: string,
	ctx: DecorateContext,
	palette: Palette,
	avoidLeadingEdge: boolean,
	avoidTrailingEdge: boolean,
): string {
	const match = segment.match(/^([ \t]*)([\s\S]*?)([ \t]*)$/);
	if (!match) return segment;
	const [, lead, body, trail] = match;
	if (!body) return segment;

	let leftKeep = lead;
	let core = body;
	let rightKeep = trail;

	// Keep ANSI escapes away from an adjacent bare URL/email autolink so marked's GFM
	// autolink regex does not absorb escape bytes into the URL or email address.
	if (avoidLeadingEdge && !lead) {
		const split = core.match(/^(\S+)([ \t]+)([\s\S]+)$/);
		if (!split) return decorateMarksAndPills(segment, { ...ctx, inBold: false }, palette);
		leftKeep = split[1] + split[2];
		core = split[3];
	}
	if (avoidTrailingEdge && !trail) {
		const split = core.match(/^([\s\S]*?)([^A-Za-z0-9._+-]+)$/);
		if (!split || !split[1]) return decorateMarksAndPills(segment, { ...ctx, inBold: false }, palette);
		core = split[1];
		rightKeep = split[2];
	}

	return `${leftKeep}${ctx.boldOpen}${decorateMarksAndPills(core, ctx, palette)}${ctx.boldClose}${rightKeep}`;
}

function decorateTextSlice(
	slice: string,
	ctx: DecorateContext,
	palette: Palette,
	prevSibling: Token | undefined,
	nextSibling: Token | undefined,
): string {
	const withIcon = ctx.pendingIcon ? `${ctx.pendingIcon} ${slice}` : slice;
	if (!ctx.inBold) return decorateMarksAndPills(withIcon, ctx, palette);

	const parts = withIcon.split(/(\r?\n)/);
	const lastLineIdx = parts.length - 1;
	for (let i = 0; i < parts.length; i += 2) {
		const line = parts[i];
		if (!line) continue;
		if (line.includes("](")) {
			parts[i] = decorateMarksAndPills(line, { ...ctx, inBold: false }, palette);
			continue;
		}
		// On continuation lines inside a blockquote, keep the leading ">" marker outside ANSI escapes.
		let quotePrefix = "";
		let content = line;
		if (i > 0 && ctx.inQuote) {
			const qm = line.match(/^[ \t]*(?:>[ \t]?)+/);
			if (qm) {
				quotePrefix = qm[0];
				content = line.slice(quotePrefix.length);
			}
		}
		const avoidLeading = i === 0 && isBareAutolink(prevSibling);
		const avoidTrailing = i === lastLineIdx && isBareAutolink(nextSibling);
		parts[i] = quotePrefix + decorateBoldLine(content, ctx, palette, avoidLeading, avoidTrailing);
	}
	return parts.join("");
}

/** Apply colors and icons to assistant Markdown using marked's token tree so code and links stay intact. */
export function decorate(markdown: string, palette: Palette): string {
	const [boldOpen, boldClose] = palette.bold("\u0000").split("\u0000") as [string, string];
	markdown = markdown.replace(/\t/g, "   "); // Pi turns tabs into three spaces before parsing, so parse what it parses.

	const edits: Array<[number, number, string]> = [];

	function walk(tokens: readonly Token[], from: number, limit: number, ctx: DecorateContext): number {
		let pos = from;
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			if (
				token.type === "code" ||
				token.type === "codespan" ||
				token.type === "html" ||
				token.type === "link" ||
				token.type === "image" ||
				token.type === "hr" ||
				token.type === "def" ||
				token.type === "checkbox" ||
				token.type === "br" ||
				token.type === "space"
			) {
				const hit = token.raw ? matchRaw(markdown, token.raw, pos, limit) : undefined;
				if (hit) pos = hit[1];
				continue;
			}

			if (token.type === "escape") {
				const hit = matchRaw(markdown, token.raw, pos, limit);
				if (hit) {
					if (ctx.inBold) {
						const slice = markdown.slice(hit[0], hit[1]);
						edits.push([hit[0], hit[1], `${ctx.boldOpen}${slice}${ctx.boldClose}`]);
					}
					pos = hit[1];
				}
				continue;
			}

			if (token.type === "heading") {
				const heading = token as Tokens.Heading;
				const hit = matchRaw(markdown, heading.raw, pos, limit);
				if (!hit) continue;
				const rawSlice = markdown.slice(hit[0], hit[1]);
				const prefix = rawSlice.match(ATX_HEADING_PREFIX)?.[0] ?? rawSlice.match(/^ {0,3}/)?.[0] ?? "";
				const titleStart = hit[0] + prefix.length;
				const headingTitle = heading.text.replace(TRAILING_PILLS, "").trim();
				const icon = labelIconFor(headingTitle);
				if (icon) edits.push([titleStart, titleStart, `${icon} `]);
				if (heading.tokens?.length) {
					walk(heading.tokens, titleStart, hit[1], { ...ctx, headingDepth: heading.depth, inBold: false, pendingIcon: undefined });
				}
				pos = hit[1];
				continue;
			}

			if (token.type === "blockquote") {
				const hit = matchRaw(markdown, token.raw, pos, limit);
				if (!hit) continue;
				if ("tokens" in token && Array.isArray(token.tokens)) {
					walk(token.tokens, hit[0], hit[1], { ...ctx, inQuote: true, pendingIcon: undefined });
				}
				pos = hit[1];
				continue;
			}

			if (token.type === "list" && "items" in token) {
				const list = token as Tokens.List;
				const hit = matchRaw(markdown, list.raw, pos, limit);
				const listEnd = hit ? hit[1] : limit;
				let itemPos = hit ? hit[0] : pos;
				for (const item of list.items) {
					const itemHit = matchRaw(markdown, item.raw, itemPos, listEnd);
					const start = itemHit ? itemHit[0] : itemPos;
					const end = itemHit ? itemHit[1] : listEnd;
					walk(item.tokens, start, end, { ...ctx, pendingIcon: undefined });
					itemPos = itemHit ? itemHit[1] : end;
				}
				pos = hit ? Math.max(itemPos, hit[1]) : itemPos;
				continue;
			}

			if (token.type === "table" && "header" in token && "rows" in token) {
				const table = token as Tokens.Table;
				const hit = matchRaw(markdown, table.raw, pos, limit);
				const tableEnd = hit ? hit[1] : limit;
				let cellPos = hit ? hit[0] : pos;
				for (const cell of table.header) cellPos = walk(cell.tokens, cellPos, tableEnd, { ...ctx, pendingIcon: undefined });
				for (const row of table.rows) {
					for (const cell of row) cellPos = walk(cell.tokens, cellPos, tableEnd, { ...ctx, pendingIcon: undefined });
				}
				pos = hit ? Math.max(cellPos, hit[1]) : cellPos;
				continue;
			}

			if (token.type === "strong") {
				const strong = token as Tokens.Strong;
				const hit = matchRaw(markdown, strong.raw, pos, limit);
				if (!hit) continue;
				const openMark = markdown.slice(hit[0], hit[0] + 2);
				const closeMark = markdown.slice(hit[1] - 2, hit[1]);
				const hasDelim = (openMark === "**" || openMark === "__") && openMark === closeMark;
				const innerStart = hasDelim ? hit[0] + 2 : hit[0];
				const innerEnd = hasDelim ? hit[1] - 2 : hit[1];

				let icon: string | undefined;
				const plainChildOnly = strong.tokens.length === 1 && strong.tokens[0].type === "text" && !strong.tokens[0].tokens?.length;
				if (plainChildOnly && !strong.text.includes("\n") && strong.text.length <= 32) {
					const lineStart = markdown.lastIndexOf("\n", hit[0] - 1) + 1;
					const beforeOnLine = markdown.slice(lineStart, hit[0]);
					if (LINE_LEAD_PREFIX.test(beforeOnLine)) icon = labelIconFor(strong.text);
					if (!icon) icon = actionIconFor(strong.text);
				}

				walk(strong.tokens, innerStart, innerEnd, {
					...ctx,
					inBold: ctx.headingDepth === 0,
					pendingIcon: icon,
				});
				pos = hit[1];
				continue;
			}

			if (token.type === "em" || token.type === "del") {
				const hit = matchRaw(markdown, token.raw, pos, limit);
				if (!hit) continue;
				const delimLen = token.type === "em" ? 1 : token.raw.startsWith("~~") ? 2 : 1;
				if ("tokens" in token && Array.isArray(token.tokens)) {
					walk(token.tokens, hit[0] + delimLen, hit[1] - delimLen, { ...ctx, pendingIcon: undefined });
				}
				pos = hit[1];
				continue;
			}

			if ("tokens" in token && Array.isArray(token.tokens) && token.tokens.length > 0) {
				const hit = token.raw ? matchRaw(markdown, token.raw, pos, limit) : undefined;
				const start = hit ? hit[0] : pos;
				const end = hit ? hit[1] : limit;
				const nextPos = walk(token.tokens, start, end, ctx);
				pos = hit ? Math.max(nextPos, hit[1]) : nextPos;
				continue;
			}

			if (token.type === "text" && token.raw) {
				const hit = matchRaw(markdown, token.raw, pos, limit);
				if (hit) {
					const slice = markdown.slice(hit[0], hit[1]);
					const next = decorateTextSlice(slice, ctx, palette, tokens[i - 1], tokens[i + 1]);
					if (next !== slice) edits.push([hit[0], hit[1], next]);
					pos = hit[1];
				}
				continue;
			}

			if (token.raw) {
				const hit = matchRaw(markdown, token.raw, pos, limit);
				if (hit) pos = hit[1];
			}
		}
		return pos;
	}

	walk(parser.lexer(markdown), 0, markdown.length, {
		headingDepth: 0,
		inBold: false,
		inQuote: false,
		boldOpen,
		boldClose,
	});

	if (edits.length === 0) return markdown;
	let out = "";
	let cursor = 0;
	for (const [start, end, replacement] of edits) {
		if (start < cursor) continue;
		out += markdown.slice(cursor, start) + replacement;
		cursor = end;
	}
	return out + markdown.slice(cursor);
}

const pills = (words: string[]) => words.map((w) => `[[${w}]]`).join(", ");
const titled = (words: string[]) => words.map((w) => w[0].toUpperCase() + w.slice(1)).join(", ");
const actionLabels = (words: string[]) => words.map((w) => `**${w[0].toUpperCase() + w.slice(1)}:**`).join(", ");

/** The reply-style rules given to the model, with every word list read from the tables that draw them. */
export function replyGuidance(): string {
	const v = VOCABULARY;
	return `Plain, natural human prose always takes precedence over formatting decoration. Never turn questions, blockers, or explanations into dense pill-and-label chains or cryptic shorthand. These rules shape visual presentation only in this terminal, which colors pills, adds icons, and cannot change text size. User and project instructions govern substance, plain language, and when plain text is required.

- **Brief updates stay plain.** Keep routine 1–2 line progress updates in plain prose, without bold lead labels, mode pills, or action lead-ins (an optional [[In progress]] pill is fine). Still use red, yellow, or solid-red pills for real failures, blockers, asks, or risky/costly actions. Save headings and multi-part layouts for longer replies (findings, comparisons, final summaries).
- **Status pills (sparse and purposeful).** Write \`[[Word]]\` beside its subject (optional short detail: [[Passed 12/12]], [[Failed: 3 tests]]). At most one pill per bullet, heading, or cell (except \`→\` sequences and a single count line); never invent status words:
  - **Red (use for real failures or blockers):** ${pills(v.error.core)}.
  - **Yellow (use for real asks, decisions, or notable risks):** ${pills(v.warning.core)}.
  - **Solid red (use before risky or costly actions):** ${pills(v.danger.core)}.
  - **Green (optional when scanning benefits):** ${pills(v.success.core)}.
  - **Cyan (kind of work, optional):** ${pills(v.mode.core)}.
  - **Blue (ownership outside task files, optional):** ${pills(v.owner.core)}.
  - **Soft blue (context, optional):** ${pills(CONTEXT_WORDS)}, and any other short label.
  - **Evidence pills (optional):** use [[Observed]], [[Inferred]], or [[Unverified]] only when distinguishing unverified guesses from observed facts helps—do not tag every claim.
- **Action lead-ins (optional).** Do not pair every pill with a bold lead-in. Use ${actionLabels(Object.keys(ACTION_ICONS))} only when a short scannable action line helps, never when a plain sentence is clearer.
- **Labels and shapes (optional).** Only when grouping helps, use short \`##\` headings (\`###\` shows hash marks) or plain-word bold lead labels—never type icon glyphs or label every bullet. Icon-backed labels: ${titled(Object.keys(LABEL_ICONS))}. Only when clearer than plain prose or lists, use \`├──\`/\`└──\` (indented, no list dash) for trees, \`→\` for sequences, \`✓\`/\`✗\` for checked items, and blockquotes for dim asides.
- **Bold and code.** Bold selectively when a key term aids scanning—no quota per paragraph or bullet. Reserve inline code for copyable literals (paths, commands, exact identifiers).
- **Closing line.** If instructions require a final status line, let that single line carry the closing state or ask (for example [[Done]], [[In progress]], or [[Needs you]]) rather than adding a second closing line.
- **Clean copyable text.** Omit pills and tree shapes inside paths, commands, code, literal output, machine-readable data, copy-paste blocks, external drafts, and plain-text requests.`;
}

/** Earlier name, kept for callers of the first release. */
export const colorBold = (markdown: string, palette: Palette | Colorize) =>
	decorate(markdown, typeof palette === "function" ? { bold: palette } : palette);

export default function emphasis(pi: ExtensionAPI) {
	let currentTheme: (() => ThemeLike) | undefined;
	let built: { theme: ThemeLike; palette: Palette } | undefined;
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		currentTheme = () => ctx.ui.theme as unknown as ThemeLike;
	});
	// The rules travel with the renderer: only a session that draws pills is told to write them.
	pi.on("before_agent_start", (event) => {
		const sections = (event.systemPromptOptions.sections ??= {});
		if (currentTheme && process.env.PI_EMPHASIS_GUIDANCE !== "0") sections.reply_style = replyGuidance();
		else delete sections.reply_style;
	});
	pi.registerMarkdownTransformer((markdown, context) => {
		if (!currentTheme || context.messageType !== "assistant") return markdown;
		// Rebuild when the theme changes, so /theme switches recolor new output.
		const theme = currentTheme();
		if (built?.theme !== theme) built = { theme, palette: createPalette(theme, process.env.PI_EMPHASIS_COLOR || "mdLink") };
		return decorate(markdown, built.palette);
	});
}
