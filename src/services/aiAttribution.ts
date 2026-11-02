import OpenAI from "openai";

/** Creates a concise lineage caption. Falls back cleanly for offline demos. */
export async function generateAttributionSummary(
  parentStreamer: string,
  childStreamer: string,
  chatContextSnippet: string,
  splitPercentage: number,
): Promise<string> {
  const fallback = `${childStreamer} forked ${parentStreamer}'s stream with a ${splitPercentage}% attribution link.`;
  if (!process.env.OPENAI_API_KEY) return fallback;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.6,
      max_tokens: 80,
      messages: [
        {
          role: "system",
          content: "Write one short, factual sentence describing a creator content lineage link. Do not invent events beyond the supplied context.",
        },
        {
          role: "user",
          content: `Parent: ${parentStreamer}\nChild: ${childStreamer}\nAttribution: ${splitPercentage}%\nChat context: ${chatContextSnippet.slice(0, 600) || "No chat context provided."}`,
        },
      ],
    });
    return response.choices[0]?.message.content?.trim() || fallback;
  } catch (error) {
    console.warn("AI attribution unavailable; using fallback:", error instanceof Error ? error.message : error);
    return fallback;
  }
}
