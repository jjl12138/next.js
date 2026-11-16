import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleHTTP } from 'drizzle-orm/neon-http';
import postgres from 'postgres';
import * as schema from './schema';
import { neon } from '@neondatabase/serverless';

// ⚠️ 返回类型必须是【单一具体类型】，不能是 PostgresJsDatabase | NeonHttpDatabase 联合：
//    联合类型上调用 update(...).returning({...}) / insert(...).returning({...})
//    时，TS 会对两个成员的 returning 重载做合并解析，只保留 0 参签名 →
//    所有路由文件里带列参数的 returning 全部报 TS2554（Expected 0 arguments）。
//    两个驱动单独用都正常（已实测排除），坏就坏在联合。
//
//    处理：neon-http 分支断言成 PostgresJsDatabase。两个类都继承 PgDatabase，
//    本项目用到的 API（insert/update/query/select + returning 的行数组形状）
//    完全一致，断言不改变任何运行时行为；唯一类型上的差异是底层查询结果的
//    HKT 包装（neon-http 是 HTTP 响应包装），对业务代码不可见。
function createDB(): PostgresJsDatabase<typeof schema> {
    const neonDBUrl = process.env.NEON_DB_URL

    if(neonDBUrl){
        const client = neon(neonDBUrl)

        return drizzleHTTP(client, {schema}) as unknown as PostgresJsDatabase<typeof schema>
    } else {
        const queryClient = postgres(
            "postgres://postgres:123123@localhost:5432/postgres"
        );

        return drizzle(queryClient, { schema, logger: true });
    }
}

export const db = createDB();
