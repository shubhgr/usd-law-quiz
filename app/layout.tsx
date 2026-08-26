import type { Metadata } from "next";
import { Sofia_Sans, Spectral, Inter } from "next/font/google";
import "./globals.css";
import { COMPETITION_NAME } from "@/lib/config";
import ToastHost from "@/components/ToastHost";

const sofiaSans = Sofia_Sans({
  variable: "--font-sofia-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: `${COMPETITION_NAME}`,
    template: `%s - ${COMPETITION_NAME}`,
  },
  description:
    "USD Law Quiz - a timed legal knowledge quiz with autosave, downloadable results, and a live leaderboard.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${sofiaSans.variable} ${spectral.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans" suppressHydrationWarning>
        {children}
        <ToastHost />
      </body>
    </html>
  );
}
