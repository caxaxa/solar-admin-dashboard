'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function TexRedirectInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const params = searchParams.toString();
    router.replace(`/thermographic/annotate/tex${params ? `?${params}` : ''}`);
  }, [searchParams, router]);

  return null;
}

export default function TexRedirect() {
  return (
    <Suspense>
      <TexRedirectInner />
    </Suspense>
  );
}
