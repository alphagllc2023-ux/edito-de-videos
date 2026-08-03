#!/usr/bin/env node

import ora from "ora";
import chalk from "chalk";
import * as dotenv from "dotenv";
import {
  generateAiImage,
  generateVoice,
  openaiStructuredCompletion,
  setApiKey,
} from "./service";
import { StoryMetadataWithDetails, StoryWithImages } from "../src/lib/types";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import { createTimeLineFromStoryWithDetails } from "./timeline";

dotenv.config({ quiet: true });

const TITLE = "Lo que tus hormonas le hacen a tu sueño";

const SCRIPT_SEGMENTS = [
  "¿Te despiertas a las 3 de la mañana sin ningún motivo? No es casualidad.",
  "Con el cambio hormonal, baja el estrógeno y la progesterona, que son las que te ayudaban a dormir profundo.",
  "Resultado: te cuesta más conciliar, te despiertas de madrugada y amaneces sin batería.",
  "No es que duermas mal porque sí. Tiene una explicación, y eso ya es un alivio.",
  "Empieza por cuidar tu rutina de la noche, y si el insomnio se vuelve constante, habla con tu médica: mereces descansar.",
];

const getImageDescriptionPrompt = (segments: string[]) => {
  const joined = segments.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `You are given a voiceover script for a vertical short video about hormones and sleep.
Generate one detailed, visually engaging image description for each segment.
Images must be in a cinematic, warm, soft-light aesthetic.
Show real-life scenarios (a woman waking up at 3am, biology illustrations, cozy bedroom routines, etc.).
No text overlays in the images.
Return a JSON array matching each segment to an imageDescription.

Script segments:
${joined}

Output JSON:
[
  { "text": "...", "imageDescription": "..." },
  ...
]`;
};

class ContentFS {
  slug: string;

  constructor(title: string) {
    this.slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  saveDescriptor(descriptor: StoryMetadataWithDetails) {
    const filePath = path.join(this.getDir(), "descriptor.json");
    fs.writeFileSync(filePath, JSON.stringify(descriptor, null, 2));
  }

  saveTimeline(timeline: object) {
    const filePath = path.join(this.getDir(), "timeline.json");
    fs.writeFileSync(filePath, JSON.stringify(timeline, null, 2));
  }

  getDir(dir?: string): string {
    const segments = ["public", "content", this.slug];
    if (dir) segments.push(dir);
    const p = path.join(process.cwd(), ...segments);
    fs.mkdirSync(p, { recursive: true });
    return p;
  }

  getImagePath(uid: string) {
    return path.join(this.getDir("images"), `${uid}.png`);
  }

  getAudioPath(uid: string) {
    return path.join(this.getDir("audio"), `${uid}.mp3`);
  }
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  const elevenlabsApiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) { console.error(chalk.red("Missing OPENAI_API_KEY in .env")); process.exit(1); }
  if (!elevenlabsApiKey) { console.error(chalk.red("Missing ELEVENLABS_API_KEY in .env")); process.exit(1); }

  setApiKey(apiKey);

  console.log(chalk.blue(`\n🎬 Generando video: "${TITLE}"\n`));

  const contentFs = new ContentFS(TITLE);

  // Step 1: Generate image descriptions for our custom script
  const descSpinner = ora("Generando descripciones de imágenes...").start();
  const storyWithImages = await openaiStructuredCompletion(
    getImageDescriptionPrompt(SCRIPT_SEGMENTS),
    StoryWithImages,
  );
  descSpinner.succeed(chalk.green("Descripciones generadas!"));

  const storyWithDetails: StoryMetadataWithDetails = {
    shortTitle: TITLE,
    content: storyWithImages.result.map((item) => ({
      text: item.text,
      imageDescription: item.imageDescription,
      uid: uuidv4(),
      audioTimestamps: { characters: [], characterStartTimesSeconds: [], characterEndTimesSeconds: [] },
    })),
  };

  contentFs.saveDescriptor(storyWithDetails);

  // Step 2: Generate images + voice for each segment
  const mediaSpinner = ora("Generando imágenes y voiceover...").start();
  for (let i = 0; i < storyWithDetails.content.length; i++) {
    const item = storyWithDetails.content[i];

    mediaSpinner.text = `[${i * 2 + 1}/${storyWithDetails.content.length * 2}] Imagen: ${item.text.slice(0, 40)}...`;
    await generateAiImage({
      prompt: item.imageDescription,
      path: contentFs.getImagePath(item.uid),
      onRetry: (attempt) => {
        mediaSpinner.text = `Reintentando imagen ${i + 1} (intento ${attempt + 1})...`;
      },
    });

    mediaSpinner.text = `[${i * 2 + 2}/${storyWithDetails.content.length * 2}] Voz: ${item.text.slice(0, 40)}...`;
    const timings = await generateVoice(item.text, elevenlabsApiKey, contentFs.getAudioPath(item.uid));
    item.audioTimestamps = timings;
  }
  mediaSpinner.succeed(chalk.green("Imágenes y audio generados!"));

  contentFs.saveDescriptor(storyWithDetails);

  // Step 3: Build timeline
  const timelineSpinner = ora("Construyendo timeline...").start();
  const timeline = createTimeLineFromStoryWithDetails(storyWithDetails);
  contentFs.saveTimeline(timeline);
  timelineSpinner.succeed(chalk.green("Timeline listo!"));

  console.log(chalk.green.bold("\n✨ Video generado!\n"));
  console.log("Ejecuta " + chalk.blue("npm run dev") + " para previsualizarlo");
  console.log("O renderiza con " + chalk.blue(`npx remotion render "${TITLE.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}"`));
}

main().catch((err) => {
  console.error(chalk.red("\n❌ Error:"), err);
  process.exit(1);
});
