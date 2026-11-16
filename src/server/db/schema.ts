import {
  boolean,
  timestamp,
  pgTable,
  text,
  primaryKey,
  integer,
  date,
  uuid,
  varchar,
  unique,
  index,
  serial,
  json,
} from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import type { AdapterAccount } from "next-auth/adapters"

// 连接只应该在 src/server/db/db.ts 里建一次。
// 这里原来又 new 了一个 postgres()，而且连的是
// "postgres://...@5432/drizzle"，跟 db.ts 的 ".../postgres" 不是一个库 ——
// 同一个进程两个连接池、两个库，改了这边那边看不到，非常难查。
export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  plan: text("plan",{enum: ['free', 'paid']}),
  image: text("image"),
  create: date("create_at").defaultNow()
})

// ⚠️ 这张表的 relations 在文件末尾的 `usersRelations` 里定义，
//    这里原来还有一份 `usersRelation`（单数），两份重复定义同一个表 ——
//    drizzle 只有一份生效，改这边改不动那边，纯粹是埋雷。已合并。
export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccount["type"]>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    {
      compoundKey: primaryKey({
        columns: [account.provider, account.providerAccountId],
      }),
    },
  ]
)
 
export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
})
 
export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (verificationToken) => [
    {
      compositePk: primaryKey({
        columns: [verificationToken.identifier, verificationToken.token],
      }),
    },
  ]
)
 
