import { v } from "convex/values";
import { query, mutation, action, internalMutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import OpenAI from "openai";
import type {
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { internal } from "./_generated/api";

const inputTypeValidator = v.union(
  v.literal("text"),
  v.literal("single_image"),
  v.literal("multiple_images"),
  v.literal("two_images"), // legacy, kept so older evaluations still validate
);

const resultValidator = v.object({
  reasoning: v.string(),
  coverage: v.string(),
  confidence: v.string(),
  conclusion: v.string(),
  courseMatches: v.optional(v.string()),
});

// OpenRouter exposes an OpenAI-compatible API, so the OpenAI SDK works with a different base URL.
function getOpenRouterClient() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Run `npx convex env set OPENROUTER_API_KEY <key>`.");
  }
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    defaultHeaders: { "X-Title": "Course Evaluator" },
  });
}

function getModel() {
  const model = process.env.OPENROUTER_MODEL;
  if (!model) {
    throw new Error("OPENROUTER_MODEL is not set. Run `npx convex env set OPENROUTER_MODEL <model-id>`, e.g. anthropic/claude-haiku-5.5.");
  }
  return model;
}

export const listEvaluations = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const evaluations = await ctx.db
      .query("evaluations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);

    return Promise.all(
      evaluations.map(async (evaluation) => ({
        ...evaluation,
        imageUrls: evaluation.imageIds
          ? await Promise.all(
              evaluation.imageIds.map(id => ctx.storage.getUrl(id))
            )
          : undefined,
      }))
    );
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

const BASE_SYSTEM_PROMPT = `You are an experienced registrar and academic advisor who evaluates transfer credit. You compare EXTERNAL courses (completed at another institution) with INTERNAL courses (offered by the receiving institution) and decide whether an external course should earn credit for an internal course.

The question is always whether the external course covers what the internal course requires. An external course that covers only a small part of the internal course is not equivalent, even if everything it does cover also appears in the internal course.

Compare the courses on:
- Learning objectives and outcomes
- Topics covered, and the depth and breadth of that coverage
- Academic level (introductory, intermediate, advanced) and prerequisites
- Credit hours and contact time
- Assessment methods, when available

Use this scale:
- Equivalent: the external course covers the internal course's core outcomes and topics (roughly 80% or more) at a comparable level and credit value.
- Partially Equivalent: substantial overlap (roughly 50-80%), or a gap in level or credit hours that a reviewer might resolve with elective credit or supplemental work.
- Not Equivalent: limited overlap, or a significant mismatch in level or scope.

Base the evaluation only on the provided descriptions and do not assume content that isn't stated. If information is missing, illegible, or ambiguous, say so in your reasoning and lower your confidence rather than guessing.`;

const SIMPLE_MODE_PROMPT = `The input contains one external course and one internal course.
- Text input: the courses are usually labeled, e.g. "External Course:" and "Internal Course:". If they are unlabeled, treat the first course as external and the second as internal, and state that assumption in your reasoning.
- Image input: the external course is usually on the left and the internal course on the right. If the layout differs, explain how you identified each course.

Set courseMatches to an empty string.`;

const ADVANCED_MODE_PROMPT = `The input may contain several external courses and several internal courses.
- Compare each external course against the most similar internal course(s).
- Identify which external courses have equivalents, partial equivalents, or none.
- Note gaps in coverage and content that appears in only one group.
- If only one group is provided, describe those courses and explain that no equivalency determination can be made.`;

const OUTPUT_PROMPT = `Fill in the response fields as follows:
- reasoning: a step-by-step comparison of the courses covering the criteria above, noting similarities, differences, and any problems reading the input. Write this before deciding on the other fields.
- coverage: the percentage of the internal course's core content and outcomes covered by the external course, e.g. "75%". With multiple courses, give the overall figure.
- confidence: how certain you are, as a percentage followed by the main factors that reduce it, e.g. "85% - prerequisites not listed".
- conclusion: begin with exactly one of "Equivalent", "Partially Equivalent", or "Not Equivalent" (the overall determination), followed by a brief rationale.
- courseMatches: with multiple courses, one line per external course in the form "<external course> -> <internal course>: <Equivalent | Partially Equivalent | Not Equivalent> - <reason>". Otherwise an empty string.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    coverage: { type: "string" },
    confidence: { type: "string" },
    conclusion: { type: "string" },
    courseMatches: { type: "string" },
  },
  required: ["reasoning", "coverage", "confidence", "conclusion", "courseMatches"],
  additionalProperties: false,
};

// Coerce model output into the shape saveEvaluation expects, so a slightly off response doesn't fail validation after the call has been paid for.
function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function parseResult(resultText: string, isSimpleMode: boolean) {
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    // Fall back to the outermost {...} in case the model wrapped the JSON in prose or a code block.
    const start = resultText.indexOf("{");
    const end = resultText.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(resultText.slice(start, end + 1));
      } catch {
        parsed = undefined;
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      reasoning: resultText,
      coverage: "Unable to determine",
      confidence: "Low due to parsing error",
      conclusion: "Unable to determine equivalence",
      courseMatches: isSimpleMode ? undefined : "Unable to parse course matches",
    };
  }

  const courseMatches = toText(parsed.courseMatches);
  return {
    reasoning: toText(parsed.reasoning),
    coverage: toText(parsed.coverage),
    confidence: toText(parsed.confidence),
    conclusion: toText(parsed.conclusion),
    courseMatches: !isSimpleMode && courseMatches ? courseMatches : undefined,
  };
}

export const evaluateCourses = action({
  args: {
    inputType: inputTypeValidator,
    textInput: v.optional(v.string()),
    imageIds: v.optional(v.array(v.id("_storage"))),
    externalCoursesCount: v.optional(v.number()),
    internalCoursesCount: v.optional(v.number()),
    isSimpleMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const isSimpleMode = args.isSimpleMode ?? false;
    let userContent: string | ChatCompletionContentPart[];

    if (args.inputType === "text" && args.textInput) {
      userContent = `Evaluate the following course descriptions for transfer equivalency.

<course_descriptions>
${args.textInput}
</course_descriptions>`;
    } else if (args.imageIds && args.imageIds.length > 0) {
      const imageUrls = await Promise.all(
        args.imageIds.map(async (id) => {
          const url = await ctx.storage.getUrl(id);
          if (!url) throw new Error("Image not found");
          return url;
        })
      );

      const parts: ChatCompletionContentPart[] = [];
      if (isSimpleMode) {
        parts.push({
          type: "text",
          text: "Evaluate the course descriptions in the following image for transfer equivalency. The image contains both the external and the internal course.",
        });
        imageUrls.forEach((url) => parts.push({ type: "image_url", image_url: { url } }));
      } else {
        // Label each image explicitly rather than relying on the model to count positions.
        const externalCount = args.externalCoursesCount ?? 0;
        const internalCount = imageUrls.length - externalCount;
        parts.push({
          type: "text",
          text: `Evaluate the course descriptions in the following images for transfer equivalency. There are ${externalCount} external course image(s) and ${internalCount} internal course image(s), each labeled below.`,
        });
        imageUrls.forEach((url, index) => {
          const label = index < externalCount
            ? `EXTERNAL course image ${index + 1} of ${externalCount}:`
            : `INTERNAL course image ${index - externalCount + 1} of ${internalCount}:`;
          parts.push({ type: "text", text: label });
          parts.push({ type: "image_url", image_url: { url } });
        });
      }
      userContent = parts;
    } else {
      throw new Error("No course descriptions provided");
    }

    const systemPrompt = [
      BASE_SYSTEM_PROMPT,
      isSimpleMode ? SIMPLE_MODE_PROMPT : ADVANCED_MODE_PROMPT,
      OUTPUT_PROMPT,
    ].join("\n\n");

    const request: ChatCompletionCreateParamsNonStreaming & {
      provider: { require_parameters: boolean };
    } = {
      model: getModel(),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "course_evaluation", strict: true, schema: RESPONSE_SCHEMA },
      },
      // Only route to OpenRouter providers that honor response_format, so output is always schema-valid JSON.
      provider: { require_parameters: true },
    };

    const response = await getOpenRouterClient().chat.completions.create(request);

    const resultText = response.choices[0]?.message.content;
    if (!resultText) {
      throw new Error("No response from the model");
    }

    const result = parseResult(resultText, isSimpleMode);

    // Save the evaluation
    await ctx.runMutation(internal.evaluations.saveEvaluation, {
      userId,
      inputType: args.inputType,
      textInput: args.textInput,
      imageIds: args.imageIds,
      result,
      externalCoursesCount: args.externalCoursesCount,
      internalCoursesCount: args.internalCoursesCount,
      isSimpleMode: args.isSimpleMode,
    });

    return result;
  },
});

export const saveEvaluation = internalMutation({
  args: {
    userId: v.id("users"),
    inputType: inputTypeValidator,
    textInput: v.optional(v.string()),
    imageIds: v.optional(v.array(v.id("_storage"))),
    result: resultValidator,
    externalCoursesCount: v.optional(v.number()),
    internalCoursesCount: v.optional(v.number()),
    isSimpleMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("evaluations", args);
  },
});
