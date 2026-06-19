import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { deakoStatus } from '@/lib/integrations/deako';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(deakoStatus());
}
