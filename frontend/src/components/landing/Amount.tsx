import NumberFlow from "@number-flow/react";
import { useReducedMotion } from "motion/react";

export function Amount({ value }: { value: number }) {
  const reduce = useReducedMotion();
  return <NumberFlow value={value} locales="en-US" animated={!reduce} />;
}
