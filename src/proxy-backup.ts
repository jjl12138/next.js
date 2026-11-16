import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from './server/auth';

// This function can be marked `async` if using `await` inside
export async function proxy(request: NextRequest) {

  const session = await getServerSession();

  if (!session?.user) {
    return NextResponse.redirect('/api/auth/signin')
  } 
  
  return NextResponse.next();
}

export const config = {
  matcher: '/dashboard/:path*',
}