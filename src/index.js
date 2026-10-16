/** Thrown for a message that cannot be read. `position` is the index in the text where it went wrong. */
export class MessageSyntaxError extends Error {
  constructor(message, source, position) {
    super(`${message} (at position ${position}: ${JSON.stringify(source.slice(Math.max(0, position - 15), position + 15))})`);
    this.name = "MessageSyntaxError";
    this.position = position;
  }
}

const NAME = /[A-Za-z0-9_]/;

/** Reads a message into a tree of nodes (text, arg, number, date, time, plural, select, pound, tag). Exposed for tools; most code only needs `format`. */
export function parse(source) {
  if (typeof source !== "string") throw new TypeError("msg-format: the message must be a string");
  let i = 0;
  const fail = (text, at = i) => {
    throw new MessageSyntaxError(text, source, at);
  };
  const spaces = () => {
    while (i < source.length && /\s/.test(source[i])) i++;
  };
  const word = (what) => {
    spaces();
    const start = i;
    while (i < source.length && NAME.test(source[i])) i++;
    if (i === start) fail(`expected ${what}`);
    return source.slice(start, i);
  };

  function nodes({ inPlural, closing }) {
    const out = [];
    let text = "";
    let closed = false;
    const flush = () => {
      if (text) out.push({ type: "text", value: text });
      text = "";
    };
    while (i < source.length) {
      const ch = source[i];
      if (ch === "'") {
        const next = source[i + 1];
        if (next === "'") {
          text += "'";
          i += 2;
        } else if (next === "{" || next === "}" || (inPlural && next === "#") || next === "<") {
          i++; // a quoted stretch: everything up to the next single apostrophe is literal
          while (i < source.length) {
            if (source[i] === "'") {
              if (source[i + 1] === "'") {
                text += "'";
                i += 2;
                continue;
              }
              i++;
              break;
            }
            text += source[i++];
          }
        } else {
          text += "'";
          i++;
        }
      } else if (ch === "{") {
        flush();
        out.push(argument(inPlural));
      } else if (ch === "}") {
        if (closing === "}") {
          closed = true;
          break;
        }
        fail("unexpected }");
      } else if (ch === "#" && inPlural) {
        flush();
        out.push({ type: "pound" });
        i++;
      } else if (ch === "<" && /[A-Za-z/]/.test(source[i + 1] ?? "")) {
        if (source[i + 1] === "/") {
          if (!closing || closing === "}") fail("unexpected closing tag");
          break;
        }
        flush();
        i++;
        const name = word("a tag name");
        if (source[i] !== ">") fail(`expected > after <${name}`);
        i++;
        const children = nodes({ inPlural, closing: name });
        const close = `</${name}>`;
        if (!source.startsWith(close, i)) fail(`missing ${close}`);
        i += close.length;
        out.push({ type: "tag", name, children });
      } else {
        text += ch;
        i++;
      }
    }
    if (closing === "}" && !closed) fail("missing }");
    flush();
    return out;
  }

  function argument(inPlural) {
    const open = i;
    i++; // {
    const name = word("an argument name");
    spaces();
    if (i >= source.length) fail("missing }");
    if (source[i] === "}") {
      i++;
      return { type: "arg", name };
    }
    if (source[i] !== ",") fail("expected , or }");
    i++;
    const kind = word("a type (number, date, time, plural, selectordinal or select)");
    spaces();
    if (["number", "date", "time"].includes(kind)) {
      let style;
      if (source[i] === ",") {
        i++;
        spaces();
        const start = i;
        while (i < source.length && source[i] !== "}") i++;
        style = source.slice(start, i).trim();
      }
      if (source[i] !== "}") fail("missing }");
      i++;
      return { type: kind, name, style };
    }
    if (!["plural", "selectordinal", "select"].includes(kind)) fail(`unknown type "${kind}"`, open);
    if (source[i] !== ",") fail(`expected , after ${kind}`);
    i++;
    let offset = 0;
    spaces();
    if (kind !== "select" && source.startsWith("offset:", i)) {
      i += 7;
      spaces();
      const start = i;
      while (/\d/.test(source[i] ?? "")) i++;
      if (i === start) fail("expected a number after offset:");
      offset = Number(source.slice(start, i));
    }
    const branches = [];
    for (;;) {
      spaces();
      if (source[i] === "}") break;
      let selector;
      if (kind !== "select" && source[i] === "=") {
        i++;
        const start = i;
        while (/[\d.]/.test(source[i] ?? "")) i++;
        if (i === start) fail("expected a number after =");
        selector = `=${source.slice(start, i)}`;
      } else selector = word("a selector");
      spaces();
      if (source[i] !== "{") fail(`expected { after ${selector}`);
      i++;
      const body = nodes({ inPlural: kind === "select" ? inPlural : true, closing: "}" });
      i++; // }
      branches.push({ selector, body });
    }
    i++; // }
    if (!branches.some((b) => b.selector === "other")) fail(`${kind} needs an "other" branch`, open);
    if (new Set(branches.map((b) => b.selector)).size !== branches.length) fail(`${kind} has the same selector twice`, open);
    return { type: kind, name, offset, branches };
  }

  const tree = nodes({ inPlural: false, closing: undefined });
  if (i < source.length) fail("unexpected content");
  return tree;
}

