import { z } from "zod";

const binding = z.union([
  z.object({ argument: z.string() }),
  z.object({ literal: z.json() }),
]);
const bindings = z.record(z.string(), binding);

export const executionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("http"),
    url: z.string(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    query: bindings.optional(),
    headers: bindings.optional(),
    body: bindings.optional(),
    encoding: z.enum(["json", "form"]).optional(),
  }),
  z.object({
    kind: z.literal("browser"),
    url: z.string(),
    steps: z.array(z.object({
      action: z.enum(["fill", "select", "check", "click"]),
      selector: z.string(),
      value: binding.optional(),
    })),
    resultSelector: z.string(),
  }),
]);

export const serviceToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.record(z.string(), z.unknown())),
    required: z.array(z.string()).optional(),
  }).catchall(z.unknown()),
  execution: executionSchema,
});

export const serviceDefinitionSchema = z.object({
  url: z.string(),
  title: z.string(),
  tools: z.array(serviceToolSchema),
});

export type Binding = z.infer<typeof binding>;
export type ServiceExecution = z.infer<typeof executionSchema>;
export type BrowserExecution = Extract<ServiceExecution, { kind: "browser" }>;
export type ServiceTool = z.infer<typeof serviceToolSchema>;
export type ServiceDefinition = z.infer<typeof serviceDefinitionSchema>;
export type ServiceParser = (url: string) => Promise<ServiceDefinition>;

export function parseServiceArguments(tool: ServiceTool, args: Record<string, unknown>) {
  return z.fromJSONSchema(tool.inputSchema).parse(args) as Record<string, unknown>;
}
