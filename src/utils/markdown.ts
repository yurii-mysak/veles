export function extractTitle(content: string): string {
  // Try to extract title from first H1 heading
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();

  // Try first non-empty line
  const firstLine = content
    .split("\n")
    .find((line) => line.trim().length > 0);
  if (firstLine) return firstLine.trim().slice(0, 100);

  return "Untitled";
}

export function extractFrontmatterTags(content: string): string[] {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return [];

  const frontmatter = frontmatterMatch[1];
  const tagsMatch = frontmatter.match(/tags:\s*\[([^\]]*)\]/);
  if (tagsMatch) {
    return tagsMatch[1]
      .split(",")
      .map((t) => t.trim().replace(/['"]/g, ""))
      .filter(Boolean);
  }

  // YAML list format
  const tagsListMatch = frontmatter.match(/tags:\s*\n((?:\s+-\s+.+\n?)*)/);
  if (tagsListMatch) {
    return tagsListMatch[1]
      .split("\n")
      .map((line) => line.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);
  }

  return [];
}
