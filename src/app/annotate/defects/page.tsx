'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function DefectsRedirectInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const params = searchParams.toString();
    router.replace(`/thermographic/annotate/defects${params ? `?${params}` : ''}`);
  }, [searchParams, router]);

  return null;
}

export default function DefectsRedirect() {
  return (
    <Suspense>
      <DefectsRedirectInner />
    </Suspense>
  );
}
