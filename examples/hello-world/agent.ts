import { defineAgent } from "../../sdk/typescript/@sfa/sdk";

export default defineAgent({
  name: "hello-world",
  version: "1.0.0",
  description: "A minimal single-file agent that echoes input or says hello",
  trustLevel: "sandboxed",

  options: [
    {
      name: "greeting",
      alias: "g",
      description: "Custom greeting to use",
      type: "string",
      default: "Hello",
    },
  ],

  examples: [
    'echo "world" | bun agent.ts',
    "bun agent.ts --context 'Bun'",
    "bun agent.ts --greeting Hi --context 'there'",
  ],

  execute: async (ctx) => {
    const greeting = ctx.options.greeting as string;
    const name = ctx.input.trim() || "world";
    return { result: `${greeting}, ${name}!` };
  },
});
