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

    let content = "";
    const messages: any[] = [];

    if (args.inputType === "text" && args.textInput) {
      content = args.textInput;
      
      if (args.isSimpleMode) {
        messages.push({
          role: "user",
          content: `Please evaluate these course descriptions for equivalence. The user has provided both external and internal course descriptions in a single text input:\n\n${content}`
        });
      } else {
        messages.push({
          role: "user",
          content: `Please evaluate these course descriptions for equivalence:\n\n${content}`
        });
      }
    } else if (args.imageIds && args.imageIds.length > 0) {
      const imageUrls = await Promise.all(
        args.imageIds.map(async (id) => {
          const url = await ctx.storage.getUrl(id);
          if (!url) throw new Error("Image not found");
          return url;
        })
      );

      let messageText = "";
      
      if (args.isSimpleMode) {
        messageText = `Please evaluate these course descriptions for equivalence. This is a single image containing both course descriptions. The external course should be on the left side and the internal course should be on the right side of the image.`;
      } else {
        messageText = `Please evaluate these course descriptions for equivalence. The images are organized as follows:
${args.externalCoursesCount ? `- First ${args.externalCoursesCount} image(s): EXTERNAL COURSES` : ''}
${args.internalCoursesCount ? `- ${args.externalCoursesCount ? 'Next' : 'First'} ${args.internalCoursesCount} image(s): INTERNAL COURSES` : ''}

Please analyze the courses from each group and determine their equivalency.`;
      }

      const messageContent: any[] = [
        { type: "text", text: messageText }
      ];

      imageUrls.forEach((url) => {
        messageContent.push({
          type: "image_url",
          image_url: { url }
        });
      });

      messages.push({
        role: "user",
        content: messageContent
      });
    }

    // System prompt - different for simple vs advanced mode
    const systemPrompt = args.isSimpleMode ? 
      `You are an expert academic advisor specializing in course equivalency evaluation. Your task is to analyze course descriptions and determine if they are equivalent for transfer credit purposes.

You will be comparing EXTERNAL COURSES (from other institutions) with INTERNAL COURSES (from the receiving institution) to determine equivalency for transfer credit.

When evaluating courses, consider:
- Learning objectives and outcomes
- Course content and topics covered  
- Depth and breadth of material
- Prerequisites and academic level
- Credit hours and contact time
- Assessment methods when available

For text input: Look for clear labels like "External Course:" and "Internal Course:" or similar indicators.
For image input: The external course is typically on the left side and the internal course is on the right side.

Respond in the following structured JSON format:
{
  "reasoning": "[Detailed step-by-step analysis comparing course elements between external and internal courses. Note similarities, differences, and degree of equivalence. Mention any issues with image quality or text ambiguity.]",
  "coverage": "[Percentage of how much the external course content is covered by the internal course]",
  "confidence": "[How certain is the conclusion? Answer with a percentage, noting any factors that reduce confidence such as unclear text or missing information]",
  "conclusion": "[Summary of equivalency determination: 'Equivalent' or 'Not Equivalent' with brief rationale]"
}` :
      `You are an expert academic advisor specializing in course equivalency evaluation. Your task is to analyze course descriptions and determine if they are equivalent for transfer credit purposes.

You will be comparing EXTERNAL COURSES (from other institutions) with INTERNAL COURSES (from the receiving institution) to determine equivalency for transfer credit.

When evaluating courses, consider:
- Learning objectives and outcomes
- Course content and topics covered  
- Depth and breadth of material
- Prerequisites and academic level
- Credit hours and contact time
- Assessment methods when available

For multiple course comparisons:
- Compare each external course against the most similar internal course(s)
- Identify which courses have equivalents and which do not
- Consider partial equivalencies where appropriate
- Note any gaps in coverage or additional content

Respond in the following structured JSON format:
{
  "reasoning": "[Detailed step-by-step analysis comparing course elements between external and internal courses. Note similarities, differences, and degree of equivalence. Mention any issues with image quality or text ambiguity. For multiple courses, analyze each pairing.]",
  "coverage": "[Overall percentage of how much the external course content is covered by internal courses, considering all comparisons]",
  "confidence": "[How certain is the conclusion? Answer with a percentage, noting any factors that reduce confidence such as unclear text or missing information]",
  "conclusion": "[Summary of equivalency determination. For single comparisons: 'Equivalent' or 'Not Equivalent'. For multiple courses: describe which courses are equivalent, partially equivalent, or not equivalent, with brief rationale]",
  "courseMatches": "[If multiple courses: list specific course pairings and their individual equivalency status]"
}`;

    messages.unshift({
      role: "system",
      content: systemPrompt
    });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.1,
    });

    const resultText = response.choices[0].message.content;
    if (!resultText) {
      throw new Error("No response from OpenAI");
    }

    let result;
    try {
      // Try to extract JSON from markdown code blocks or parse directly
      let jsonText = resultText;
      
      // Check if the response is wrapped in markdown code blocks
      const jsonMatch = resultText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
      
      result = JSON.parse(jsonText);
    } catch (error) {
      // If JSON parsing fails, create a structured response
      result = {
        reasoning: resultText,
        coverage: "Unable to determine",
        confidence: "Low due to parsing error",
        conclusion: "Unable to determine equivalence",
        courseMatches: args.isSimpleMode ? undefined : "Unable to parse course matches"
      };
    }

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
