"use client";

import { useEffect } from "react";
import { recordFirstVisit } from "@/lib/analytics";

export default function FirstVisitTracker() {
  useEffect(() => {
    recordFirstVisit();
  }, []);

  return null;
}
