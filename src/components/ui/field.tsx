import { cva, type VariantProps } from "class-variance-authority";
import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";

/**
 * The one look for text inputs, native selects and textareas.
 *
 * Before these existed, 109 inputs, 77 selects and 18 textareas used 7–8
 * different styles each, and none marked an invalid value: a field-level error
 * was only a red sentence somewhere nearby. Pass `aria-invalid` (and point
 * `aria-describedby` at the message) and the field shows it too.
 *
 * Width is left to the caller on purpose — most fields want `w-full`, but
 * inline ones such as a day count stay narrow.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared class builder, as in Button.
export const fieldVariants = cva(
  "rounded-md border border-input bg-background text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 read-only:bg-muted/40 aria-invalid:border-destructive aria-invalid:ring-destructive/30",
  {
    variants: {
      size: {
        sm: "h-8 px-2 text-xs",
        md: "h-10 px-3 text-sm",
      },
    },
    defaultVariants: { size: "md" },
  },
);

type FieldSize = VariantProps<typeof fieldVariants>;

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & FieldSize;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size, ...props },
  ref,
) {
  return <input ref={ref} className={cn(fieldVariants({ size }), className)} {...props} />;
});

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & FieldSize;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, size, ...props },
  ref,
) {
  return <select ref={ref} className={cn(fieldVariants({ size }), className)} {...props} />;
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...props },
  ref,
) {
  // A textarea grows with its content, so it takes padding rather than a height.
  return (
    <textarea
      ref={ref}
      className={cn(fieldVariants(), "h-auto min-h-20 px-3 py-2 text-sm", className)}
      {...props}
    />
  );
});
