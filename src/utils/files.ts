import { readFile, readdir, stat } from "fs/promises";
import { join, extname } from "path";

const SUPPORTED_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".text",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".csv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".rb",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".html",
  ".css",
  ".xml",
]);

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
]);

export function isSupported(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
}

export function isImage(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

export async function readTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf-8");
}

export interface FileEntry {
  path: string;
  name: string;
  isImage: boolean;
}

export async function walkDirectory(
  dirPath: string,
  recursive: boolean = true,
): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  const items = await readdir(dirPath);

  for (const item of items) {
    const fullPath = join(dirPath, item);
    const stats = await stat(fullPath);

    if (stats.isDirectory() && recursive) {
      const subEntries = await walkDirectory(fullPath, true);
      entries.push(...subEntries);
    } else if (stats.isFile() && isSupported(fullPath)) {
      entries.push({
        path: fullPath,
        name: item,
        isImage: IMAGE_EXTENSIONS.has(extname(fullPath).toLowerCase()),
      });
    }
  }

  return entries;
}
