import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

/** Marketing + product shells Google should discover. Dynamic /v /u /live/:id are client-routed. */
const ROUTES: { path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }[] =
  [
    { path: "/", changeFrequency: "weekly", priority: 1 },
    { path: "/live/", changeFrequency: "hourly", priority: 0.85 },
    { path: "/foryou/", changeFrequency: "hourly", priority: 0.8 },
    { path: "/search/", changeFrequency: "weekly", priority: 0.5 },
    { path: "/wallet/", changeFrequency: "monthly", priority: 0.55 },
    { path: "/live/studio/", changeFrequency: "monthly", priority: 0.45 },
  ];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path === "/" ? "/" : path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
