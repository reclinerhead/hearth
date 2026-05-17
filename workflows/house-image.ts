import { generateImage } from "ai";
import { buildHouseImagePrompt } from "@/lib/house-image/prompt";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Generated-image workflow. Builds a stylized architectural sketch from
 * the row's era / style / stories signals, uploads it to the
 * `house-images` Storage bucket at `{house_id}/generated-sketch.png`, and
 * stamps the storage path + prompt + timestamp onto hearth.houses.
 *
 * The sketch is a generic illustration of a typical home of that era —
 * NOT a depiction of the actual house. The dashboard surfaces a
 * disclaimer to that effect alongside the image; that framing matters
 * and should not be relaxed elsewhere in the system.
 *
 * Started in two places:
 *   - workflows/briefing.ts after persistBriefingSuccess (fire-and-forget,
 *     same pattern as habitat), so newly created houses pick one up
 *     automatically.
 *   - app/(app)/dashboard/actions.ts regenerateHouseImage server action,
 *     so the user can re-roll from the dashboard.
 *
 * Idempotent: upload uses upsert=true, so a regenerate overwrites in
 * place. The DB row's generated_image_url path is stable, so signed URLs
 * derived against it remain valid through a regenerate.
 *
 * Errors are logged but do NOT taint a status column on hearth.houses —
 * unlike the briefing, this is a best-effort enrichment. The dashboard's
 * fallback placeholder and the regenerate affordance cover the failure
 * surface, so a stuck status flag would only add noise.
 */
export async function runHouseImage(houseId: string): Promise<void> {
  "use workflow";

  try {
    const input = await loadHouseForImage(houseId);
    const result = await generateSketch(input);
    await persistHouseImage(houseId, result);
  } catch (err) {
    console.error("runHouseImage failed", { houseId, err });
  }
}

type HouseImageInput = {
  houseId: string;
  yearBuilt: number | null;
  description: string | null;
};

async function loadHouseForImage(houseId: string): Promise<HouseImageInput> {
  "use step";

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("houses")
    .select("year_built, description")
    .eq("id", houseId)
    .single();

  if (error || !data) {
    throw new Error(
      `Could not load house ${houseId} for image generation: ${
        error?.message ?? "not found"
      }`,
    );
  }

  return {
    houseId,
    yearBuilt: data.year_built,
    description: data.description,
  };
}

type SketchResult = {
  prompt: string;
  imageBytes: Uint8Array;
};

const DEFAULT_MODEL = "openai/dall-e-3";

async function generateSketch(input: HouseImageInput): Promise<SketchResult> {
  "use step";

  const prompt = buildHouseImagePrompt({
    yearBuilt: input.yearBuilt,
    description: input.description,
  });

  // HOUSE_IMAGE_MODEL overrides the default without a code change. The
  // gateway's GA OpenAI image model is `openai/gpt-image-1`; the spec
  // calls for `openai/dall-e-3` and the gateway will accept it as a
  // fallthrough string. Flip the env var if the gateway returns an
  // unknown-model error. The providerOptions below are DALL-E 3-specific
  // and are silently ignored by `gpt-image-1`.
  const model = process.env.HOUSE_IMAGE_MODEL || DEFAULT_MODEL;

  const { image } = await generateImage({
    model,
    prompt,
    size: "1024x1024",
    providerOptions: {
      openai: {
        quality: "standard",
        style: "natural",
      },
    },
  });

  return {
    prompt,
    imageBytes: image.uint8Array,
  };
}

const BUCKET = "house-images";
const IMAGE_FILENAME = "generated-sketch.png";

async function persistHouseImage(
  houseId: string,
  result: SketchResult,
): Promise<void> {
  "use step";

  const supabase = createServiceClient();
  const path = `${houseId}/${IMAGE_FILENAME}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, result.imageBytes, {
      contentType: "image/png",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(
      `Could not upload generated image for ${houseId}: ${uploadError.message}`,
    );
  }

  const { error: updateError } = await supabase
    .from("houses")
    .update({
      generated_image_url: path,
      generated_image_prompt: result.prompt,
      generated_image_created_at: new Date().toISOString(),
    })
    .eq("id", houseId);

  if (updateError) {
    throw new Error(
      `Could not write generated image metadata for ${houseId}: ${updateError.message}`,
    );
  }
}
