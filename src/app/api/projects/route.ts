import { NextResponse } from 'next/server';
import { listOrganizations, listProjects } from '@/lib/s3-client';

export async function GET() {
  try {
    const organizations = await listOrganizations();

    const allProjects: Array<{ orgId: string; projectId: string }> = [];

    // Fetch projects for each organization
    for (const orgId of organizations) {
      // Skip non-UUID folders (like 'templates')
      if (!orgId.includes('-')) continue;

      const projectIds = await listProjects(orgId);
      for (const projectId of projectIds) {
        allProjects.push({ orgId, projectId });
      }
    }

    return NextResponse.json({ projects: allProjects });
  } catch (error) {
    console.error('Failed to fetch projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}
