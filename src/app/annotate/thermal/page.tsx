'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function ThermalRedirectInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const params = searchParams.toString();
    router.replace(`/thermographic/annotate/thermal${params ? `?${params}` : ''}`);
  }, [searchParams, router]);

  return null;
}

export default function ThermalRedirect() {
  return (
    <Suspense>
      <ThermalRedirectInner />
    </Suspense>
  );
}
