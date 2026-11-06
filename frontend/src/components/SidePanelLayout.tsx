import type { ReactNode } from "react";
import { Card } from "./Card";

export function SidePanelLayout({ main, panel }: { main: ReactNode; panel: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="min-w-0 flex-1">{main}</div>
      <Card className="min-w-0 flex-1">{panel}</Card>
    </div>
  );
}