/** The names of the values a message needs (`["name", "count"]`), in order of appearance. For checking that you pass everything. */
export function required(source) {
  const names = [];
  const walk = (list) => {
    for (const node of list) {
      if ("name" in node && node.type !== "tag" && !names.includes(node.name)) names.push(node.name);
      if (node.branches) node.branches.forEach((b) => walk(b.body));
      if (node.children) walk(node.children);
    }
  };
  walk(typeof source === "string" ? parse(source) : source);
  return names;
}

const DATE_STYLES = ["short", "medium", "long", "full"];

function toDate(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`msg-format: the value for {${name}} is not a valid date`);
  return date;
}

/**
 * Turns a message into a function: `compile("Hello {name}")({ name: "Kaj" })`. Supported (ICU MessageFormat):
 * `{name}`, `{n, number}` (`integer`, `percent`, `compact`), `{d, date, short|medium|long|full}`, `{d, time, ...}`,
 * `{n, plural, =0 {none} one {# item} other {# items}}` (with `offset:`), `{n, selectordinal, ...}`, `{x, select, a {...} other {...}}`,
 * `#` for the number inside plural, `'{'` and `''` as quotes, and tags `<b>text</b>` that you handle with `tags`.
 * Plural rules come from the language (`locale`), so Polish and Arabic work. Missing values are an error that names them.
 */
export function compile(source, { locale = "en", tags = {} } = {}) {
  const tree = parse(source);
  const plurals = new Intl.PluralRules(locale);
  const ordinals = new Intl.PluralRules(locale, { type: "ordinal" });
  const numbers = new Intl.NumberFormat(locale);

  const run = (list, values, pound) =>
    list
      .map((node) => {
        switch (node.type) {
          case "text":
            return node.value;
          case "pound":
            return numbers.format(pound);
          case "arg":
            return String(value(values, node.name));
          case "number": {
            const n = Number(value(values, node.name));
            if (Number.isNaN(n)) throw new TypeError(`msg-format: the value for {${node.name}} is not a number`);
            const style = node.style;
            const options = style === undefined || style === "" ? {} : style === "integer" ? { maximumFractionDigits: 0 } : style === "percent" ? { style: "percent" } : style === "compact" ? { notation: "compact" } : null;
            if (options === null) throw new RangeError(`msg-format: unknown number style "${style}" (use integer, percent or compact)`);
            return new Intl.NumberFormat(locale, options).format(n);
          }
          case "date":
          case "time": {
            const style = node.style || "medium";
            if (!DATE_STYLES.includes(style)) throw new RangeError(`msg-format: unknown ${node.type} style "${style}" (use ${DATE_STYLES.join(", ")})`);
            return new Intl.DateTimeFormat(locale, node.type === "date" ? { dateStyle: style } : { timeStyle: style }).format(toDate(value(values, node.name), node.name));
          }
          case "plural":
          case "selectordinal": {
            const n = Number(value(values, node.name));
            if (Number.isNaN(n)) throw new TypeError(`msg-format: the value for {${node.name}} is not a number`);
            const shifted = n - node.offset;
            const exact = node.branches.find((b) => b.selector === `=${n}`);
            const category = (node.type === "plural" ? plurals : ordinals).select(shifted);
            const branch = exact ?? node.branches.find((b) => b.selector === category) ?? node.branches.find((b) => b.selector === "other");
            return run(branch.body, values, shifted);
          }
          case "select": {
            const key = String(value(values, node.name));
            const branch = node.branches.find((b) => b.selector === key) ?? node.branches.find((b) => b.selector === "other");
            return run(branch.body, values, pound);
          }
          case "tag": {
            const handler = tags[node.name];
            if (typeof handler !== "function") throw new Error(`msg-format: no handler for <${node.name}>; pass tags: { ${node.name}: (text) => ... }`);
            return String(handler(run(node.children, values, pound)));
          }
          default:
            return "";
        }
      })
      .join("");

  const value = (values, name) => {
    if (values === null || typeof values !== "object" || !Object.hasOwn(values, name) || values[name] === undefined) throw new Error(`msg-format: the value for {${name}} is missing`);
    return values[name];
  };

  const fn = (values = {}) => run(tree, values, 0);
  fn.required = required(tree);
  return fn;
}

const cache = new Map();

/** Formats in one go: `format("{n, plural, one {# task} other {# tasks}}", { n: 3 }, { locale: "en" })` gives `"3 tasks"`. Compiled messages are cached. */
export function format(source, values, { locale = "en", tags } = {}) {
  if (tags) return compile(source, { locale, tags })(values);
  const key = `${locale}\u0000${source}`;
  let fn = cache.get(key);
  if (!fn) {
    fn = compile(source, { locale });
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(key, fn);
  }
  return fn(values);
}
