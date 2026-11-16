import { NextRequest, NextResponse, connection } from "next/server";
import { updateUserSchema } from "@/server/db/validate-schema";


export  async function GET(request: NextRequest) {
    // 关键：Next 16 + cacheComponents 会把「不读任何动态数据」的 GET 静态化，
    // 预渲染结果写进 Route Cache，之后请求直接读缓存文件，
    // handler 不再执行 —— 所以 console.log('--->') 一次都不会打印。
    // connection() 声明：本路由必须有真实请求才执行。
    // 注意：cacheComponents 下 export const dynamic = "force-dynamic" 会直接报 500。
    // await connection();

    const query = request.nextUrl.searchParams;
    // searchParams.get() 没传时返回 null，而 zod 的 .optional() 只接受 undefined，
    // 不认 null。用 ?? undefined 把「没传」转成 undefined，optional 字段才能正确放行。
    // const name = query.get("name") ?? undefined;
    const email = query.get("email");
    // const id = query.get("id") ?? undefined;

    const result = updateUserSchema.safeParse({email});

    if (result.success) {
        return NextResponse.json(result.data);
    }else{
        // result.error.message 是一坨多行 JSON 字符串，前端拿到没法按字段展示。
        // flatten().fieldErrors 给的是 { name: ["..."], email: ["..."] } 这种结构，
        // 前端直接按 key 取即可。顺带把状态码从 200 改成 400。
        console.error(result.error);
        return NextResponse.json(
            { error: "校验失败", details: result.error.flatten().fieldErrors },
            { status: 400 }
        );
    }
}

