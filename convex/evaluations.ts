import { v } from "convex/values";
import { query, mutation, action, internalMutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import OpenAI from "openai";
import { internal } from "./_generated/api";

const openai = new OpenAI({
  baseURL: process.env.CONVEX_OPENAI_BASE_URL,
  apiKey: process.env.CONVEX_OPENAI_API_KEY,
});

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

export const evaluateCourses = action({
  args: {
    inputType: v.union(v.literal("text"), v.literal("single_image"), v.literal("two_images")),
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

    const inputs: { name: string; value: string }[] = [];

    if (args.inputType) {
      inputs.push({ name: "inputType", value: args.inputType });
    }
    if (args.textInput) {
      inputs.push({ name: "textInput", value: args.textInput });
    }
    if (args.isSimpleMode !== undefined) {
      inputs.push({ name: "isSimpleMode", value: String(args.isSimpleMode) });
    }
    if (args.externalCoursesCount !== undefined) {
      inputs.push({ name: "externalCoursesCount", value: String(args.externalCoursesCount) });
    }
    if (args.internalCoursesCount !== undefined) {
      inputs.push({ name: "internalCoursesCount", value: String(args.internalCoursesCount) });
    }

    if (args.imageIds && args.imageIds.length > 0) {
      const imageUrls = await Promise.all(
        args.imageIds.map(async (id) => {
          const url = await ctx.storage.getUrl(id);
          if (!url) throw new Error("Image not found");
          return url;
        })
      );
      inputs.push({ name: "imageUrls", value: JSON.stringify(imageUrls) });
    }

    const response = await (openai as any).responses.create({
      prompt: {
        id: "pmpt_68dff5d001ac819484e9f33bf7f867e40787fa69bce0986c",
        version: "2",
      },
      input: inputs,
      reasoning: {},
      tools: [
        {
          type: "file_search",
          vector_store_ids: ["vs_68dff4cf8a7881919145bb777b2c2f0a"],
        },
      ],
      store: true,
      include: [
        "reasoning.encrypted_content",
        "web_search_call.action.sources",
      ],
    });

    const result = response;

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
    inputType: v.union(v.literal("text"), v.literal("single_image"), v.literal("two_images")),
    textInput: v.optional(v.string()),
    imageIds: v.optional(v.array(v.id("_storage"))),
    result: v.object({
      reasoning: v.string(),
      coverage: v.string(),
      confidence: v.string(),
      conclusion: v.string(),
      courseMatches: v.optional(v.string()),
    }),
    externalCoursesCount: v.optional(v.number()),
    internalCoursesCount: v.optional(v.number()),
    isSimpleMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("evaluations", args);
  },
});
