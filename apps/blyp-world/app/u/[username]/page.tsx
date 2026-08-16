import { StageRouteClient } from "@/components/StageRouteClient";

export function generateStaticParams() {
  return [{ username: "_" }];
}

export default function StagePage() {
  return <StageRouteClient />;
}
