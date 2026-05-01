import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  uuid,
  bigint,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const creditTransactionTypeEnum = pgEnum('credit_transaction_type', [
  'grant',
  'consume',
  'recharge',
]);

export const shareModeEnum = pgEnum('share_mode', ['public', 'readonly', 'editable', 'sso']);

export const classroomStatusEnum = pgEnum('classroom_status', [
  'generating',
  'completed',
  'failed',
]);

export const mediaTypeEnum = pgEnum('media_type', ['image', 'video', 'audio', 'tts']);

// ─── Users (synced from Casdoor on first login) ──────────────────────────────

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  casdoorName: text('casdoor_name').notNull(),
  nickname: text('nickname').notNull().default(''),
  avatar: text('avatar').default(''),
  email: text('email').default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Credits ─────────────────────────────────────────────────────────────────

export const credits = pgTable('credits', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id)
    .unique(),
  balance: integer('balance').notNull().default(100),
  totalEarned: integer('total_earned').notNull().default(100),
  totalConsumed: integer('total_consumed').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    amount: integer('amount').notNull(),
    type: creditTransactionTypeEnum('type').notNull(),
    description: text('description').default(''),
    relatedApi: text('related_api').default(''),
    tokenCount: integer('token_count').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_credit_tx_user').on(table.userId)],
);

// ─── Classrooms ──────────────────────────────────────────────────────────────

export const classrooms = pgTable(
  'classrooms',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull().default(''),
    language: text('language').notNull().default('en-US'),
    stageJson: jsonb('stage_json'),
    scenesJson: jsonb('scenes_json'),
    status: classroomStatusEnum('status').notNull().default('generating'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_classroom_user').on(table.userId)],
);

// ─── Classroom Media ─────────────────────────────────────────────────────────

export const classroomMedia = pgTable(
  'classroom_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classrooms.id, { onDelete: 'cascade' }),
    mediaType: mediaTypeEnum('media_type').notNull(),
    /**
     * Element identifier from the scene (e.g. `gen_img_1`, `gen_vid_2`, `tts_abc`).
     * Used to backfill scene `src` / `audioUrl` on read when async MinIO uploads
     * complete after the scene has been persisted. Nullable for legacy rows.
     */
    elementId: text('element_id'),
    minioKey: text('minio_key').notNull(),
    mimeType: text('mime_type').default('application/octet-stream'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_media_classroom').on(table.classroomId),
    index('idx_media_classroom_element').on(table.classroomId, table.elementId),
  ],
);

// ─── Shares ──────────────────────────────────────────────────────────────────

export const shares = pgTable(
  'shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classrooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    shareToken: text('share_token').notNull().unique(),
    mode: shareModeEnum('mode').notNull().default('readonly'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_share_token').on(table.shareToken),
    // Persistent share-link model: each (classroom, user) pair has at most
    // one share row; subsequent share API calls upsert the existing token.
    uniqueIndex('uniq_share_classroom_user').on(table.classroomId, table.userId),
  ],
);

// ─── Chat Sessions ──────────────────────────────────────────────────────────

export const chatSessionStatusEnum = pgEnum('chat_session_status', [
  'active',
  'completed',
  'interrupted',
]);

export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: text('id').primaryKey(),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classrooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    sceneId: text('scene_id').default(''),
    type: text('type').notNull().default('chat'),
    title: text('title').default(''),
    status: chatSessionStatusEnum('status').notNull().default('active'),
    messagesJson: jsonb('messages_json'),
    config: jsonb('config'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_chat_session_classroom').on(table.classroomId),
    index('idx_chat_session_user').on(table.userId),
  ],
);

// ─── Classroom Interactions (quiz, transcription, PBL) ──────────────────────

export const interactionTypeEnum = pgEnum('interaction_type', [
  'quiz',
  'transcription',
  'pbl',
]);

export const classroomInteractions = pgTable(
  'classroom_interactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classroomId: text('classroom_id')
      .notNull()
      .references(() => classrooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    sceneId: text('scene_id').default(''),
    type: interactionTypeEnum('type').notNull(),
    inputJson: jsonb('input_json'),
    outputJson: jsonb('output_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_interaction_classroom').on(table.classroomId),
    index('idx_interaction_user').on(table.userId),
  ],
);

// ─── Checkpoints (saved state when credits run out) ──────────────────────────

export const checkpoints = pgTable(
  'checkpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    classroomId: text('classroom_id').default(''),
    step: text('step').notNull().default(''),
    stateJson: jsonb('state_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_checkpoint_user').on(table.userId)],
);
