import {createInsertSchema, createSelectSchema} from 'drizzle-zod'

import { files, storageConfiguration, users } from './schema'

export const insertUserSchema = createInsertSchema(users, {
    email: (schema) => schema.email(),
})

export const updateUserSchema = insertUserSchema.pick({email:true})

// 允许客户端指定「按哪一列排序」的白名单（files 表）。
//
// 为什么要白名单：排序列名最终会拼进 SQL 的 ORDER BY，
// 不能用 z.string() 让客户端随便传 —— 传个不存在的列名就是运行时 SQL 报错，
// 传个存在的内部列（userId / path / url）虽然读不到别人的数据，
// 但白送一个探测面，也没任何业务意义。
//
// 用 drizzle-zod 从表结构生成再 pick：列名写错（或以后表改了列）编译期就报错，
// 不会等到线上才发现 ORDER BY 里有个不存在的列。
export const filesCanOrderByColumns = createSelectSchema(files).pick({
    createdAt: true,
    name: true,
    type: true,
    contentType: true,
})

export const createStorageSchema = createInsertSchema(storageConfiguration)