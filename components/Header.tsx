import Link from "next/link";
import { UserButton, SignInButton, Show } from "@clerk/nextjs";
import Image from "next/image";
import { Zap, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkUser } from "@/lib/checkUser";
import { PricingModal } from "@/components/PricingModal";
import { PLANS } from "@/lib/constants";
import type { Plan } from "@/types/plans";
import { LogoPreview } from "@/components/LogoPreview";

export default async function Header() {
  const user = await checkUser();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-white/6 bg-black">
      <nav className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 select-none">
            <LogoPreview />
            <span className="font-bold text-xl tracking-tight flex gap-1">
              <span className="logo-indian inline-block text-orange-400">INDIAN</span>
              <span className="logo-ai inline-block text-white">AI</span>
              <span className="logo-builder inline-block text-green-400">BUILDER</span>
            </span>
          </Link>
          <span className="hidden sm:inline-block text-sm font-semibold animate-text-shimmer bg-[length:200%_auto] bg-gradient-to-r from-orange-400 via-white to-green-400 bg-clip-text text-transparent">
            India's own AI Builder.
          </span>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-5">
          <Show when="signed-in">
            <Link
              href="/projects"
              className="text-[13px] font-medium text-white/40 transition-colors hover:text-white/80"
            >
              Projects
            </Link>

            {/* Credits button commented out — all users get lifetime pro free */}
            {/*user && (
              <PricingModal>
                <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-xs text-white/70">
                  <Zap className="h-3 w-3 fill-white/70" />
                  {user.credits} credits
                </span>
              </PricingModal>
            )*/}

            <UserButton />
          </Show>

          <Show when="signed-out">
            <SignInButton mode="modal">
              <Button
                variant="ghost"
                size="sm"
                className="text-[13px] font-medium text-white/50 hover:text-white/90 hover:bg-transparent"
              >
                Sign in
              </Button>
            </SignInButton>

            <SignInButton mode="modal">
              <Button
                size="sm"
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-black hover:bg-white/90 active:scale-95"
              >
                Get Started
                <ArrowRight className="h-3 w-3 opacity-60" />
              </Button>
            </SignInButton>
          </Show>
        </div>
      </nav>
    </header>
  );
}
