import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error("Error: GOOGLE_API_KEY environment variable is required");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

const prompt = `Generate a clean, modern technical architecture diagram image with the following specifications:

Title: "ClaudeClaw Multi-Agent System" at the top in bold white text.

Dark theme: dark charcoal/navy background (#1a1a2e or similar), with light text and colored accent borders.

CENTER: A large rounded rectangle representing "SQLite Database" with a database icon. Inside it, show a smaller table labeled "hive_mind" with columns: agent, action, timestamp. Use a subtle glow or accent color (cyan/teal).

SURROUNDING the database, place 5 agent boxes arranged in a pentagon/circle layout:
1. "Main Bot" (top center) - purple accent border, small robot icon
2. "Comms" (top right) - blue accent border, small chat bubble icon
3. "Content" (bottom right) - green accent border, small document/pen icon
4. "Ops" (bottom left) - orange accent border, small gear icon
5. "Research" (top left) - red/pink accent border, small magnifying glass icon

Each agent box should contain 3 small labels stacked:
- "CLAUDE.md" (config file)
- "Telegram Bot" (its own bot)
- "Session" (its own session)

Draw bidirectional arrows (white/light gray) from each agent box to the central SQLite database, labeled "read/write".

On the RIGHT SIDE: An "Obsidian Vault" box (styled like a purple/violet vault icon with a notebook look). Draw arrows FROM the Obsidian Vault TO only these 3 agents: Comms, Content, and Ops. No arrow to Research. Label arrows "notes sync".

Style: Technical architecture diagram. Clean lines, rounded corners on boxes, consistent spacing, professional look. Similar to AWS/cloud architecture diagrams but with a dark gaming-dashboard aesthetic. No cartoon elements. Subtle drop shadows on boxes.

The overall image should be landscape orientation, high resolution, suitable for documentation.`;

async function main() {
  console.log("Generating architecture diagram with Gemini...");

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  });

  let imageSaved = false;

  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      const imageData = part.inlineData.data;
      const outPath = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "assets", "multi-agent-architecture.png");

      // Ensure directory exists
      fs.mkdirSync(path.dirname(outPath), { recursive: true });

      fs.writeFileSync(outPath, Buffer.from(imageData, "base64"));
      console.log(`Image saved to: ${outPath}`);
      imageSaved = true;
    } else if (part.text) {
      console.log("Model text:", part.text);
    }
  }

  if (!imageSaved) {
    console.error("No image was generated in the response.");
    console.log("Full response:", JSON.stringify(response.candidates[0].content.parts.map(p => p.text || "[image]"), null, 2));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
