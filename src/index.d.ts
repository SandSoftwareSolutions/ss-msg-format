export type Tag = (content: string) => string;
export type Values = Record<string, unknown>;

export class MessageSyntaxError extends Error {
  readonly position: number;
}

export interface Node {
  type: "text" | "arg" | "number" | "date" | "time" | "plural" | "selectordinal" | "select" | "pound" | "tag";
  [key: string]: unknown;
}

export interface Compiled {
  (values?: Values): string;
  /** The value names the message needs. */
  readonly required: string[];
}

export function parse(source: string): Node[];
export function required(source: string | Node[]): string[];
export function compile(source: string, options?: { locale?: string; tags?: Record<string, Tag> }): Compiled;
export function format(source: string, values?: Values, options?: { locale?: string; tags?: Record<string, Tag> }): string;
