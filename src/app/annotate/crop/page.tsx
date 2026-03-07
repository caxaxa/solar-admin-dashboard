'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function CropRedirectInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const params = searchParams.toString();
    router.replace(`/thermographic/annotate/crop${params ? `?${params}` : ''}`);
  }, [searchParams, router]);

  return null;
}

export default function CropRedirect() {
  return (
    <Suspense>
      <CropRedirectInner />
    </Suspense>
  );
}
