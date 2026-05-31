import { z } from "zod";

export const SNIPPET_GROUPS = [
  "amount",
  "balance",
  "currency",
  "syncid",
  "date",
  "payee",
  "comment",
  "mcc",
  "glue",
] as const;

export type SnippetGroup = (typeof SNIPPET_GROUPS)[number];

export const snippetSchema = z.object({
  group: z.enum(SNIPPET_GROUPS),
  pattern: z.string().min(1),
  desc: z.string().min(1),
  trigger: z.string().optional(),
  example: z.string().optional(),
  gotcha: z.string().optional(),
  kind: z.enum(["default", "alt"]).default("default"),
});

export type ParsedSnippet = z.infer<typeof snippetSchema>;

export interface RegexSnippet extends ParsedSnippet {
  id: string;
}

export function filterSnippets(
  snippets: RegexSnippet[],
  query: string
): RegexSnippet[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return snippets;
  }
  return snippets.filter(
    (snippet) =>
      snippet.pattern.toLowerCase().includes(q) ||
      snippet.desc.toLowerCase().includes(q) ||
      snippet.group.toLowerCase().includes(q) ||
      (snippet.trigger?.toLowerCase().includes(q) ?? false)
  );
}

export function groupSnippets(
  snippets: RegexSnippet[]
): Array<{ group: SnippetGroup; snippets: RegexSnippet[] }> {
  const order = new Map<SnippetGroup, RegexSnippet[]>();
  for (const snippet of snippets) {
    const bucket = order.get(snippet.group);
    if (bucket) {
      bucket.push(snippet);
    } else {
      order.set(snippet.group, [snippet]);
    }
  }
  return Array.from(order, ([group, items]) => ({ group, snippets: items }));
}
