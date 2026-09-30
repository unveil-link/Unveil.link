import { SiteHeader } from "@/components/landing/SiteHeader";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { SellerCta } from "@/components/landing/SellerCta";
import { BuyerTrust } from "@/components/landing/BuyerTrust";
import { Faq } from "@/components/landing/Faq";
import { SiteFooter } from "@/components/landing/SiteFooter";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Hero />
        <HowItWorks />
        <SellerCta />
        <BuyerTrust />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
