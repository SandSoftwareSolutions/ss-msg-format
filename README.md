# @sandsoftwaresolutions/msg-format

[![CI](https://github.com/SandSoftwareSolutions/ss-msg-format/actions/workflows/ci.yml/badge.svg)](https://github.com/SandSoftwareSolutions/ss-msg-format/actions/workflows/ci.yml)

Messages with `{name}`, plurals and selections that work in every language: the runtime that goes with `i18n-check`. It speaks the standard ICU MessageFormat, the same format next-intl, FormatJS and many translation tools use, so your translators' texts work as they are. No dependencies; the plural rules, numbers and dates come from Node's own `Intl`.

## Install

```bash
npm install @sandsoftwaresolutions/msg-format
```

## Usage

```js
import { format, compile, required } from "@sandsoftwaresolutions/msg-format";

format("Hello {name}!", { name: "Kaj" });                                  // "Hello Kaj!"

format("{count, plural, =0 {Geen taken} one {# taak} other {# taken}} voor {name}", { count: 3, name: "Kaj" }, { locale: "nl" });
// "3 taken voor Kaj"

format("{g, select, female {She} male {He} other {They}} liked it", { g: "female" });   // "She liked it"
format("{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}", { n: 22 });     // "22nd"
format("{n, number, percent} on {d, date, long}", { n: 0.256, d: new Date() }, { locale: "nl" });

const message = compile("Hi {name}, {n, plural, one {# new message} other {# new messages}}", { locale: "en" });
message({ name: "A", n: 1 });  message({ name: "B", n: 5 });   // compile once, use many times
message.required;                                              // ["name", "n"]: what you must pass
```

Tags are handled by you, so there is no HTML in your translation files and no HTML injection:

```js
format("Read the <link>terms</link> and <b>accept</b>", {}, { tags: { link: (t) => `<a href="/terms">${t}</a>`, b: (t) => `<strong>${t}</strong>` } });
```

## The format

| You write | Meaning |
| --- | --- |
| `{name}` | the value |
| `{n, number}`, `{n, number, integer}`, `percent`, `compact` | number in the locale's style |
| `{d, date, short\|medium\|long\|full}`, `{d, time, short}` | date and time in the locale |
| `{n, plural, =0 {...} one {# ...} other {# ...}}` | the form for a count; `#` is the number; `offset:1` to take the host out of "Kaj and 2 others" |
| `{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}` | 1st, 2nd, 3rd |
| `{x, select, a {...} b {...} other {...}}` | choose by text |
| `'{'`, `''` | a literal brace, a literal apostrophe |
| `<b>text</b>` | a tag you handle |

## Details

- **Languages with more forms work**: Polish (`one`, `few`, `many`, `other`), Arabic, Russian: the rules come from `Intl.PluralRules` for the `locale` you give. An exact `=0` or `=1` beats the category.
- **Every `plural`, `selectordinal` and `select` needs an `other` branch**; a message without one is a syntax error.
- **Errors say where**: `MessageSyntaxError` has `position` and shows the text around it, so a typo in a translation file is easy to find. Pair it with `i18n-check` in CI to find them before they ship.
- **A missing value is an error** that names it (`the value for {name} is missing`), never a silent blank or `undefined`.
- Values are read from the object's own properties only, and so are tag handlers (`<constructor>` is not a handler). A plural, `selectordinal` or `number` placeholder needs a number, a bigint or a text with a number in it: `null`, `""`, `true` and lists are errors instead of quietly becoming 0 or 1; a `date` needs a `Date`, a number or a non-empty text.
- An unknown number, date or time style (`{n, number, bogus}`) is an error when the message is compiled. Messages nested more than 100 levels deep are a `MessageSyntaxError` instead of a stack overflow.
- Dates and times are shown in the time zone of the process (set `TZ` to change it); there is no `timeZone` option. A `<` followed by a letter starts a tag, so write `'<'` for a literal one (`a<b` is a syntax error, `1 < 2` is fine).
- Argument names are letters, digits and `_` only.
- `parse(message)` gives the syntax tree for tools; `required(message)` lists the values a message needs.
- `format` caches compiled messages (up to 500); use `compile` for your own control.
