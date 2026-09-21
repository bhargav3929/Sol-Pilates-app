import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Montserrat } from "next/font/google";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";
import "./globals.css";
import { LayoutContent } from "@/components/layout/LayoutContent";
import { SitePasswordGate } from "@/components/layout/SitePasswordGate";
import { MetaPixel } from "@/components/layout/MetaPixel";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-sans",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "SOL Pilates Studio",
  description: "Premium Pilates class booking platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={cn("min-h-screen font-sans antialiased", plusJakartaSans.variable, montserrat.variable)}>
        {/* <SitePasswordGate> */}
          <LayoutContent>{children}</LayoutContent>
        {/* </SitePasswordGate> */}
        <Toaster richColors position="top-right" closeButton />
        <MetaPixel />
      </body>
    </html>
  );
}
