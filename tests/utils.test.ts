import { describe, it, expect } from "vitest";
import { extractTitle, extractFrontmatterTags } from "../src/utils/markdown.js";
import { isSupported, isImage } from "../src/utils/files.js";

describe("markdown utils", () => {
  describe("extractTitle", () => {
    it("extracts H1 heading", () => {
      expect(extractTitle("# My Title\n\nSome content")).toBe("My Title");
    });

    it("falls back to first non-empty line", () => {
      expect(extractTitle("First line\nSecond line")).toBe("First line");
    });

    it("returns Untitled for empty content", () => {
      expect(extractTitle("")).toBe("Untitled");
    });

    it("handles whitespace-only content", () => {
      expect(extractTitle("   \n  \n  ")).toBe("Untitled");
    });

    it("truncates long first lines", () => {
      const longLine = "A".repeat(150);
      const title = extractTitle(longLine);
      expect(title.length).toBeLessThanOrEqual(100);
    });
  });

  describe("extractFrontmatterTags", () => {
    it("extracts inline tags", () => {
      const content = `---
tags: [javascript, neo4j, rag]
---
# Content`;
      expect(extractFrontmatterTags(content)).toEqual([
        "javascript",
        "neo4j",
        "rag",
      ]);
    });

    it("extracts YAML list tags", () => {
      const content = `---
tags:
  - javascript
  - neo4j
---
# Content`;
      expect(extractFrontmatterTags(content)).toEqual([
        "javascript",
        "neo4j",
      ]);
    });

    it("handles quoted tags", () => {
      const content = `---
tags: ['javascript', "neo4j"]
---`;
      expect(extractFrontmatterTags(content)).toEqual([
        "javascript",
        "neo4j",
      ]);
    });

    it("returns empty for no frontmatter", () => {
      expect(extractFrontmatterTags("# Just a heading")).toEqual([]);
    });

    it("returns empty for frontmatter without tags", () => {
      const content = `---
title: My Doc
---`;
      expect(extractFrontmatterTags(content)).toEqual([]);
    });
  });
});

describe("file utils", () => {
  describe("isSupported", () => {
    it("accepts markdown files", () => {
      expect(isSupported("doc.md")).toBe(true);
      expect(isSupported("doc.mdx")).toBe(true);
    });

    it("accepts text files", () => {
      expect(isSupported("file.txt")).toBe(true);
    });

    it("accepts code files", () => {
      expect(isSupported("app.ts")).toBe(true);
      expect(isSupported("app.py")).toBe(true);
      expect(isSupported("app.rs")).toBe(true);
    });

    it("accepts image files", () => {
      expect(isSupported("photo.png")).toBe(true);
      expect(isSupported("photo.jpg")).toBe(true);
    });

    it("rejects unsupported files", () => {
      expect(isSupported("video.mp4")).toBe(false);
      expect(isSupported("archive.zip")).toBe(false);
    });
  });

  describe("isImage", () => {
    it("identifies image files", () => {
      expect(isImage("photo.png")).toBe(true);
      expect(isImage("photo.jpg")).toBe(true);
      expect(isImage("photo.svg")).toBe(true);
    });

    it("rejects non-image files", () => {
      expect(isImage("doc.md")).toBe(false);
      expect(isImage("app.ts")).toBe(false);
    });
  });
});
