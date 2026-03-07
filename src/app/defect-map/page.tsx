'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function DefectMapRedirectInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const params = searchParams.toString();
    router.replace(`/thermographic/defect-map${params ? `?${params}` : ''}`);
  }, [searchParams, router]);

  return null;
}

export default function DefectMapRedirect() {
  return (
    <Suspense>
      <DefectMapRedirectInner />
    </Suspense>
  );
}
