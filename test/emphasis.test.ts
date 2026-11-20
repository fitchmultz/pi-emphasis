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
	});
	test("bold later in a line gets color but no icon", () => assert.equal(plain("see **Cause** here"), "see **<mdLink>Cause</>** here"));
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
	test("fenced code", () => {
		const block = "```\n**Cause:** → [[Done]]\n```";
		assert.equal(plain(block), block);
	});
	test("inline code", () => assert.equal(plain("`[[Done]] → **x**`"), "`[[Done]] → **x**`"));
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
	test("defers substance and plain-text rules to user/project instructions and exempts brief updates", () => {
		assert.match(text, /visual presentation only/i);
		assert.match(text, /user and project instructions govern substance/i);
		assert.match(text, /exempt routine 1[–-]2 line progress updates/i);
		assert.match(text, /required red, yellow, and solid-red pills still apply/i);
		assert.match(text, /cyan[^\n]*optional/i);
		assert.match(text, /blue \(ownership[^\n]*optional when helpful/i);
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
