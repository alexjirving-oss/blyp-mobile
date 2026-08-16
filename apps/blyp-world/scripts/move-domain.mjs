import { execFileSync } from "node:child_process";

function api(data) {
  const out = execFileSync(
    "npx",
    ["netlify", "api", "updateSite", "--data", JSON.stringify(data)],
    { encoding: "utf8", shell: true }
  );
  return out;
}

console.log(
  api({
    site_id: "e5ae25c3-4c92-47bc-a65c-14f46bf051af",
    custom_domain: null,
  })
);
console.log(
  api({
    site_id: "3a4c3522-08f4-417f-a4ca-1a3b046fb5c0",
    custom_domain: "blyp.world",
  })
);
