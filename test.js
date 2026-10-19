import assert from "node:assert/strict";
import { test } from "node:test";

import { compile, format, MessageSyntaxError, parse, required } from "./src/index.js";

const nbsp = (s) => s.replace(/[  ]/g, " ");

test("plain text and simple values", () => {
  assert.equal(format("Hello world", {}), "Hello world");
  assert.equal(format("Hello {name}!", { name: "Kaj" }), "Hello Kaj!");
  assert.equal(format("{a}{b}{a}", { a: 1, b: 0 }), "101");
  assert.equal(format("", {}), "");
  assert.equal(format("{ name }", { name: "x" }), "x");
  assert.equal(format("{n}", { n: false }), "false");
});

test("a missing value is an error that names it", () => {
  assert.throws(() => format("Hi {name}", {}), /the value for \{name\} is missing/);
  assert.throws(() => format("Hi {name}", { name: undefined }), /missing/);
  assert.throws(() => format("Hi {constructor}", {}), /missing/);
  assert.equal(format("Hi {name}", { name: null }), "Hi null");
});

test("plural in English, Dutch and Polish", () => {
  const en = "{count, plural, =0 {No tasks} one {# task} other {# tasks}}";
  assert.deepEqual([0, 1, 2, 1234].map((count) => format(en, { count })), ["No tasks", "1 task", "2 tasks", "1,234 tasks"]);
  const nl = "{count, plural, one {# taak} other {# taken}}";
  assert.equal(format(nl, { count: 1 }, { locale: "nl" }), "1 taak");
  assert.equal(format(nl, { count: 3 }, { locale: "nl" }), "3 taken");
  assert.equal(format(nl, { count: 1234 }, { locale: "nl" }), "1.234 taken");
  const pl = "{n, plural, one {# plik} few {# pliki} many {# plików} other {# pliku}}";
  assert.deepEqual([1, 2, 5, 22, 25].map((n) => format(pl, { n }, { locale: "pl" })), ["1 plik", "2 pliki", "5 plików", "22 pliki", "25 plików"]);
});

test("exact matches beat categories, and offset works", () => {
  assert.equal(format("{n, plural, =1 {exactly one} one {one} other {many}}", { n: 1 }), "exactly one");
  const offset = "{n, plural, offset:1 =0 {nobody} =1 {{host}} one {{host} and # other} other {{host} and # others}}";
  assert.deepEqual([0, 1, 2, 3].map((n) => format(offset, { n, host: "Kaj" })), ["nobody", "Kaj", "Kaj and 1 other", "Kaj and 2 others"]);
});

test("select and nesting", () => {
  const gender = "{g, select, female {She} male {He} other {They}} liked it";
  assert.equal(format(gender, { g: "female" }), "She liked it");
  assert.equal(format(gender, { g: "male" }), "He liked it");
  assert.equal(format(gender, { g: "unknown" }), "They liked it");
  const nested = "{g, select, female {{n, plural, one {She has # card} other {She has # cards}}} other {{n, plural, one {They have # card} other {They have # cards}}}}";
  assert.equal(format(nested, { g: "female", n: 2 }), "She has 2 cards");
  assert.equal(format(nested, { g: "x", n: 1 }), "They have 1 card");
});

test("# is the number inside plural, also inside a nested select", () => {
  assert.equal(format("{n, plural, other {{k, select, a {A: #} other {#}}}}", { n: 7, k: "a" }), "A: 7");
  assert.equal(format("# is just text outside a plural", {}), "# is just text outside a plural");
});

test("ordinals", () => {
  const ord = "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";
  assert.deepEqual([1, 2, 3, 4, 11, 21, 22, 103].map((n) => format(ord, { n })), ["1st", "2nd", "3rd", "4th", "11th", "21st", "22nd", "103rd"]);
});

test("numbers and dates follow the locale", () => {
  assert.equal(format("{n, number}", { n: 1234.5 }), "1,234.5");
  assert.equal(format("{n, number}", { n: 1234.5 }, { locale: "nl" }), "1.234,5");
  assert.equal(format("{n, number, integer}", { n: 1234.7 }), "1,235");
  assert.equal(nbsp(format("{n, number, percent}", { n: 0.256 })), "26%");
  assert.equal(format("{n, number, compact}", { n: 2500000 }), "2.5M");
  const when = new Date(Date.UTC(2026, 9, 17, 12, 0, 0));
  assert.match(format("{d, date, long}", { d: when }), /October 17, 2026/);
  assert.match(format("{d, date, long}", { d: when }, { locale: "nl" }), /17 oktober 2026/);
  assert.match(format("{d, date}", { d: when.getTime() }), /2026/);
  assert.match(format("{d, time, short}", { d: when }), /\d/);
  assert.throws(() => format("{d, date}", { d: "not a date" }), /not a valid date/);
  assert.throws(() => format("{n, number}", { n: "abc" }), /not a number/);
  assert.throws(() => format("{n, number, weird}", { n: 1 }), /unknown number style/);
  assert.throws(() => format("{d, date, tiny}", { d: when }), /unknown date style/);
});

test("quotes: apostrophes and escaped braces", () => {
  assert.equal(format("It''s {name}''s", { name: "Kaj" }), "It's Kaj's");
  assert.equal(format("Don't worry", {}), "Don't worry");
  assert.equal(format("Use '{name}' to insert", {}), "Use {name} to insert");
  assert.equal(format("a '{' b '}' c", {}), "a { b } c");
  assert.equal(format("'{x, plural, one {y}}'", {}), "{x, plural, one {y}}");
  assert.equal(format("{n, plural, other {'#' stays, # counts}}", { n: 3 }), "# stays, 3 counts");
  assert.equal(format("5 > 3 and 2 < 4", {}), "5 > 3 and 2 < 4");
});

