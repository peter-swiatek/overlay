declare module "*.css";

/** Vite's import.meta.glob (the overlay renderer and vitest are built by Vite). */
interface ImportMeta {
  glob<T = unknown>(
    pattern: string | readonly string[],
    options: { eager: true; query?: string; import?: string },
  ): Record<string, T>;
}
