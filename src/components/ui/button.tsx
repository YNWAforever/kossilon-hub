import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * The one button style for the app.
 *
 * Screens used to hand-roll their own: 204 buttons in 28 different visual
 * styles, with hover, focus and disabled states present on some and missing on
 * others. Every action now draws from these variants. Use `asChild` to give a
 * router `<Link>` the same look, or `buttonVariants()` where a component needs
 * the class string itself.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared with Link styling, as in shadcn.
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** The single most important action in a region. */
        primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        /** Everything else a person can do. */
        outline: "border border-input bg-background shadow-sm hover:bg-accent",
        /** Low-emphasis actions inside dense rows and toolbars. */
        ghost: "hover:bg-accent",
        /** Irreversible or rejecting actions. */
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        /** An inline text action. */
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, type, ...props },
  ref,
) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      ref={ref}
      // A bare <button> inside a form submits it; default to "button" so only an
      // explicit type="submit" does.
      type={asChild ? type : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});
