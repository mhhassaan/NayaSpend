import { isValidElement, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

export function ListReveal({ items, className = "flex flex-col gap-3" }: { items: ReactNode[]; className?: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <div className={className}>
      {items.map((item, i) => (
        <motion.div
          key={isValidElement(item) ? item.key ?? i : i}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2, delay: reduceMotion ? 0 : Math.min(i, 10) * 0.04 }}
        >
          {item}
        </motion.div>
      ))}
    </div>
  );
}
