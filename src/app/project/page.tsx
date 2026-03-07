'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function ProjectRedirectInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const params = searchParams.toString();
    router.replace(`/thermographic/project${params ? `?${params}` : ''}`);
  }, [searchParams, router]);

  return null;
}

export default function ProjectRedirect() {
  return (
    <Suspense>
      <ProjectRedirectInner />
    </Suspense>
  );
}
