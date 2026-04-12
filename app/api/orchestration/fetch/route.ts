import { NextResponse } from 'next/server';
import { fetchTaskContent } from '@/lib/grpc/client';

export async function POST(request: Request) {
  try {
    const { tempId } = await request.json();

    if (!tempId) {
      return NextResponse.json({ success: false, error: 'Missing tempId' }, { status: 400 });
    }

    const content = await fetchTaskContent(tempId);

    return NextResponse.json({ success: true, content });
  } catch (error: any) {
    console.error('Orchestration fetch error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