test("tags are handled by you, and nest", () => {
  const tags = { b: (text) => `**${text}**`, link: (text) => `[${text}](url)` };
  assert.equal(format("Read <b>this</b> and <link>that</link>", {}, { tags }), "Read **this** and [that](url)");
  assert.equal(format("<b>Hi <link>{name}</link></b>", { name: "Kaj" }, { tags }), "**Hi [Kaj](url)**");
  assert.equal(format("{n, plural, one {<b>one</b>} other {<b>#</b> items}}", { n: 4 }, { tags }), "**4** items");
  assert.throws(() => format("<em>x</em>", {}, { tags }), /no handler for <em>/);
});

test("syntax errors say where", () => {
  const bad = { "Hello {name": /missing \}/, "Hello }": /unexpected \}/, "{n, plural, one {x}}": /needs an "other" branch/, "{n, plural, other {x} other {y}}": /same selector twice/, "{n, wat}": /unknown type "wat"/, "{n, plural other {x}}": /expected ,/, "{}": /expected an argument name/, "<b>x": /missing <\/b>/, "x</b>": /unexpected closing tag/, "{n, plural, other x}": /expected \{/, "{n, plural, offset:x other {y}}": /expected a number after offset/ };
  for (const [message, pattern] of Object.entries(bad)) {
    assert.throws(() => parse(message), (e) => e instanceof MessageSyntaxError && pattern.test(e.message) && Number.isInteger(e.position), message);
  }
  assert.throws(() => parse(5), TypeError);
});

test("required lists the values a message needs, in order", () => {
  assert.deepEqual(required("Hi {name}, {n, plural, one {# item from {shop}} other {# items}} on {d, date}"), ["name", "n", "shop", "d"]);
  assert.deepEqual(required("<b>{a}</b> {a} {b}"), ["a", "b"]);
  assert.deepEqual(required("no values"), []);
  assert.deepEqual(compile("{x} {y}").required, ["x", "y"]);
});

test("compiled messages can be used many times and are cached by format", () => {
  const hello = compile("Hi {name}", { locale: "nl" });
  assert.equal(hello({ name: "A" }), "Hi A");
  assert.equal(hello({ name: "B" }), "Hi B");
  for (let i = 0; i < 700; i++) format(`message ${i} {x}`, { x: i });
  assert.equal(format("message 3 {x}", { x: "ok" }), "message 3 ok");
});

test("values cannot reach into the prototype", () => {
  assert.throws(() => format("{toString}", {}), /missing/);
  assert.throws(() => format("{__proto__}", {}), /missing/);
  assert.equal(format("{__proto__}", JSON.parse('{"__proto__": "own"}')), "own");
});

test("tag handlers are looked up on the tags object itself, not on Object.prototype", () => {
  assert.throws(() => format("<constructor>x</constructor>", {}), /no handler for <constructor>/);
  assert.throws(() => format("<toString>x</toString>", {}, { tags: {} }), /no handler for <toString>/);
  assert.throws(() => format("<hasOwnProperty>x</hasOwnProperty>", {}, { tags: {} }), /no handler/);
  Object.prototype.polluted = (t) => `!${t}!`;
  try {
    assert.throws(() => format("<polluted>x</polluted>", {}, { tags: {} }), /no handler for <polluted>/);
  } finally {
    delete Object.prototype.polluted;
  }
  assert.equal(format("<b>x</b>", {}, { tags: { b: (t) => `[${t}]` } }), "[x]");
  assert.equal(compile("<b>x</b>", { tags: Object.assign(Object.create(null), { b: (t) => t.toUpperCase() }) })(), "X");
});

test("deeply nested messages are a syntax error, not a stack overflow", () => {
  for (const text of ["{a, select, other {".repeat(5000) + "x" + "}}".repeat(5000), "<b>".repeat(5000) + "x" + "</b>".repeat(5000)]) {
    assert.throws(() => parse(text), (e) => e instanceof MessageSyntaxError && /nested more than \d+ levels/.test(e.message));
  }
  const fine = "{a, select, other {".repeat(50) + "x" + "}}".repeat(50);
  assert.equal(format(fine, { a: "z" }), "x");
});

test("a plural, number or date does not quietly accept null, an empty text, a boolean or a list", () => {
  for (const bad of [null, "", "  ", true, false, [], {}]) {
    assert.throws(() => format("{n, plural, =0 {zero} other {other}}", { n: bad }), /not a number/, JSON.stringify(bad));
    assert.throws(() => format("{n, number}", { n: bad }), /not a number/);
    assert.throws(() => format("{n, selectordinal, other {#}}", { n: bad }), /not a number/);
  }
  for (const bad of [null, "", true, [], {}]) assert.throws(() => format("{d, date}", { d: bad }), /not a valid date/, JSON.stringify(bad));
  assert.equal(format("{n, plural, =0 {zero} other {other}}", { n: "0" }), "zero");
  assert.equal(format("{n, plural, =0 {zero} other {other}}", { n: 0n }), "zero");
  assert.equal(format("{n, number}", { n: "1234.5" }), "1,234.5");
  assert.ok(format("{d, date, short}", { d: 0 }).length > 0);
});

test("an unknown style is found when the message is compiled", () => {
  assert.throws(() => compile("{n, number, bogus}"), /unknown number style "bogus"/);
  assert.throws(() => compile("{d, date, tiny}"), /unknown date style/);
  assert.throws(() => compile("{x, plural, other {{n, time, huge}}}"), /unknown time style/);
});

test("a message with very many values is compiled quickly", () => {
  const text = Array.from({ length: 20_000 }, (_, i) => `{a${i}}`).join("");
  const started = Date.now();
  assert.equal(compile(text).required.length, 20_000);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
});
