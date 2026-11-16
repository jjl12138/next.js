import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string[] }> } // 1. 类型改成 Promise
) {
  const { id } = await params; // 2. 异步解包
  console.log("[...id]");
  return NextResponse.json({ id: id });
}