import { LiveWatchRouteClient } from "@/components/LiveWatchRouteClient";

export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function LiveWatchPage() {
  return <LiveWatchRouteClient />;
}
