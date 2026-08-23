"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { DRY_RUN_STORAGE_KEY, restoreSession } from "./engine";
import { completeShopDaySteps } from "./scenario";

export const OWNER_TUTORIAL_STORAGE_KEY = "ptm_owner_tutorial_v2";

/** Keeps an active training audience inside its synthetic surface after direct navigation. */
export function DryRunRouteGuard() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const operator = restoreSession(sessionStorage.getItem(DRY_RUN_STORAGE_KEY));
    if (operator) {
      const expected = operator.status === "active" ? completeShopDaySteps[operator.currentStep]?.route ?? "/operator" : "/operator";
      if (pathname !== expected) router.replace(expected);
      return;
    }
    if (sessionStorage.getItem(OWNER_TUTORIAL_STORAGE_KEY) !== null && pathname !== "/admin/tutorial") {
      router.replace("/admin/tutorial");
    }
  }, [pathname, router]);
  return null;
}
