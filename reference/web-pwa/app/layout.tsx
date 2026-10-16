import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

/**
 * Inter is self-hosted by next/font (served from our own domain at build
 * time). It is used ONLY as the fallback for non-Apple platforms - the font
 * stack in globals.css leads with -apple-system so SF renders on iOS/macOS
 * and Inter takes over on Android/Windows.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Iqra",
  description: "Private Quran-study accountability for you and your circle.",
  applicationName: "Iqra",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Iqra",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  // Never index this private app.
  robots: { index: false, follow: false, nocache: true },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Extend under the notch / home indicator; CSS uses env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0f0d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* Apply the saved theme before paint to avoid a flash. "system" (or
            unset) falls through to the prefers-color-scheme media query. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('iqra:theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}})();`,
          }}
        />
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
