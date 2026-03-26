/**
 * Generate pop-art avatars for comms and content agents only.
 */
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { readEnvFile } from '../src/env.js';

const env = readEnvFile(['GOOGLE_API_KEY']);
const ai = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });
const assetsDir = path.join(import.meta.dirname, '..', 'assets');

const agents = [
  {
    id: 'comms',
    outFile: path.join(assetsDir, 'agent-comms.png'),
    prompt: `Create a bold pop-art comic book style square profile picture avatar for an AI agent called "COMMS".
Style: Retro 1960s Roy Lichtenstein pop art with ben-day dots, thick black outlines, vivid flat colors.
Character: A charismatic woman with wavy dark hair, red lipstick, wearing a headset/earpiece. She has a warm but focused expression, like she's mid-conversation managing multiple channels.
Background: Bright sky blue with geometric shapes and signal/wave patterns.
Text: The word "COMMS" in massive bold block letters across the top, white with black outline.
Bottom label: Small white text "Communications" on a dark banner at the bottom.
Square format, vibrant saturated colors, comic book halftone dots visible. No speech bubbles.`,
  },
  {
    id: 'content',
    outFile: path.join(assetsDir, 'agent-content.png'),
    prompt: `Create a bold pop-art comic book style square profile picture avatar for an AI agent called "CONTENT".
Style: Retro 1960s Roy Lichtenstein pop art with ben-day dots, thick black outlines, vivid flat colors.
Character: A creative young man with tousled hair, wearing a casual blazer over a t-shirt, holding a pen/stylus like he's about to create something. He has an inspired, energetic expression.
Background: Bright orange/amber with geometric shapes and film strip/play button motifs.
Text: The word "CONTENT" in massive bold block letters across the top, white with black outline.
Bottom label: Small white text "Content Creator" on a dark banner at the bottom.
Square format, vibrant saturated colors, comic book halftone dots visible. No speech bubbles.`,
  },
];

for (const agent of agents) {
  console.log(`Generating ${agent.id}...`);
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: agent.prompt,
    config: { responseModalities: ['TEXT', 'IMAGE'] },
  });
  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData) {
      const buf = Buffer.from(part.inlineData.data!, 'base64');
      fs.writeFileSync(agent.outFile, buf);
      console.log(`  Saved: ${agent.outFile} (${Math.round(buf.length / 1024)}KB)`);
    }
  }
}
console.log('Done.');
