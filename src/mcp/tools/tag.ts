import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createTag,
  listTags,
  renameTag,
  deleteTag,
  setTagParent,
} from "../../models/tag.js";

export function registerTagTool(server: McpServer) {
  server.tool(
    "veles_tag",
    "Manage tags (create, list, rename, delete, set parent)",
    {
      action: z
        .enum(["create", "list", "rename", "delete", "set_parent"])
        .describe("Tag action to perform"),
      name: z
        .string()
        .optional()
        .describe(
          "Tag name (required for create, rename, delete, set_parent)",
        ),
      new_name: z
        .string()
        .optional()
        .describe("New tag name (for rename action)"),
      parent: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Parent tag name (for set_parent and create; null to remove parent)",
        ),
      category: z
        .string()
        .optional()
        .describe("Tag category (for create action)"),
    },
    async ({ action, name, new_name, parent, category }) => {
      switch (action) {
        case "list": {
          const tags = await listTags();

          if (tags.length === 0) {
            return {
              content: [
                { type: "text" as const, text: "No tags found." },
              ],
            };
          }

          const header = "Name                | Category   | Parent     | Resources";
          const separator = "-".repeat(header.length);
          const rows = tags.map((t) => {
            const tagName = t.name.padEnd(20);
            const cat = (t.category || "-").padEnd(11);
            const par = (t.parent || "-").padEnd(11);
            return `${tagName}| ${cat}| ${par}| ${t.resourceCount}`;
          });

          return {
            content: [
              {
                type: "text" as const,
                text: [
                  `${tags.length} tag(s):`,
                  "",
                  header,
                  separator,
                  ...rows,
                ].join("\n"),
              },
            ],
          };
        }

        case "create": {
          if (!name) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: 'name' is required for create action",
                },
              ],
            };
          }

          const tag = await createTag(name, { category, parent: parent ?? undefined });

          return {
            content: [
              {
                type: "text" as const,
                text: [
                  `Tag created successfully.`,
                  `  Name: ${tag.name}`,
                  `  ID: ${tag.id}`,
                  `  Category: ${tag.category || "(none)"}`,
                  `  Parent: ${tag.parent || "(none)"}`,
                ].join("\n"),
              },
            ],
          };
        }

        case "rename": {
          if (!name || !new_name) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: 'name' and 'new_name' are required for rename action",
                },
              ],
            };
          }

          const renamed = await renameTag(name, new_name);

          if (!renamed) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Tag not found: ${name}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `Tag renamed from "${name}" to "${new_name}".`,
              },
            ],
          };
        }

        case "delete": {
          if (!name) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: 'name' is required for delete action",
                },
              ],
            };
          }

          const deleted = await deleteTag(name);

          if (!deleted) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Tag not found: ${name}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `Tag "${name}" deleted.`,
              },
            ],
          };
        }

        case "set_parent": {
          if (!name) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: 'name' is required for set_parent action",
                },
              ],
            };
          }

          const parentValue = parent ?? null;
          await setTagParent(name, parentValue);

          const msg = parentValue
            ? `Tag "${name}" parent set to "${parentValue}".`
            : `Tag "${name}" parent removed.`;

          return {
            content: [
              { type: "text" as const, text: msg },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: "text" as const,
                text: `Unknown action: ${action}`,
              },
            ],
          };
      }
    },
  );
}
