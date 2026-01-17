/**
 * Format a date as relative time (e.g., "5 min ago", "2 hours ago")
 */
export function formatTimeAgo(date: string | Date | null): string {
  if (!date) return 'Never';

  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return 'Just now';
  } else if (diffMin < 60) {
    return `${diffMin} min ago`;
  } else if (diffHour < 24) {
    return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  } else if (diffDay < 7) {
    return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  } else {
    return then.toLocaleDateString();
  }
}

/**
 * Get refresh interval based on how old the timestamp is
 * More recent = refresh more frequently
 */
export function getRefreshInterval(date: string | Date | null): number {
  if (!date) return 60000; // 1 minute

  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 1000 / 60);

  if (diffMin < 5) {
    return 10000; // 10 seconds if very recent
  } else if (diffMin < 60) {
    return 30000; // 30 seconds if within an hour
  } else {
    return 60000; // 1 minute otherwise
  }
}
