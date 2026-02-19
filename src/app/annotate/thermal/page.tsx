'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function ThermalRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const params = searchParams.toString();
    router.replace(`/thermographic/annotate/thermal${params ? `?${params}` : ''}`);
  }, [searchParams, router]);

  return null;
}
