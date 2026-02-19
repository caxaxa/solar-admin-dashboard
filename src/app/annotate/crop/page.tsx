'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function CropRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const params = searchParams.toString();
    router.replace(`/thermographic/annotate/crop${params ? `?${params}` : ''}`);
  }, [searchParams, router]);

  return null;
}
