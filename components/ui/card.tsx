import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  className?: string;
  hover?: boolean;
};

export function Card({
  children,
  className = "",
  hover = true,
  ...props
}: CardProps) {
  return (
    <div
      className={`rounded-3xl border border-fuchsia-200/70 bg-white/75 p-6 shadow-sm backdrop-blur transition-all duration-300 ${
        hover
          ? "hover:-translate-y-0.5 hover:border-dogood-pink/50 hover:shadow-[0_16px_40px_rgba(236,72,153,0.22)]"
          : ""
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
