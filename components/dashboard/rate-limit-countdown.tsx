"use client";

import { useEffect, useState } from "react";

interface RateLimitCountdownProps {
  seconds: number;
  onExpired?: () => void;
}

export default function RateLimitCountdown({ seconds, onExpired }: RateLimitCountdownProps) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
  }, [seconds]);

  useEffect(() => {
    if (remaining <= 0) {
      onExpired?.();
      return;
    }
    const timer = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, onExpired]);

  return (
    <span className="text-sm text-amber-600 font-medium">
      Rate limited. Retry in {remaining}s
    </span>
  );
}
