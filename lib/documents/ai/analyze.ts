// Grok 4.3 vision call wrappers. Two functions — classifyImage (Mode A,
// no existing data) and deltaImage (Mode B, against existing inventory
// data). Both route through the Vercel AI Gateway via the AI SDK's
// `generateObject` helper, which validates Grok's output against the
// Zod schema before returning.
//
// Model selection is env-var-driven (NAMEPLATE_PRIMARY_MODEL) so we can
// swap models without a code change. Callers (server actions) are
// responsible for catching errors and surfacing them to the user.
//
// Image input is a fetchable URL — phase 1.4's server action passes a
// short-lived Supabase storage signed URL rather than loading the
// bytes into the Node process.

import { generateObject } from "ai";
import {
  classificationSchema,
  deltaSchema,
  type ClassificationResult,
  type DeltaResult,
} from "./schema";
import { buildClassifyPrompt, buildDeltaPrompt } from "./prompt";

export type AnalyzeImageInput = {
  /** Image bytes as a base64-encoded data URL or a public URL. */
  imageUrl: string;
};

export type ClassifyImageInput = AnalyzeImageInput;

export type DeltaImageInput = AnalyzeImageInput & {
  existingInventoryData: Record<string, unknown>;
};

function getModelString(): string {
  const m = process.env.NAMEPLATE_PRIMARY_MODEL;
  if (!m) {
    throw new Error(
      "NAMEPLATE_PRIMARY_MODEL is not set. Configure it in the environment.",
    );
  }
  return m;
}

export async function classifyImage(
  input: ClassifyImageInput,
): Promise<ClassificationResult> {
  const result = await generateObject({
    model: getModelString(),
    schema: classificationSchema,
    system: buildClassifyPrompt(),
    messages: [
      {
        role: "user",
        content: [{ type: "image", image: new URL(input.imageUrl) }],
      },
    ],
  });
  return result.object;
}

export async function deltaImage(
  input: DeltaImageInput,
): Promise<DeltaResult> {
  const result = await generateObject({
    model: getModelString(),
    schema: deltaSchema,
    system: buildDeltaPrompt({
      existingInventoryData: input.existingInventoryData,
    }),
    messages: [
      {
        role: "user",
        content: [{ type: "image", image: new URL(input.imageUrl) }],
      },
    ],
  });
  return result.object;
}
