'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function DefectsRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const params = searchParams.toString();
    router.replace(`/thermographic/annotate/defects${params ? `?${params}` : ''}`);
  }, [searchParams, router]);

  return null;
}
