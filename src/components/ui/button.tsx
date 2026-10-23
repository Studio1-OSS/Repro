import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

// Every action is a pill: one filled blue, one 1px ink outline, plus a dark and a ghost-on-photo variant.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-normal tracking-[-0.02em] transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-primary text-white hover:bg-primary-strong",
        outline: "border border-ink text-ink hover:bg-fog",
        tint: "bg-primary-tint text-primary-strong hover:bg-[#cfe0fb]",
        dark: "bg-ink text-white hover:bg-black",
        ghost: "border border-white/80 text-white hover:bg-white/10",
        quiet: "text-ink-2 hover:bg-fog hover:text-ink",
        danger: "border border-error text-error hover:bg-error/5",
      },
      size: {
        sm: "h-8 px-3.5 text-ui",
        md: "h-10 px-4 text-body",
        lg: "h-12 px-8 text-body",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean };

export function Button({ className, variant, size, asChild, loading, children, disabled, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="animate-spin" />}
          {children}
        </>
      )}
    </Comp>
  );
}

export { buttonVariants };
