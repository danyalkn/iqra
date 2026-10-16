"use client";

import { useEffect, useState } from "react";
import { Share, SquarePlus, Check, Download, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/Button";

type Platform = "ios" | "android" | "desktop";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  const iOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (iOS) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function AddToHomeScreen() {
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [installed, setInstalled] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );

  useEffect(() => {
    setPlatform(detectPlatform());
    setInstalled(isStandalone());

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) {
    return (
      <div className="rounded-2xl border border-accent/30 bg-accent-tint p-4">
        <div className="flex items-center gap-2 text-accent">
          <Check className="size-5" strokeWidth={2.5} />
          <p className="text-callout font-semibold">Installed</p>
        </div>
        <p className="mt-1 text-footnote text-muted">
          You’re running Iqra as an installed app, so push notifications will work.
        </p>
      </div>
    );
  }

  if (platform === "ios") {
    return (
      <div className="rounded-2xl bg-surface p-4 shadow-e1">
        <p className="text-callout font-semibold">Add Iqra to your Home Screen</p>
        <p className="mt-1 text-footnote text-muted">
          On iPhone, notifications only work once Iqra is installed (iOS 16.4+).
          In <span className="font-medium text-foreground">Safari</span>:
        </p>
        <ol className="mt-3 space-y-2.5">
          <li className="flex items-center gap-3 text-subhead">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-accent">
              <Share className="size-4" />
            </span>
            Tap the <span className="font-medium">Share</span> button
          </li>
          <li className="flex items-center gap-3 text-subhead">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-accent">
              <SquarePlus className="size-4" />
            </span>
            Choose <span className="font-medium">Add to Home Screen</span>
          </li>
          <li className="flex items-center gap-3 text-subhead">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-accent">
              <Check className="size-4" />
            </span>
            Open Iqra from your Home Screen
          </li>
        </ol>
      </div>
    );
  }

  if (platform === "android") {
    return (
      <div className="rounded-2xl bg-surface p-4 shadow-e1">
        <p className="text-callout font-semibold">Install Iqra</p>
        <p className="mt-1 text-footnote text-muted">
          Installing enables push notifications and a full-screen app.
        </p>
        {deferred ? (
          <Button
            className="mt-3"
            fullWidth
            onClick={async () => {
              await deferred.prompt();
              const { outcome } = await deferred.userChoice;
              if (outcome === "accepted") setInstalled(true);
              setDeferred(null);
            }}
          >
            <Download className="size-5" /> Install app
          </Button>
        ) : (
          <p className="mt-3 flex items-center gap-2 text-footnote text-muted">
            <Smartphone className="size-4" />
            Use your browser’s menu → <span className="font-medium">Install app</span> /
            <span className="font-medium"> Add to Home screen</span>.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-surface p-4 shadow-e1">
      <p className="text-callout font-semibold">Open Iqra on your phone</p>
      <p className="mt-1 text-footnote text-muted">
        Iqra is built for mobile. Open it on your iPhone or Android and add it to
        your Home Screen so notifications work.
      </p>
    </div>
  );
}
