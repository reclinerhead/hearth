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
  receiptExtractionSchema,
  type ClassificationResult,
  type DeltaResult,
  type ReceiptExtractionResult,
} from "./schema";
import {
  buildClassifyPrompt,
  buildDeltaPrompt,
  buildReceiptPrompt,
} from "./prompt";

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

export type AnalyzeReceiptInput = {
  /**
   * Page URLs in order — page 1 first, then page 2, etc. The receipt
   * prompt expects the pages as ordered image parts in a single user
   * message so the model treats the document as one logical thing
   * (vendor on page 1, total on the final page, line items spanning).
   */
  pageUrls: string[];
};

/**
 * Multi-page receipt extraction. All pages go to the model in a single
 * generateObject call so vendor/total/line-item ordering is preserved
 * — per-page extraction with downstream merge introduces ambiguity
 * that single-call extraction avoids (see issue #117 "Why one
 * extraction across all pages").
 */
export async function analyzeReceipt(
  input: AnalyzeReceiptInput,
): Promise<ReceiptExtractionResult> {
  if (input.pageUrls.length === 0) {
    throw new Error("analyzeReceipt: pageUrls must contain at least one page");
  }
  const result = await generateObject({
    model: getModelString(),
    schema: receiptExtractionSchema,
    system: buildReceiptPrompt(),
    messages: [
      {
        role: "user",
        content: [
          ...input.pageUrls.map(
            (url) =>
              ({ type: "image", image: new URL(url) }) as const,
          ),
          {
            type: "text",
            text: "Extract the receipt data per the system prompt. Treat the images above as the ordered pages of a single receipt.",
          },
        ],
      },
    ],
  });
  return result.object;
}
