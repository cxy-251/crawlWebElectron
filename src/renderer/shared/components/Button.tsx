import { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  children: ReactNode;
};

export function Button({ variant = "secondary", className = "", children, ...props }: ButtonProps) {
  const styles = {
    primary: "bg-slate-900 text-white hover:bg-slate-800 border-slate-900",
    secondary: "bg-white text-slate-700 hover:bg-slate-50 border-slate-200",
    danger: "bg-rose-50 text-rose-700 hover:bg-rose-100 border-rose-200"
  };

  return (
    <button
      type="button"
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

