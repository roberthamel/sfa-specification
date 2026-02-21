import { defineAgent } from "../../sdk/typescript/@sfa/sdk";

export default defineAgent({
  name: "semantic-search",
  version: "1.0.0",
  description: "Indexes and searches text semantically using pgvector",
  trustLevel: "network",
  contextRetention: "session",

  env: [
    { name: "OPENAI_API_KEY", required: true, secret: true, description: "OpenAI API key for generating embeddings" },
    { name: "DB_PASSWORD", default: "sfa_secret", description: "Password for the embedded PostgreSQL database" },
  ],

  services: {
    postgres: {
      image: "pgvector/pgvector:pg16",
      ports: ["5432:5432"],
      environment: {
        POSTGRES_PASSWORD: "${DB_PASSWORD}",
        POSTGRES_DB: "semantic_search",
      },
      healthcheck: {
        test: "pg_isready -U postgres",
        interval: "5s",
        retries: 5,
      },
      connectionString: "postgresql://postgres:${DB_PASSWORD}@${host}:${port}/semantic_search",
    },
  },
  serviceLifecycle: "persistent",

  options: [
    {
      name: "mode",
      alias: "m",
      description: "Operation mode: index or search",
      type: "string",
      default: "search",
    },
    {
      name: "limit",
      alias: "n",
      description: "Maximum number of search results",
      type: "number",
      default: 5,
    },
  ],

  examples: [
    'echo "How does authentication work?" | bun agent.ts',
    'bun agent.ts --mode index --context-file docs/README.md',
    'bun agent.ts --mode search --context "error handling" --limit 3',
  ],

  execute: async (ctx) => {
    const mode = ctx.options.mode as string;
    const dbUrl = ctx.env.SFA_SVC_POSTGRES_URL;

    if (!dbUrl) {
      return { result: { error: "Database not available" }, error: "SFA_SVC_POSTGRES_URL not set" };
    }

    ctx.progress(`connecting to database`);

    // NOTE: In a real implementation, you would:
    // 1. Connect to PostgreSQL using dbUrl
    // 2. Ensure the pgvector extension and table exist
    // 3. Call the OpenAI embeddings API to vectorize text
    // 4. Insert or query vectors in pgvector
    //
    // This example demonstrates the SFA patterns (services, env, context store)
    // without requiring a live database or API key during development.

    if (mode === "index") {
      const text = ctx.input;
      if (!text) {
        return { result: { indexed: false }, error: "No text provided to index" };
      }

      ctx.progress("generating embeddings");
      // Simulated: const embedding = await getEmbedding(text, ctx.env.OPENAI_API_KEY);
      // Simulated: await insertVector(dbUrl, text, embedding);

      ctx.progress("storing in pgvector");
      const chunks = text.split(/\n\n+/).filter(Boolean);

      await ctx.writeContext({
        type: "artifact",
        tags: ["semantic-search", "index"],
        slug: "indexed-document",
        content: `# Indexed Document\n\nChunks: ${chunks.length}\nCharacters: ${text.length}\nDatabase: ${dbUrl}`,
      });

      return {
        result: {
          indexed: true,
          chunks: chunks.length,
          characters: text.length,
        },
      };
    }

    if (mode === "search") {
      const query = ctx.input;
      if (!query) {
        return { result: { results: [] }, error: "No search query provided" };
      }

      const limit = ctx.options.limit as number;
      ctx.progress(`searching for: ${query}`);

      // Simulated: const queryEmbedding = await getEmbedding(query, ctx.env.OPENAI_API_KEY);
      // Simulated: const results = await searchVectors(dbUrl, queryEmbedding, limit);

      // Simulated results for demonstration
      const results = [
        { score: 0.95, text: `Relevant result for "${query}" (simulated)`, chunk_id: 1 },
        { score: 0.87, text: `Another match for "${query}" (simulated)`, chunk_id: 2 },
      ].slice(0, limit);

      await ctx.writeContext({
        type: "finding",
        tags: ["semantic-search", "query"],
        slug: "search-results",
        content: `# Search Results\n\nQuery: ${query}\nResults: ${results.length}\n\n${results
          .map((r) => `- [${r.score.toFixed(2)}] ${r.text}`)
          .join("\n")}`,
      });

      return {
        result: {
          query,
          results,
          total: results.length,
        },
      };
    }

    return { result: { error: `Unknown mode: ${mode}` }, error: `Mode must be 'index' or 'search'` };
  },
});
