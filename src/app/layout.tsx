import type { Metadata, Viewport } from "next";
import { DM_Serif_Display, Great_Vibes, Poppins } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const poppins = Poppins({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-poppins", display: "swap" });
const display = DM_Serif_Display({ subsets: ["latin"], weight: "400", variable: "--font-display", display: "swap" });
const script = Great_Vibes({ subsets: ["latin", "latin-ext"], weight: "400", variable: "--font-script", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Signal Leads", template: "%s · Signal Leads" },
  description: "Autonomous lead operations for service businesses. A Kime product.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#07170f",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${display.variable} ${script.variable}`}>
      <body>
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: { background: "var(--surface-elevated)", border: "1px solid var(--border-strong)", color: "var(--foreground)" },
          }}
        />
      </body>
    </html>
  );
}
