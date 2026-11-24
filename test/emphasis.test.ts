import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	MarkdownMessageType,
	MarkdownTransformContext,
	MarkdownTransformer,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import emphasis, {
	CONTEXT_WORDS,
	VOCABULARY,
	createPalette,
	decorate,
	replyGuidance,
	toneOf,
	type PillTone,
	type ThemeLike,
} from "../index.ts";

// A theme whose colors are readable tags, so tests can assert on what was colored.
function createTaggedTheme(prefix = ""): ThemeLike {
	const tag = (color: string) => (prefix ? `${prefix}:${color}` : color);
	return {
		fg: (color: string, text: string) => `<${tag(color)}>${text}</>`,
		getFgAnsi: (color: string) => `\x1b[38;fg-${tag(color)}m`,
		getBgAnsi: (color: string) => `\x1b[48;bg-${tag(color)}m`,
	} as unknown as ThemeLike;
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(vars)) {
		previous.set(key, process.env[key]);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		fn();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

const theme = createTaggedTheme();
const palette = createPalette(theme);
const plain = (text: string) =>
	decorate(text, palette).replace(/\x1b\[[0-9;a-zA-Z-]*m/g, "").replace(/[\ue0b4\ue0b6]/g, "|").replace(/\u00a0/g, " ");

describe("pill tone", () => {
	const cases: readonly [string, PillTone][] = [
		["Failed", "error"], ["Blocked", "error"], ["Needs you", "warning"], ["Decision", "warning"],
		["Done", "success"], ["Observed", "success"], ["Costs money", "danger"], ["Irreversible", "danger"],
		["Implement", "mode"], ["Verify", "mode"], ["Qualify", "mode"], ["Shared", "owner"],
		["Inferred", "neutral"], ["Anything else", "neutral"],
	];
	for (const [word, tone] of cases) {
		test(`${word} is ${tone}`, () => assert.equal(toneOf(word), tone));
	}

	test("case and spacing do not matter", () => assert.equal(toneOf("  needs   YOU "), "warning"));
	test("a known word may carry detail", () => {
		assert.equal(toneOf("Passed 12/12"), "success");
		assert.equal(toneOf("Failed: 3 tests"), "error");
	});
	test("a longer word that starts like a known one is not that word", () => assert.equal(toneOf("Donezo"), "neutral"));
});

describe("pills", () => {
	test("a known word gets its icon", () => assert.equal(plain("[[Done]]"), "|\uf00c Done|"));
	test("Verify and legacy Qualify render with the mode icon", () => {
		assert.equal(plain("[[Verify]]"), "|\uf0c3 Verify|");
		assert.equal(plain("[[Qualify]]"), "|\uf0c3 Qualify|");
	});
	test("an unknown word has no icon", () => assert.equal(plain("[[Anything else]]"), "|Anything else|"));
	test("synonyms display as one word and keep their detail", () => {
		assert.equal(plain("[[Completed]]"), "|\uf00c Done|");
		assert.equal(plain("[[Fail: 3 tests]]"), "|\uf00d Failed: 3 tests|");
	});
	test("a label's own glyph wins over the table's", () => assert.equal(plain("[[\uf0e7 Done]]"), "|\uf0e7 Done|"));
	test("labels over 32 characters are left alone", () => {
		const long = `[[${"x".repeat(33)}]]`;
		assert.equal(plain(long), long);
	});
});

describe("labels", () => {
	test("a heading takes an icon from its word", () => assert.equal(plain("## Finding"), "## \uf002 Finding"));
	test("an unknown heading is untouched", () => assert.equal(plain("## What happened"), "## What happened"));
	test("a leading bold label takes an icon, after list markers and tree connectors", () => {
		assert.equal(plain("**Cause:** x"), "**<mdLink>\uf0e7 Cause:</>** x");
		assert.equal(plain("- **Fix:** x"), "- **<mdLink>\uf0ad Fix:</>** x");
		assert.equal(plain("  ├── **Risk:** x"), "  <dim>├──</> **<mdLink>\uf071 Risk:</>** x");
		assert.equal(plain("> **Cause:** x"), "> **<mdLink>\uf0e7 Cause:</>** x");
		assert.equal(plain("- [x] **Result:** x"), "- [x] **<mdLink>\uf11e Result:</>** x");
	});
	test("bold later in a line gets color but no icon", () => assert.equal(plain("see **Cause** here"), "see **<mdLink>Cause</>** here"));
});

describe("headings, links, blockquotes, and multiline bold", () => {
	test("headings decorate pills and marks while keeping heading color and bold weight", () => {
		assert.equal(
			plain("### 1. Refresh (`AI-3978`) [[Decision]]"),
			"### 1. Refresh (`AI-3978`) |\uf126 Decision|",
		);
		assert.equal(plain("## Finding [[Broken]]"), "## \uf002 Finding |\uf127 Broken|");
		assert.equal(
			plain("## Migrate A → B ✓ ✗"),
			"## Migrate A <accent>→</> B <success>✓</> <error>✗</>",
		);
		assert.equal(plain("## **Keep heading color** [[Done]]"), "## **Keep heading color** |\uf00c Done|");
		assert.equal(plain("> ## Status [[Blocked]]"), "> ## \uf012 Status |\uf05e Blocked|");

		const h1Raw = decorate("# Release [[Live]] today", palette);
		assert.ok(h1Raw.includes("\x1b[24;22m"), "H1 pill should suspend underline before caps");
		assert.ok(h1Raw.includes("\x1b[1m\x1b[4m\x1b[38;fg-mdHeadingm today"), "H1 text after pill should restore bold, underline, and heading color");

		const h2Raw = decorate("## Status [[Blocked]] on deploy", palette);
		assert.ok(h2Raw.includes("\x1b[1m\x1b[38;fg-mdHeadingm on deploy"), "H2 text after pill should restore bold and heading color");
	});

	test("blockquotes restore quote color after pills and marks", () => {
		const raw = decorate("> [[Blocked]] in quote → next", palette);
		assert.ok(raw.includes("\x1b[23;22m"), "blockquote pill should suspend italic so caps and label stay upright");
		assert.ok(raw.includes("\x1b[3m\x1b[38;fg-mdQuotem in quote"), "blockquote text after pill should restore italic and quote color");
		assert.ok(raw.includes("<accent>→</>\x1b[38;fg-mdQuotem next"));
	});

	test("bold spans spanning multiple lines color every line without breaking quote prefixes", () => {
		assert.equal(
			plain("**first line\nsecond line**"),
			"**<mdLink>first line</>\n<mdLink>second line</>**",
		);
		assert.equal(
			plain("> **first\n> second**"),
			"> **<mdLink>first</>\n> <mdLink>second</>**",
		);
	});

	test("intraword underscores, spaced markers, and Markdown links are not corrupted", () => {
		assert.equal(plain("foo__bar__baz and ** foo **"), "foo__bar__baz and ** foo **");
		assert.equal(
			plain("[**bold link**](https://example.com/__foo__)"),
			"[**bold link**](https://example.com/__foo__)",
		);
		assert.equal(
			plain("Use **mitchfultz@gmail.com** and **https://example.com**"),
			"Use **mitchfultz@gmail.com** and **https://example.com**",
		);
		assert.equal(
			plain("**contact mitch@workos.com today**"),
			"**<mdLink>contact</> mitch@workos.com <mdLink>today</>**",
		);
		assert.equal(
			plain("**(https://example.com) is live**"),
			"**(https://example.com) <mdLink>is live</>**",
		);
		assert.equal(
			plain("**email:mitch@workos.com**"),
			"**<mdLink>email</>:mitch@workos.com**",
		);
		assert.equal(
			plain("Status [[Done]]\nand [text [[Done]]](https://example.com) and [[Fixed]]"),
			"Status |\uf00c Done|\nand [text [[Done]]](https://example.com) and |\uf0ad Fixed|",
		);
		assert.equal(
			plain("Status [[Done]] and [text [[X]]](https://example.com) and [[Fixed]]"),
			"Status |\uf00c Done| and [text [[X]]](https://example.com) and |\uf0ad Fixed|",
		);
		assert.equal(
			plain("[[Done]] [a [[X]]](https://example.com) [[Fixed]] [b [[Y]]](https://example.com) [[Live]]"),
			"|\uf00c Done| [a [[X]]](https://example.com) |\uf0ad Fixed| [b [[Y]]](https://example.com) |\uf135 Live|",
		);
	});
});

describe("solid pills and real Pi Markdown rendering", () => {
	test("solid pills derive from theme foreground tokens and match bold on ANSI 0-7 caps", () => {
		const dangerRaw = decorate("[[Costs money]]", palette);
		const modeRaw = decorate("[[Verify]]", palette);
		const ownerRaw = decorate("[[Owned]]", palette);
		assert.ok(dangerRaw.includes("\x1b[38;fg-errorm\x1b[7m"));
		assert.ok(modeRaw.includes("\x1b[38;fg-syntaxVariablem\x1b[7m"));
		assert.ok(ownerRaw.includes("\x1b[38;fg-mdLinkm\x1b[7m"));

		const systemTheme: ThemeLike = {
			fg: (_c: string, t: string) => t,
			getFgAnsi: (color: string) =>
				color === "error" ? "\x1b[38;5;1m" : color === "syntaxVariable" ? "\x1b[38;5;6m" : "\x1b[38;5;4m",
			getBgAnsi: () => "\x1b[49m",
		} as unknown as ThemeLike;
		const sysPalette = createPalette(systemTheme);
		const sysDanger = decorate("[[Costs money]]", sysPalette);
		assert.ok(sysDanger.includes("\x1b[1m\x1b[38;5;1m\ue0b6\x1b[22m\x1b[39m"));
		assert.ok(sysDanger.includes("\x1b[1m\x1b[38;5;1m\ue0b4\x1b[22m\x1b[39m"));
	});

	test("real Pi Markdown renders headings, bold autolinks, links, and solid pills without leaked SGR", () => {
		const fgAnsi: Record<string, string> = {
			mdHeading: "\x1b[38;2;205;154;34m",
			mdLink: "\x1b[38;2;105;173;208m",
			mdQuote: "\x1b[38;2;157;165;169m",
			success: "\x1b[38;2;104;183;141m",
			error: "\x1b[38;2;234;127;129m",
			warning: "\x1b[38;2;205;154;34m",
			syntaxVariable: "\x1b[38;2;93;179;186m",
			accent: "\x1b[38;2;167;152;215m",
			dim: "\x1b[38;2;157;165;169m",
			text: "\x1b[38;2;230;230;230m",
		};
		const bgAnsi: Record<string, string> = {
			toolSuccessBg: "\x1b[48;2;37;65;49m",
			toolErrorBg: "\x1b[48;2;91;40;42m",
			searchMatchBg: "\x1b[48;2;78;47;27m",
			selectedBg: "\x1b[48;2;45;55;72m",
		};
		const ansiTheme: ThemeLike = {
			fg: (color: string, text: string) => `${fgAnsi[color] ?? ""}${text}\x1b[39m`,
			getFgAnsi: (color: string) => fgAnsi[color] ?? "\x1b[39m",
			getBgAnsi: (color: string) => bgAnsi[color] ?? "\x1b[49m",
		} as unknown as ThemeLike;
		const realPalette = createPalette(ansiTheme);
		// Deterministic MarkdownTheme matching chalk.underline's nested-\x1b[24m reopen behavior
		// and OSC 8 hyperlinks regardless of CI runner TERM_PROGRAM/TTY state.
		const mdTheme: MarkdownTheme = {
			heading: (t) => `${fgAnsi.mdHeading}${t}\x1b[39m`,
			link: (t) => `${fgAnsi.mdLink}${t}\x1b[39m`,
			linkUrl: (t) => `${fgAnsi.dim}${t}\x1b[39m`,
			code: (t) => `${fgAnsi.accent}${t}\x1b[39m`,
			codeBlock: (t) => t,
			codeBlockBorder: (t) => t,
			quote: (t) => `${fgAnsi.mdQuote}${t}\x1b[39m`,
			quoteBorder: (t) => `${fgAnsi.mdQuote}${t}\x1b[39m`,
			hr: (t) => t,
			listBullet: (t) => t,
			bold: (t) => `\x1b[1m${t}\x1b[22m`,
			italic: (t) => `\x1b[3m${t.replaceAll("\x1b[23m", "\x1b[23m\x1b[3m")}\x1b[23m`,
			strikethrough: (t) => `\x1b[9m${t}\x1b[29m`,
			underline: (t) => `\x1b[4m${t.replaceAll("\x1b[24m", "\x1b[24m\x1b[4m")}\x1b[24m`,
		};
		const stripAnsi = (s: string) =>
			s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "");

		const sample = [
			"### 1. Refresh (`AI-3978`) [[Decision]]",
			"# Release [[Live]] today",
			"Use **mitchfultz@gmail.com** and **https://example.com** and [**bold link**](https://example.com/__foo__).",
			"Broken bracket link [text [[Done]]](https://example.com) and [[Costs money]] [[Verify]] [[Owned]].",
			"Same-line [[Done]] and [text [[X]]](https://example.com) and [[Fixed]].",
			"> [[Blocked]] inside an italic blockquote.",
		].join("\n\n");

		const rendered = new Markdown(decorate(sample, realPalette), 0, 0, mdTheme).render(120).join("\n");
		const visible = stripAnsi(rendered);
		assert.ok(visible.includes("\ue0b6\uf126\u00a0Decision\ue0b4"), "heading pill should render");
		assert.ok(visible.includes("\ue0b6\uf135\u00a0Live\ue0b4 today"), "H1 pill and trailing text should render");
		assert.ok(visible.includes("mitchfultz@gmail.com"), "bold email should stay intact");
		assert.ok(visible.includes("bold link"), "bold markdown link label should stay intact");
		assert.doesNotMatch(visible, /\b(?:39m|208m|129m|186m)\b/, "no ANSI SGR fragments should leak into visible text");
		assert.ok(rendered.includes("\x1b[4mmitchfultz@gmail.com\x1b[24m"), "email autolink should parse cleanly without ANSI corruption");
		assert.ok(rendered.includes("https://example.com/__foo__"), "explicit link URL with underscores should remain intact");
		assert.ok(!rendered.includes("\x1b[24m\x1b[4m"), "H1 pill should not have underline re-enabled across caps");
		assert.ok(!rendered.includes("\x1b[23m\x1b[3m"), "blockquote pill should not have italic re-enabled across caps");
		assert.ok(visible.includes("Same-line \ue0b6\uf00c\u00a0Done\ue0b4 and "), "same-line pill before bracket link should render");
		assert.ok(visible.includes(" and \ue0b6\uf0ad\u00a0Fixed\ue0b4."), "same-line pill after bracket link should render");
	});
});

describe("action lead-ins", () => {
	test("take an icon anywhere in a line when they end in a colon", () => {
		assert.equal(plain("[[Unverified]] red pills. **Check:** run it"), "|\uf128 Unverified| red pills. **<mdLink>\uf046 Check:</>** run it");
		assert.equal(plain("- **Unblock:** access"), "- **<mdLink>\uf09c Unblock:</>** access");
	});
	test("get exactly one icon at the start of a line", () => assert.equal(plain("**Next:** go"), "**<mdLink>\uf061 Next:</>** go"));
	test("without a colon they are ordinary bold", () => assert.equal(plain("please **do** it and **run** that"), "please **<mdLink>do</>** it and **<mdLink>run</>** that"));
});

describe("what is left alone", () => {
	test("fenced and indented code blocks", () => {
		for (const block of [
			"```\n**Cause:** → [[Done]]\n```",
			// Fences inside nested lists or blockquotes are still code to Pi's parser.
			"- Step\n    - Sub step:\n\n      ```ts\n      /** Cause */ → [[Done]]\n      ```",
			"> ```\n> **Cause:** → [[Done]]\n> ```",
			"- item\n\n  ```md\n  ## Finding\n  ```",
			"```text\n   ```sh\n**Cause:** → [[Done]]\n```",
			"    **Cause:** → [[Done]]",
			"```\r\n**Cause:** → [[Done]]\r\n```",
		]) {
			assert.equal(plain(block), block);
		}
		assert.equal(
			plain("```text\n   ```sh\n```\n**After**"),
			"```text\n   ```sh\n```\n**<mdLink>After</>**",
		);
		// Tabs are expanded to 3 spaces to match Pi's Markdown parser.
		assert.equal(
			plain("- Step\n\t```\n\t**Cause:** → [[Done]]\n\t```"),
			"- Step\n   ```\n   **Cause:** → [[Done]]\n   ```",
		);
	});
	test("inline code", () => {
		// Longer delimiters let a code span hold a shorter backtick run, as in ``a ` b`` and `` `x` ``.
		for (const sample of [
			"`[[Done]] → **x**`",
			"``a ` **b** [[Done]] → c``",
			"`` `[[Done]]` `` and `` `**x**` ``",
			"`[[Done]]\n**Cause:**`",
		]) {
			assert.equal(plain(sample), sample);
		}
		assert.equal(plain("`` `x` `` then **y**"), "`` `x` `` then **<mdLink>y</>**");
		assert.equal(
			plain("| `[[Done]] \\| **x**` | **y** |\n|---|---|\n| a | b |"),
			"| `[[Done]] \\| **x**` | **<mdLink>y</>** |\n|---|---|\n| a | b |",
		);
		// Preceding literal backticks in HTML comments, links, or unmatched runs do not shift the next code span.
		assert.ok(plain("<!-- `[[Done]]` -->\n\n`[[Done]]`").endsWith("\n\n`[[Done]]`"));
		assert.ok(plain("[link](https://example.com/`[[Done]]`) and `[[Done]]`").endsWith(" and `[[Done]]`"));
		assert.equal(plain("\\`[[Done]]`\n\n`[[Done]]`"), "\\`|\uf00c Done|`\n\n`[[Done]]`");
		assert.equal(plain("``[[Done]]`\n\n`[[Done]]`"), "``|\uf00c Done|`\n\n`[[Done]]`");
	});
	test("escaped asterisks", () => assert.equal(plain("\\*\\*not bold\\*\\*"), "\\*\\*not bold\\*\\*"));
});

test("arrows, checks and crosses take their colors", () => {
	assert.equal(plain("a → b ✓ c ✗"), "a <accent>→</> b <success>✓</> c <error>✗</>");
});

test("icons can be turned off", () => {
	withEnv({ PI_EMPHASIS_PILL_ICONS: "0" }, () => {
		assert.equal(plain("[[Done]]"), "|Done|");
		assert.equal(plain("## Finding"), "## Finding");
	});
});

describe("reply guidance", () => {
	const text = replyGuidance();
	test("names every core word, and each one is colored as its tone", () => {
		for (const [tone, words] of Object.entries(VOCABULARY)) {
			for (const word of words.core) {
				assert.ok(text.includes(`[[${word}]]`));
				assert.equal(toneOf(word), tone);
			}
		}
		for (const word of CONTEXT_WORDS) assert.ok(text.includes(`[[${word}]]`));
	});
	test("every pill it mentions is a known word, so no example teaches an uncolored one", () => {
		const known = new Set([...Object.values(VOCABULARY).flatMap((w) => w.core), ...CONTEXT_WORDS, "Word"]);
		for (const [, label] of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
			assert.equal([...known].some((k) => label === k || label.startsWith(`${k} `) || label.startsWith(`${k}:`)), true);
		}
	});
	test("every lead-in it lists gets an icon", () => {
		for (const word of ["Check", "Do", "Next", "Unblock", "Left", "Run", "Guard", "Undo", "See"]) {
			assert.ok(text.includes(`**${word}:**`));
			assert.notEqual(plain(`x **${word}:** y`), `x **<mdLink>${word}:</>** y`);
		}
	});
	test("teaches Verify instead of legacy Qualify", () => {
		assert.ok(text.includes("[[Verify]]"));
		assert.doesNotMatch(text, /\[\[Qualify\]\]|\bQualify\b/i);
	});
	test("prioritizes plain human prose and softens mandatory pill, lead-in, and bold stacking", () => {
		assert.match(text, /^Plain, natural human prose always takes precedence over formatting decoration\./);
		assert.match(text, /never turn questions, blockers, or explanations into dense pill-and-label chains or cryptic shorthand/i);
		assert.match(text, /visual presentation only/i);
		assert.match(text, /user and project instructions govern substance/i);
		assert.match(text, /keep routine 1[–-]2 line progress updates in plain prose/i);
		assert.match(text, /red, yellow, or solid-red pills for real failures, blockers, asks, or risky\/costly actions/i);
		assert.match(text, /green \(optional/i);
		assert.match(text, /cyan[^\n]*optional/i);
		assert.match(text, /blue \(ownership[^\n]*optional/i);
		assert.match(text, /evidence pills \(optional\)[^\n]*\[\[Observed\]\], \[\[Inferred\]\], or \[\[Unverified\]\]/i);
		assert.match(text, /action lead-ins \(optional\)[^\n]*do not pair every pill with a bold lead-in/i);
		assert.match(text, /labels and shapes \(optional\)/i);
		assert.match(text, /bold selectively/i);
		assert.doesNotMatch(text, /bold 1[–-]3/i);
		assert.doesNotMatch(text, /mark evidence claims with/i);
		assert.doesNotMatch(text, /follow red, yellow, solid-red/i);
	});
	test("stays compact to limit prompt overhead", () => {
		const words = text.trim().split(/\s+/).length;
		assert.ok(words < 550, `expected < 550 words, got ${words}`);
		assert.ok(text.length < 3800, `expected < 3800 chars, got ${text.length}`);
	});
	test("addresses any user", () => assert.doesNotMatch(text, /\bJohn\b|~\/dev/));
});

type SessionStartHandler = (event: SessionStartEvent, ctx: ExtensionContext) => unknown;
type BeforeAgentStartHandler = (event: BeforeAgentStartEvent, ctx: ExtensionContext) => unknown;

function setupExtension() {
	let onSessionStart: SessionStartHandler | undefined;
	let onBeforeAgentStart: BeforeAgentStartHandler | undefined;
	let markdownTransformer: MarkdownTransformer | undefined;

	const pi = {
		on(event: string, handler: (...args: unknown[]) => unknown) {
			if (event === "session_start") onSessionStart = handler as SessionStartHandler;
			else if (event === "before_agent_start") onBeforeAgentStart = handler as BeforeAgentStartHandler;
			return () => {};
		},
		registerMarkdownTransformer(transformer: MarkdownTransformer) {
			markdownTransformer = transformer;
		},
	} as unknown as ExtensionAPI;

	emphasis(pi);
	assert.ok(onSessionStart, "emphasis should subscribe to session_start");
	assert.ok(onBeforeAgentStart, "emphasis should subscribe to before_agent_start");
	assert.ok(markdownTransformer, "emphasis should register a markdown transformer");

	return {
		startSession(mode: ExtensionContext["mode"], ui: { theme: ThemeLike }) {
			onSessionStart!(
				{ type: "session_start", reason: "startup" },
				{ mode, ui } as unknown as ExtensionContext,
			);
		},
		beforeAgentStart(sections?: Record<string, string>) {
			const event = {
				type: "before_agent_start",
				messageType: "user",
				prompt: "test",
				systemPrompt: "",
				systemPromptOptions: { cwd: "/tmp", ...(sections ? { sections } : {}) },
			} as unknown as BeforeAgentStartEvent;
			onBeforeAgentStart!(event, {} as ExtensionContext);
			return event.systemPromptOptions.sections;
		},
		transform(markdown: string, messageType: MarkdownMessageType) {
			const context: MarkdownTransformContext = {
				messageType,
				isStreaming: false,
				availableWidth: 80,
			};
			return markdownTransformer!(markdown, context);
		},
	};
}

describe("extension lifecycle", () => {
	test("non-TUI mode leaves reply_style unset and markdown untouched", () => {
		withEnv({ PI_EMPHASIS_GUIDANCE: undefined }, () => {
			for (const mode of ["rpc", "print", "json"] as const) {
				const ext = setupExtension();
				ext.startSession(mode, { theme });
				const sections = ext.beforeAgentStart({ existing: "keep", reply_style: "stale" });
				assert.equal("reply_style" in sections, false);
				assert.equal(sections.existing, "keep");
				assert.equal(ext.transform("**Cause:** [[Done]]", "assistant"), "**Cause:** [[Done]]");
			}
		});
	});

	test("TUI mode sets sections.reply_style unless PI_EMPHASIS_GUIDANCE=0", () => {
		const ext = setupExtension();
		ext.startSession("tui", { theme });

		withEnv({ PI_EMPHASIS_GUIDANCE: undefined }, () => {
			const sections = ext.beforeAgentStart();
			assert.equal(sections.reply_style, replyGuidance());
		});

		withEnv({ PI_EMPHASIS_GUIDANCE: "0" }, () => {
			const sections = ext.beforeAgentStart({ reply_style: replyGuidance(), keep: "yes" });
			assert.equal("reply_style" in sections, false);
			assert.equal(sections.keep, "yes");
		});
	});

	test("registerMarkdownTransformer only decorates assistant messages and rebuilds palette on theme changes", () => {
		withEnv({ PI_EMPHASIS_COLOR: undefined, PI_EMPHASIS_PILL_ICONS: undefined, PI_EMPHASIS_ROUND_CAPS: undefined }, () => {
			const themeA = createTaggedTheme("a");
			const themeB = createTaggedTheme("b");
			const ui = { theme: themeA };
			const ext = setupExtension();
			ext.startSession("tui", ui);

			const sample = "**Cause:** [[Done]]";
			for (const messageType of ["user", "assistant-thinking", "custom", "summary", "changelog"] as const) {
				assert.equal(ext.transform(sample, messageType), sample);
			}

			const renderedA = ext.transform(sample, "assistant");
			assert.ok(renderedA.includes("<a:mdLink>\uf0e7 Cause:</>"));
			assert.ok(renderedA.includes("fg-a:success"));
			assert.ok(!renderedA.includes("b:"));

			ui.theme = themeB;
			const renderedB = ext.transform(sample, "assistant");
			assert.ok(renderedB.includes("<b:mdLink>\uf0e7 Cause:</>"));
			assert.ok(renderedB.includes("fg-b:success"));
			assert.ok(!renderedB.includes("a:"));
		});
	});
});
