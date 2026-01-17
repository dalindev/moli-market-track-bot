'use client';

import { useState, useEffect } from 'react';
import { formatTimeAgo, getRefreshInterval } from '@/lib/time-utils';

interface TimeAgoProps {
  date: string | Date | null;
  className?: string;
}

export function TimeAgo({ date, className }: TimeAgoProps) {
  const [timeAgo, setTimeAgo] = useState(() => formatTimeAgo(date));

  useEffect(() => {
    // Update immediately
    setTimeAgo(formatTimeAgo(date));

    // Set up interval for auto-refresh
    const interval = setInterval(() => {
      setTimeAgo(formatTimeAgo(date));
    }, getRefreshInterval(date));

    return () => clearInterval(interval);
  }, [date]);

  return <span className={className}>{timeAgo}</span>;
}
