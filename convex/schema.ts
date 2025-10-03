import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const applicationTables = {
  evaluations: defineTable({
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
  }).index("by_user", ["userId"]),
};

export default defineSchema({
  ...authTables,
  ...applicationTables,
});