export const authenticators = pgTable(
  "authenticator",
  {
    credentialID: text("credentialID").notNull().unique(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerAccountId: text("providerAccountId").notNull(),
    credentialPublicKey: text("credentialPublicKey").notNull(),
    counter: integer("counter").notNull(),
    credentialDeviceType: text("credentialDeviceType").notNull(),
    credentialBackedUp: boolean("credentialBackedUp").notNull(),
    transports: text("transports"),
  },
  (authenticator) => [
    {
      compositePK: primaryKey({
        columns: [authenticator.userId, authenticator.credentialID],
      }),
    },
  ]
)

export const files = pgTable("files", {
    // notNull() 的 N 是大写，写成 notnull() 是 undefined，直接在运行时炸。
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    // 原来是 varchar("id", ...) —— 列名重复成 id，跟主键撞了。
    name: varchar("name", {length: 100}).notNull(),
    // 存的是文件的 MIME 类型（image/png 之类）
    type: varchar("type", {length: 100}).notNull(),
    // ⚠️ 必须是 timestamptz（withTimezone: true），不能是裸 timestamp。
    //    实测：PG 的 `show timezone` = Etc/UTC，而 Node 进程跑在 Asia/Shanghai，
    //    postgres.js 会把 PG 返回的「无时区」字符串按【本地时区】解析成 Date：
    //      库里  2026-10-28 10:14:17.816321
    //      → JS  Date 2026-10-28T02:14:17.816Z
    //    而 files.ts 的分页游标是拿 `date.toISOString()` 回传给 SQL 比较的，
    //    塞回去又被当成「无时区」读成 2026-10-28 02:14:17.816 —— 差整整 8 小时。
    //    后果：desc 翻页时第二页直接跳过最近 8 小时内上传的所有文件（静默丢数据）。
    //    改成 timestamptz 后，入库/出库/游标三边都是无歧义的 UTC 时刻，这个坑自动消失。
    createdAt: timestamp("created_at", {mode: "date", withTimezone: true}).defaultNow(),
    deletedAt: timestamp("deleted_at", {mode: "date", withTimezone: true}),
    // path 是对象键（/2026-10-25/xxx.png），url 是完整可访问地址
    path: varchar("path", {length: 1024}).notNull(),
    url: varchar("url", {length: 1024}).notNull(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    contentType: varchar("content_type", {length: 100}).notNull(),
    // ⚠️ 原来是 notNull()，但 saveFile 插入时压根没传这个字段 ——
    //    drizzle 生成的 INSERT 里 app_id 会落到 `default`，而它没有默认值 → NULL →
    //    违反 NOT NULL 约束，上传接口必炸。
    //    当前代码里 apps / appId 没有任何使用方（无页面、无 resolver、无数据），
    //    所以先放宽成可空，等真正做「多应用」时再配套补齐写入逻辑。
    appId: uuid('app_id'),
}, (files) => [
    // 列表和游标分页的固定查询形态是
    //   where user_id = ? and deleted_at is null order by created_at desc
    // 没有索引的话数据量一大就是每页全表扫。
    index("files_user_id_created_at_idx").on(files.userId, files.createdAt),
]);

export const filesRelations = relations(files, ({one})=>({
    // 关系名原来叫 files，读起来是 files.files，应该是 user
    user: one(users, {fields: [files.userId], references: [users.id]}),
    app: one(apps, {fields: [files.appId], references: [apps.id]})
}))

// ⟵ 原来这里还重复定义过一份 relations(users)，已合并到下面这一份。
export const usersRelations = relations(users, ({many})=>({
    files: many(files),
    apps: many(apps),
    storages: many(storageConfiguration)
}))

export const apps = pgTable(
    "apps",
    {
        id: uuid("id").notNull().primaryKey(),
        name: varchar("name", {length: 100}).notNull(),
        description: varchar("description", {length: 500}),
        deletedAt: timestamp("deleted_at", {mode: "date", withTimezone: true}),
        createdAt: timestamp("created_at", {mode: "date", withTimezone: true}).defaultNow(),
        userId: text("user_id").notNull(),
        storageId: integer("storage_id")
    },
    // ⚠️ 原来写成 `(apps)=>{ compoundNameKey: unique().on(...) }` ——
    //    箭头函数的函数体用花括号时，`xxx: yyy` 不是对象字面量而是【标签语句】，
    //    整个回调返回 undefined，这个唯一约束从来没被建过。
    //    要么写成返回数组 `[ unique().on(...) ]`，要么（下面这种）用圆括号把对象字面量包起来返回。
    // (apps)=>({
    //     // 注：id 本身是主键，再跟 name 做复合唯一约束实际是冗余的；
    //     // 真正想表达「同一个用户下 app 不能重名」的话应该是 unique().on(apps.userId, apps.name)。
    //     compoundNameKey: unique().on(apps.id, apps.name)
    // })
)

export const appRelations = relations(apps, ({one, many})=>({
    user: one(users, {fields: [apps.userId], references: [users.id]}),
    storage: one(storageConfiguration, {fields: [apps.storageId], references: [storageConfiguration.id] }),
    files: many(files),
    apiKeys: many(apiKeys)
}))

export type S3StorageConfiguration = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  apiEndpoint?: string;
}

export type StorageConfiguration = S3StorageConfiguration;

export const storageConfiguration = pgTable("storageConfiguration",{
  id: serial("id").primaryKey(),
  name: varchar("name",{length: 100}).notNull(),
  userId: uuid("user_id").notNull(),
  configuration: json("configuration").$type<S3StorageConfiguration>().notNull(),
  deletedAt: timestamp("deleted_at", {mode: "date", withTimezone: true}),
  createdAt: timestamp("created_at", {mode: "date", withTimezone: true}).defaultNow()      
})

export const storageConfigurationRelations = relations(storageConfiguration,({one})=>({
  user: one(users, {fields: [storageConfiguration.userId], references: [users.id]})
}))

export const apiKeys = pgTable('apiKeys', {
  id: serial("id").primaryKey(),
  name: varchar("name",{length: 255}).notNull(),
  clientId: varchar("clientId",{length: 100}).notNull().unique(),
  // ⚠️ 密钥必须唯一：它是凭这个值去鉴权的，撞了就分不清是哪个应用；
  //    而且没有唯一索引的话按 key 查就是全表扫。
  key: varchar("key",{length: 100}).notNull().unique(),
  // ⚠️ 原来是 integer('appId')，但 apps.id 是 uuid —— integer 列永远
  //    存不下 uuid，关系 apiKeysRelations -> apps.id 也是错配的。
  //    （files.appId 同样是 uuid，storages.ts 里 appId 走的是 z.uuid()。）
  appId: uuid('appId').notNull(),
  deletedAt: timestamp("deleted_at", {mode: "date", withTimezone: true}),
  createdAt: timestamp("created_at", {mode: "date", withTimezone: true}).defaultNow()
}, (apiKeys) => [
  // 列表的固定查询形态是 where app_id = ? and deleted_at is null
  index("api_keys_app_id_idx").on(apiKeys.appId),
])

export const apiKeysRelations = relations(apiKeys,({one})=>({
  app: one(apps, {fields: [apiKeys.appId], references: [apps.id]})
}))

export const orders = pgTable('orders', {
  sessionId: varchar("sessionId", {length: 255}).primaryKey(),
  status: varchar("status", {enum: ["created", "canceled", "completed"]}).notNull(),
  createdAt: timestamp("created_at", {mode: "date", withTimezone: true}).defaultNow(),
  // 关联 users.id 的普通列。原定义 text("id").primaryKey() 是从 users 表
  // 复制来的残留：一个表两个主键，drizzle-kit push 直接报错建不了表。
  userId: text("userId").notNull(),
})

export const ordersRelation = relations(orders, ({one})=>({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id]
  })
}))