'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function DefectMapRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const params = searchParams.toString();
    router.replace(`/thermographic/defect-map${params ? `?${params}` : ''}`);
  }, [searchParams, router]);

  return null;
}
