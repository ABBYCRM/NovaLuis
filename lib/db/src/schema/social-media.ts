import {
  pgTable, serial, text, varchar, timestamp, integer, boolean,
} from "drizzle-orm/pg-core";

// Reference images uploaded by the user to maintain visual consistency across posts.
export const socialReferenceImagesTable = pgTable("social_reference_images", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull().default("image/png"),
  dataBase64: text("data_base64").notNull(), // raw base64 (no data-URI prefix)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SocialReferenceImage = typeof socialReferenceImagesTable.$inferSelect;

// Scheduled / published social media posts.
export const socialScheduledPostsTable = pgTable("social_scheduled_posts", {
  id: serial("id").primaryKey(),
  platform: varchar("platform", { length: 50 }).notNull(),       // instagram, tiktok, twitter, facebook, linkedin, youtube
  contentType: varchar("content_type", { length: 50 }).notNull(),// post, reel, story, shorts, thumbnail …
  description: text("description").notNull().default(""),
  tone: varchar("tone", { length: 50 }).notNull().default("motivational"),
  caption: text("caption").notNull().default(""),
  hashtags: text("hashtags").notNull().default(""),
  imageUrl: text("image_url").notNull().default(""),             // full URL the client can display
  videoUrl: text("video_url").notNull().default(""),
  aspectRatio: varchar("aspect_ratio", { length: 20 }).notNull().default("1:1"),
  dimensions: varchar("dimensions", { length: 20 }).notNull().default("1080×1080"),
  referenceImageId: integer("reference_image_id"),               // FK → social_reference_images.id
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),// null = post immediately
  status: varchar("status", { length: 20 }).notNull().default("draft"), // draft | pending | publishing | published | failed
  publishedAt: timestamp("published_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  composioResult: text("composio_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
    .$onUpdate(() => new Date()),
});

export type SocialScheduledPost = typeof socialScheduledPostsTable.$inferSelect;
export type InsertSocialScheduledPost = typeof socialScheduledPostsTable.$inferInsert;
